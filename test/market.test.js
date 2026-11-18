const{test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const m=require('../src/market/domain');
const {publicIp,destination,robotsAllowed}=require('../src/market/network');
const adapters=require('../src/market/adapters');
const {validOfferWhere}=require('../src/market/service');
const feed=JSON.parse(fs.readFileSync(require.resolve('./fixtures/market/partner-feed.json'),'utf8'));
test('market money preserves currencies and Persian/Arabic digits without guessing or rounding',()=>{
  assert.equal(m.money('۹۵۰٬۰۰۰','IRT'),950000);assert.equal(m.money('١١٠٠٠٠٠٠','IRR'),1100000);
  for(const[value,currency]of[['-1','IRT'],['0','IRT'],['9','IRR'],['12.5','IRT'],['123','USD'],['NaN','IRT'],['3e8','IRT']])assert.throws(()=>m.money(value,currency));
});
test('product matching never merges a conflicting brand, trim, condition, authenticity or technical code',()=>{
  const listing=m.listingSchema.parse(feed.items[0]);const product={...listing,name:'لنت جلو 206 تیپ5'};
  assert.equal(m.match(listing,product).auto,true);
  for(const change of [{brand:'Other'},{condition:'USED'},{authenticity:'UNKNOWN'},{partNumber:'WRONG'},{fitments:[{...listing.fitments[0],trim:'تیپ ۲'}]},{specifications:{محور:'عقب'}}])assert.equal(m.match(listing,{...product,...change}).auto,false);
  assert.equal(m.match({...listing,partNumber:undefined}, {...product,partNumber:undefined}).auto,false);
  assert.equal(m.identity(listing),m.identity({...listing,name:'نام دیگر'}));
  assert.notEqual(m.identity({...listing,partNumber:undefined,name:'لنت جلو'}),m.identity({...listing,partNumber:undefined,name:'لنت عقب'}));
});
test('sources require an explicit, unexpired agreement before activation and secrets stay references',()=>{
  const source={name:'Fixture supplier',kind:'SUPPLIER',adapter:'torob',baseUrl:'https://catalog.fixture-shop.ir/',allowedHosts:['catalog.fixture-shop.ir'],config:{path:'/feed.json'}};
  assert.equal(m.validateSource(source).active,false);
  assert.throws(()=>m.validateSource({...source,active:true}));
  assert.throws(()=>m.validateSource({...source,secretEnv:'DATABASE_URL'}));
  assert.throws(()=>m.validateSource({...source,config:{path:'//evil.fixture-shop.ir/feed.json'}}));
  assert.equal(m.validateSource({...source,active:true,licenseUrl:'https://catalog.fixture-shop.ir/agreement',permissionExpiresAt:new Date(Date.now()+86400000).toISOString()}).active,true);
});
test('SSRF validation rejects local, link-local, metadata, reserved IPv6 and DNS rebinding destinations',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','2001:0db8::1','2002:7f00:1::'])assert.equal(publicIp(ip),false,ip);
  assert.equal(publicIp('8.8.8.8'),true);assert.equal(publicIp('2001:4860:4860::8888'),true);
  await assert.rejects(destination('https://catalog.fixture-shop.ir/feed',['catalog.fixture-shop.ir'],async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
  await assert.rejects(destination('https://evil.fixture-shop.ir/feed',['catalog.fixture-shop.ir']));
  for(const url of ['http://catalog.fixture-shop.ir','https://user:password@catalog.fixture-shop.ir','https://127.0.0.1','https://catalog.fixture-shop.ir:8443'])assert.throws(()=>m.safeUrl(url));
});
test('robots honors agent specificity, wildcards, longest path and crawl delay',()=>{
  const text='User-agent: *\nDisallow: /\nUser-agent: KhodrochareMarketBot\nDisallow: /private/*\nAllow: /private/public\nCrawl-delay: 5';
  assert.equal(robotsAllowed(text,'/products').allowed,true);assert.equal(robotsAllowed(text,'/private/x').allowed,false);assert.equal(robotsAllowed(text,'/private/public/a').allowed,true);assert.equal(robotsAllowed(text,'/products').delayMs,5000);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /*?token=','/p?token=secret').allowed,false);
});
test('only Torob remains in the connector registry',()=>assert.deepEqual(Object.keys(adapters),['torob']));

test('comparison publishes active sellers automatically; deal endorsements remain separate',()=>{
  const where=validOfferWhere();assert.equal(where.suspicious,false);assert.equal(where.inStock,true);assert.equal(where.listing.matchStatus,'APPROVED');assert.equal(where.listing.seller.verified,undefined);assert.equal(where.listing.seller.active,true);assert.ok(where.listing.source.permissionExpiresAt.gt instanceof Date);
  assert.deepEqual(m.compare([{priceToman:100},{priceToman:200}]),{min:100,max:200,average:150,spreadPercent:67});
  assert.equal(m.deal({offers:[{priceToman:100}],seller:{verified:true,reputation:90},previousLow:200}).score,0);
  assert.equal(m.deal({offers:[{priceToman:100},{priceToman:200}],seller:{verified:false,reputation:100},previousLow:200}).score,0);
  assert.equal(m.deal({offers:[{priceToman:100},{priceToman:200}],seller:{verified:true,reputation:80},previousLow:200}).dropPercent,50);
});
test('market HTTP routes isolate admin mutations and user alerts and validate source/query input',async t=>{
  const {createApp}=require('../src/app');let seen;
  const app=createApp({config:{TRUST_PROXY:0,origins:[],ADMIN_PASSWORD_HASH:'configured',LOCATION_MAX_AGE_SECONDS:120},redis:{eval:async()=>1,get:async()=>null,set:async()=>{}},io:{},prisma:{marketCategory:{findMany:async()=>[],count:async()=>0},marketAlert:{updateMany:async({where})=>{seen=where;return{count:0};}}},services:{authenticate:async token=>{if(token!=='customer')throw Object.assign(new Error('Authentication required'),{status:401});return{id:'customer',role:'CUSTOMER'};}}});
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const call=(path,method='GET',body,token)=>fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body==null?undefined:JSON.stringify(body)});
  assert.equal((await call('/market/categories')).status,200);assert.equal((await call('/market/products?limit=10001')).status,400);
  assert.equal((await call('/admin/market/sources','POST',{},'customer')).status,401);
  assert.equal((await call('/market/alerts','POST',{})).status,401);
  assert.equal((await call('/market/alerts/not-owned','PATCH',{active:false},'customer')).status,404);assert.equal(seen.userId,'customer');
});

test('crawler fixture pages checkpoint progress and isolate malformed listings without network access',async()=>{
  const {createCrawler}=require('../src/market/crawler');
  const source={id:'s',active:true,licenseUrl:'https://catalog.fixture-shop.ir/agreement',permissionExpiresAt:new Date(Date.now()+86400000),adapter:'torob',updatedAt:new Date(),maxPages:10,config:{path:'/feed'}};
  const state={id:'run',source,status:'QUEUED',cursor:null,pages:0,processed:0,errors:0};const logs=[],ingested=[];
  const prisma={marketCrawlRun:{findUnique:async()=>({...state}),update:async({data})=>{for(const[k,v]of Object.entries(data))state[k]=v&&typeof v==='object'&&'increment'in v?(state[k]||0)+v.increment:v;}},marketSource:{findUnique:async()=>source,update:async()=>{}},marketOffer:{updateMany:async()=>{}},marketCrawlLog:{create:async({data})=>logs.push(data)}};
  prisma.$transaction=fn=>fn(prisma);prisma.$queryRaw=async()=>[];
  const runner=createCrawler({prisma,service:{ingest:async(_s,_run,item)=>{if(item.invalid)throw new Error('BAD_ITEM');ingested.push(item.externalId);return['product'];},refreshProduct:async()=>{}},network:{},adapters:{'torob':{page:async({cursor})=>cursor?{items:[feed.items[1]],next:null}:{items:[feed.items[0],{externalId:'bad',invalid:true}],next:'second'}}}});
  await runner({data:{runId:'run'}});
  assert.equal(state.status,'SUCCEEDED');assert.equal(state.pages,2);assert.equal(state.errors,1);assert.equal(state.processed,2);assert.equal(logs.length,1);assert.deepEqual(ingested,['a-1','b-1']);
});
test('a disabled or unlicensed source never reaches an adapter',async()=>{
  const {createCrawler}=require('../src/market/crawler');let called=false;
  const runner=createCrawler({prisma:{marketCrawlRun:{findUnique:async()=>({id:'r',status:'QUEUED',source:{active:false}})}},service:{},network:{},adapters:{'torob':{page:async()=>{called=true;}}}});
  await assert.rejects(runner({data:{runId:'r'}}),/SOURCE_PERMISSION_REQUIRED/);assert.equal(called,false);
});

test('offer SQL deduplicates canonical sellers and keeps IDs parameterized',async()=>{
  const{offerStatistics,offerIds}=require('../src/market/offers');let query;
  const prisma={$queryRaw:async q=>{query=q;return[];}};
  const id="fixture'); DROP TABLE anything; --";
  await offerStatistics(prisma,[id]);assert.ok(query.text.includes('ROW_NUMBER'));assert.ok(query.text.includes('l."sellerId"'));assert.ok(query.values.includes(id));assert.equal(query.text.includes(id),false);
  await offerIds(prisma,'fixture',10,20);assert.ok(query.values.includes(10));assert.ok(query.values.includes(20));
});
test('ingest retains manual metadata, clears unknown quantity and keeps suspicious prices flagged',async()=>{
  const{createMarketService}=require('../src/market/service');const original=m.listingSchema.parse(feed.items[0]);let listing=null,offer=null;const snapshots=new Map();
  const canonical={...original,id:'product',brand:{name:original.brand},category:{slug:original.category},fitmentSignature:m.fitmentSignature(original.fitments)};
  const tx={$queryRaw:async()=>[],marketProduct:{findMany:async()=>[canonical]},marketSeller:{upsert:async()=>({id:'seller',domain:new URL(original.seller.url).hostname})},marketListing:{findUnique:async()=>listing?{...listing,offer}:null,upsert:async({create,update})=>(listing=listing?{...listing,...update}:{id:'listing',...create})},marketOffer:{upsert:async({create,update})=>(offer=offer?{...offer,...update}:{id:'offer',...create})},marketPriceSnapshot:{upsert:async({where,create})=>{const key=JSON.stringify(where);if(!snapshots.has(key))snapshots.set(key,create);}},marketMatchReview:{upsert:async()=>{}}};
  const service=createMarketService({$transaction:fn=>fn(tx)}),source={id:'source',offerTtlHours:24};
  await service.ingest(source,'run1',original);assert.equal(listing.matchStatus,'APPROVED');assert.equal(offer.quantity,2);
  listing.metadataOverrides={name:'نام اصلاح‌شده قطعه'};
  const noQuantity={...original};delete noQuantity.quantity;
  await service.ingest(source,'run2',noQuantity);assert.equal(listing.title,'نام اصلاح‌شده قطعه');assert.equal(offer.quantity,null);
  await service.ingest(source,'run3',{...noQuantity,price:'100000'});assert.equal(offer.suspicious,true);
  await service.ingest(source,'run4',{...noQuantity,price:'100000'});assert.equal(offer.suspicious,true);
  await service.ingest(source,'run4',{...noQuantity,price:'100000'});assert.equal(snapshots.size,4);
});
test('a credential cannot be sent to a host different from its environment binding',async()=>{
  const{createCrawler}=require('../src/market/crawler');process.env.MARKET_SECRET_UNIT='fixture-secret';process.env.MARKET_SECRET_UNIT_HOST='allowed.fixture-shop.ir';let reached=false;
  try{
    const source={active:true,licenseUrl:'https://allowed.fixture-shop.ir/agreement',permissionExpiresAt:new Date(Date.now()+86400000),adapter:'torob',secretEnv:'MARKET_SECRET_UNIT',baseUrl:'https://another.fixture-shop.ir/'};
    const run=createCrawler({prisma:{marketCrawlRun:{findUnique:async()=>({id:'r',status:'QUEUED',source})}},adapters:{'torob':{page:async()=>{reached=true;}}},service:{},network:{}});
    await assert.rejects(run({data:{runId:'r'}}),/SOURCE_SECRET_HOST_NOT_BOUND/);assert.equal(reached,false);
  }finally{delete process.env.MARKET_SECRET_UNIT;delete process.env.MARKET_SECRET_UNIT_HOST;}
});



test('automatic publication creates a catalog without manual seller approval and isolates uncertain identities',async()=>{
  const{createMarketService}=require('../src/market/service');const products=new Map(),listings=new Map();let sellerCreates=0;
  const tx={$queryRaw:async()=>[],marketCategory:{findUnique:async()=>({id:'category'})},marketBrand:{upsert:async()=>({id:'brand'})},marketCar:{upsert:async()=>({id:'car'})},marketFitment:{upsert:async()=>{}},marketAuditLog:{create:async()=>{}},marketProduct:{findMany:async()=>[],upsert:async({where,create})=>{if(!products.has(where.identityKey))products.set(where.identityKey,{...create,id:'product-'+products.size});return products.get(where.identityKey);}},marketSeller:{upsert:async({create})=>{sellerCreates++;assert.equal(create.verified,undefined);return{id:'seller',domain:create.domain};}},marketListing:{findUnique:async({where})=>listings.get(JSON.stringify(where))||null,upsert:async({where,create,update})=>{const key=JSON.stringify(where),row=listings.has(key)?{...listings.get(key),...update}:{id:'listing-'+listings.size,...create};listings.set(key,row);return row;}},marketOffer:{upsert:async()=>{}},marketPriceSnapshot:{upsert:async()=>{}},marketMatchReview:{upsert:async()=>assert.fail('Automatic publication must not require a manual review')}};
  const service=createMarketService({$transaction:fn=>fn(tx)}),source={id:'source',offerTtlHours:24,config:{automaticPublication:true}};
  await service.ingest(source,'run',feed.items[0]);await service.ingest(source,'run',feed.items[1]);
  assert.equal(products.size,1,'A complete technical identity groups the same part');
  const uncertain={...feed.items[0],externalId:'unknown-a',authenticity:'UNKNOWN',fitments:[]};
  await service.ingest(source,'run',uncertain);await service.ingest(source,'run',{...uncertain,externalId:'unknown-b'});
  assert.equal(products.size,3,'Unknown parts are published separately instead of falsely compared');
  for(const row of listings.values())assert.equal(row.matchStatus,'APPROVED');assert.equal(sellerCreates,4);
});

