const {z}=require('zod');
const {HttpError,hash}=require('../../domain');
const {normalize}=require('../domain');
const {torobUrl}=require('./urls');
const {carMentions}=require('./compatibility');
const pageSchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(24)});
const args=q=>({skip:(q.page-1)*q.limit,take:q.limit});
async function paged(model,where,q,extra={}){const[items,total]=await Promise.all([model.findMany({where,...args(q),...extra}),model.count({where})]);return{items,total,page:q.page,limit:q.limit};}
const seedSchema=z.object({name:z.string().trim().min(2).max(150),url:z.string().url(),category:z.string().min(2).max(80),active:z.boolean().default(true),intervalMinutes:z.number().int().min(15).max(43200).default(360),maxScrolls:z.number().int().min(1).max(10000).default(1000),maxProducts:z.number().int().min(1).max(100000).default(10000),scrollWaitMs:z.number().int().min(1500).max(10000).default(2000),idleRounds:z.number().int().min(3).max(30).default(8)}).strict();
function dto(product){
  const ref=product.torobReference,fresh=ref&&!ref.suspicious&&ref.expiresAt>new Date();
  const valid=fresh?(ref.torobOffers||[]).filter(o=>o.available===true&&o.expiresAt>new Date()):[];
  const sellers=new Map();for(const offer of valid.sort((a,b)=>a.priceToman-b.priceToman))if(!sellers.has(offer.sellerKey))sellers.set(offer.sellerKey,offer);
  const quotes=[...sellers.values()],mean=quotes.length?Math.round(quotes.reduce((s,o)=>s+o.priceToman,0)/quotes.length):null;
  const fitments=(product.compatibilities||[]).filter(f=>f.expiresAt>new Date()).map(f=>({...f,car:f.car}));
  return{...product,torobReference:undefined,compatibilities:undefined,fitments,minPriceToman:fresh?ref.priceToman:null,maxPriceToman:fresh?ref.metadata?.maxPriceToman||null:null,avgPriceToman:mean,offerCount:quotes.length,dropPercent:0,dealScore:0,source:'TOROB',sourceUrl:ref?.url,checkedAt:ref?.checkedAt,priceKind:'TOROB_AGGREGATE',reportedOfferCount:ref?.metadata?.reportedOfferCount||0};
}
function registerTorobRoutes({app,prisma,admin,config}){
  const root='/api/v1/market',management='/api/v1/admin/market',activeRef={source:'TOROB',productId:{not:null},results:{some:{query:{active:true,seedUrl:{not:null}}}}};
  const include={brand:true,category:true,torobReference:{include:{torobOffers:true}},compatibilities:{include:{car:true}}};
  async function published(id){const product=await prisma.marketProduct.findFirst({where:{id,active:true,brand:{active:true},category:{active:true},torobReference:{is:activeRef}},include});if(!product)throw new HttpError(404,'Market product not found');return product;}
  for(const[slug,model,where,orderBy]of[['categories','marketCategory',{active:true},{name:'asc'}],['brands','marketBrand',{active:true,products:{some:{torobReference:{is:activeRef}}}},{name:'asc'}]])app.get(root+'/'+slug,async(req,res)=>res.json(await paged(prisma[model],where,pageSchema.parse(req.query),{orderBy})));
  app.get(root+'/cars',async(req,res)=>{const q=pageSchema.extend({q:z.string().max(100).default('')}).parse(req.query);const words=normalize(q.q).split(' ').filter(Boolean);res.json(await paged(prisma.marketCar,words.length?{AND:words.map(word=>({OR:[{key:{contains:word}},{aliases:{has:word}}]}))}:{},q,{orderBy:{key:'asc'}}));});
  const search=pageSchema.extend({q:z.string().max(150).default(''),category:z.string().max(80).optional(),brandId:z.string().uuid().optional(),carId:z.string().uuid().optional(),year:z.coerce.number().int().min(1300).max(2200).optional(),condition:z.enum(['NEW','USED','REFURBISHED','UNKNOWN']).optional(),authenticity:z.enum(['GENUINE','OEM','AFTERMARKET','UNKNOWN']).optional(),min:z.coerce.number().int().nonnegative().optional(),max:z.coerce.number().int().positive().optional(),sort:z.enum(['price','newest','deals']).default('price')});
  async function list(req,res){
    const q=search.parse(req.query),where={active:true,brand:{active:true},category:{active:true},torobReference:{is:{...activeRef,suspicious:false,expiresAt:{gt:new Date()}}}};
    let text=normalize(q.q).replace(/باطری/g,'باتری'),carIds=q.carId?[q.carId]:[];
    if(text&&!q.carId){const mentioned=carMentions(text,await prisma.marketCar.findMany({take:3000}));carIds=[...new Set(mentioned.map(m=>m.car.id))];for(const alias of [...new Set(mentioned.map(m=>m.alias))].sort((a,b)=>b.length-a.length))text=(' '+text+' ').replace(' '+alias+' ',' ').trim();}
    if(text)where.AND=text.split(' ').filter(Boolean).map(word=>({searchText:{contains:word}}));
    if(q.brandId)where.brandId=q.brandId;if(q.condition)where.condition=q.condition;if(q.authenticity)where.authenticity=q.authenticity;
    if(carIds.length||q.year)where.compatibilities={some:{...(carIds.length?{carId:{in:carIds}}:{}),expiresAt:{gt:new Date()},...(q.year?{AND:[{OR:[{yearFrom:{lte:q.year}},{yearFrom:null}]},{OR:[{yearTo:{gte:q.year}},{yearTo:null}]},{OR:q.year<1800?[{yearFrom:{lt:1800}},{yearTo:{lt:1800}}]:[{yearFrom:{gte:1800}},{yearTo:{gte:1800}}]}]}:{})}};
    if(q.category){const rows=await prisma.$queryRaw`WITH RECURSIVE tree AS (SELECT id,0 AS depth FROM "MarketCategory" WHERE slug=${q.category} AND active=true UNION ALL SELECT c.id,t.depth+1 FROM "MarketCategory" c JOIN tree t ON c."parentId"=t.id WHERE c.active=true AND t.depth<20) SELECT id FROM tree LIMIT 10000`;where.categoryId={in:rows.map(r=>r.id)};}
    if(q.min!=null||q.max!=null)where.torobReference.is.priceToman={...(q.min!=null?{gte:q.min}:{}),...(q.max!=null?{lte:q.max}:{})};
    const result=await paged(prisma.marketProduct,where,q,{include,orderBy:q.sort==='newest'?[{createdAt:'desc'},{id:'asc'}]:[{minPriceToman:{sort:'asc',nulls:'last'}},{id:'asc'}]});
    res.set('Cache-Control','no-store').json({...result,items:result.items.map(dto)});
  }
  app.get(root+'/products',list);app.get(root+'/deals',list);
  app.get(root+'/products/:id',async(req,res)=>res.json(dto(await published(req.params.id))));
  app.get(root+'/products/:id/fitments',async(req,res)=>{await published(req.params.id);res.json(await paged(prisma.marketProductCompatibility,{productId:req.params.id,expiresAt:{gt:new Date()}},pageSchema.parse(req.query),{include:{car:true}}));});
  app.get(root+'/products/:id/offers',async(req,res)=>{
    const product=await published(req.params.id),ref=product.torobReference,q=pageSchema.parse(req.query),now=new Date();
    const all=!ref.suspicious&&ref.expiresAt>now?await prisma.torobOffer.findMany({where:{referenceId:ref.id,available:true,expiresAt:{gt:now}},orderBy:[{priceToman:'asc'},{id:'asc'}]}):[];
    const sellers=new Map();for(const offer of all)if(!sellers.has(offer.sellerKey))sellers.set(offer.sellerKey,offer);
    const rows=[...sellers.values()];res.json({items:rows.slice((q.page-1)*q.limit,q.page*q.limit).map(o=>({...o,shippingToman:null,quantity:null,listing:{title:product.name,url:o.url,seller:{id:o.sellerKey,name:o.sellerName,url:o.url,verified:false,reputation:0},source:{kind:'TOROB',name:'ترب'}}})),total:rows.length,page:q.page,limit:q.limit});
  });
  app.get(root+'/products/:id/history',async(req,res)=>{
    const product=await published(req.params.id),q=pageSchema.extend({days:z.coerce.number().int().min(1).max(730).default(30)}).parse(req.query),after=new Date(Date.now()-q.days*86400000);
    const daily=await prisma.$queryRaw`SELECT to_char("checkedAt"::date,'YYYY-MM-DD') AS day,MIN("priceToman")::int AS min,MAX("priceToman")::int AS max,ROUND(AVG("priceToman"))::int AS average FROM "MarketReferenceSnapshot" WHERE "referenceId"=${product.torobReference.id} AND "checkedAt">=${after} GROUP BY 1 ORDER BY 1`;
    const stats=await prisma.marketReferenceSnapshot.aggregate({where:{referenceId:product.torobReference.id,checkedAt:{gte:after}},_avg:{priceToman:true}});
    res.json({daily,statistics:{min:daily.length?Math.min(...daily.map(d=>d.min)):null,max:daily.length?Math.max(...daily.map(d=>d.max)):null,average:stats._avg.priceToman},source:'TOROB'});
  });
  app.get(root+'/discovery',(_req,res)=>res.status(410).json({error:'Torob search discovery replaced by manually configured browse seeds'}));
  app.use(management,admin);
  app.get(management+'/adapters',(_req,res)=>res.json({items:[{id:'torob',name:'Torob Puppeteer + HTTP JSON-LD'}],total:1,page:1,limit:1}));
  app.get(management+'/stats',async(_req,res)=>{const[products,sellers,pending,suspicious,runs]=await Promise.all([prisma.marketReferencePrice.count({where:{productId:{not:null}}}),prisma.torobOffer.groupBy({by:['sellerKey']}),prisma.torobCrawlLink.count({where:{status:'PENDING'}}),prisma.marketReferencePrice.count({where:{suspicious:true}}),prisma.marketDiscoveryQuery.groupBy({by:['status'],where:{seedUrl:{not:null}},_count:true})]);res.json({products,sellers:sellers.length,pending,suspicious,runs});});
  app.get(management+'/sources',async(req,res)=>res.json(await paged(prisma.marketDiscoveryQuery,{seedUrl:{not:null}},pageSchema.parse(req.query),{include:{_count:{select:{links:true}}},orderBy:{createdAt:'desc'}})));
  for(const method of['post','put'])app[method](management+'/sources'+(method==='put'?'/:id':''),async(req,res)=>{
    const input=seedSchema.parse(req.body),seed=torobUrl(input.url,'browse');
    if(!await prisma.marketCategory.findUnique({where:{slug:input.category}}))throw new HttpError(400,'Unknown automotive category');
    const data={query:input.name,seedUrl:seed.url,key:hash('torob-browse:'+seed.id),category:input.category,active:input.active,intervalMinutes:input.intervalMinutes,maxScrolls:input.maxScrolls,maxProducts:input.maxProducts,scrollWaitMs:input.scrollWaitMs,idleRounds:input.idleRounds,nextRunAt:new Date(),status:'QUEUED',lastError:null};
    res.status(method==='post'?201:200).json(method==='post'?await prisma.marketDiscoveryQuery.create({data}):await prisma.marketDiscoveryQuery.update({where:{id:req.params.id},data:{...data,generation:{increment:1}}}));
  });
  app.post(management+'/sources/:id/crawl',async(req,res)=>{const seed=await prisma.marketDiscoveryQuery.findUnique({where:{id:req.params.id}});if(!seed?.active||!seed.seedUrl)throw new HttpError(409,'Torob source is inactive');res.status(202).json(await prisma.marketDiscoveryQuery.update({where:{id:seed.id},data:{status:'QUEUED',generation:{increment:1},nextRunAt:new Date()}}));});
  for(const[slug,model,where,extra]of[['runs','marketDiscoveryQuery',{seedUrl:{not:null}},{include:{_count:{select:{links:true}}}}],['listings','torobCrawlLink',{},{}],['products','marketProduct',{torobReference:{is:{productId:{not:null}}}},{include:{brand:true,category:true}}],['cars','marketCar',{},{}],['categories','marketCategory',{},{}],['brands','marketBrand',{},{}],['compatibilities','marketProductCompatibility',{}, {include:{car:true,product:true}}],['rules','marketCompatibilityRule',{},{}]])app.get(management+'/'+slug,async(req,res)=>res.json(await paged(prisma[model],where,pageSchema.parse(req.query),{...extra,orderBy:{id:'desc'}})));
  app.get(management+'/runs/:id/logs',async(req,res)=>res.json(await paged(prisma.torobCrawlLink,{queryId:req.params.id,lastError:{not:null}},pageSchema.parse(req.query),{orderBy:{updatedAt:'desc'}})));
  app.get(management+'/suspicious',async(req,res)=>res.json(await paged(prisma.marketReferencePrice,{suspicious:true,productId:{not:null}},pageSchema.parse(req.query),{orderBy:{checkedAt:'desc'}})));
  app.patch(management+'/references/:id',async(req,res)=>{
    const input=z.object({clearSuspicion:z.literal(true),note:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
    res.json(await prisma.$transaction(async tx=>{
      const ref=await tx.marketReferencePrice.update({where:{id:req.params.id},data:{suspicious:false}});
      if(ref.productId)await tx.marketProduct.update({where:{id:ref.productId},data:{minPriceToman:ref.expiresAt>new Date()?ref.priceToman:null}});
      await tx.marketAuditLog.create({data:{actor:'admin:'+(config.ADMIN_USERNAME||'admin'),action:'TOROB_PRICE_REVIEW',entityId:ref.id,note:input.note}});return ref;
    }));
  });
  app.post(management+'/runs/:id/cancel',async(req,res)=>{await prisma.marketDiscoveryQuery.update({where:{id:req.params.id},data:{active:false,status:'CANCELLED',generation:{increment:1}}});res.status(204).end();});
  app.post(management+'/rules',async(req,res)=>{
    const input=z.object({name:z.string().min(3).max(150),category:z.string().min(2).max(80),carKeys:z.array(z.string().max(300)).min(1).max(100),requirements:z.record(z.string().max(80),z.union([z.string().max(100),z.number()])),evidenceUrl:z.string().url(),verified:z.boolean(),checkedAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict().parse(req.body);
    if(!input.evidenceUrl.startsWith('https://')||Date.parse(input.expiresAt)<=Date.now()||Date.parse(input.checkedAt)>Date.now()+60000)throw new HttpError(400,'Valid compatibility evidence is required');
    if(input.verified&&input.category==='batteries'&&!['capacityAh','voltage','caseCode','polarity','technology','lengthMm','widthMm','heightMm'].every(k=>input.requirements[k]!=null))throw new HttpError(400,'Battery compatibility requires all technical specifications');
    const keys=[...new Set(input.carKeys)];if(await prisma.marketCar.count({where:{key:{in:keys}}})!==keys.length)throw new HttpError(400,'Unknown vehicle in compatibility rule');
    res.status(201).json(await prisma.marketCompatibilityRule.create({data:{...input,checkedAt:new Date(input.checkedAt),expiresAt:new Date(input.expiresAt)}}));
  });
  // Former generic connector and seller-review mutations are no longer exposed.
  app.all(management+'/{*path}',(_req,res)=>res.status(410).json({error:'Only Torob crawl management is available'}));
  return{published};
}
module.exports={registerTorobRoutes,pageSchema,paged,seedSchema,dto};
