const {z}=require('zod');
const multer=require('multer');const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {HttpError,hash}=require('../domain');
const {createHall,listingDto,include,lock}=require('./service');
const {draftSchema,priceInput,planSchema,bannerSchema,normalize,phone}=require('./domain');
const uuid=z.string().uuid(),pageSchema=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(48).default(12)});
const pagination=q=>({skip:(q.page-1)*q.limit,take:q.limit});
function registerHall({app,prisma,redis,config,auth,admin,limit,io}){
  const service=createHall(prisma,config),root='/api/v1/hall',management='/api/v1/admin/hall';
  app.use(management,admin);
  require('./chat').registerChat({app,prisma,redis,auth,limit,io});
  const captcha=require('./captcha').createCaptcha(redis);
  const catalog=async()=>{await service.ready();const[plans,banners]=await Promise.all([prisma.hallPlan.findMany({where:{active:true},orderBy:{sortOrder:'asc'}}),prisma.hallBanner.findMany({where:{active:true},orderBy:[{sortOrder:'asc'},{id:'asc'}]})]);return{plans,banners,paymentMode:'sandbox',tariffNotice:'تعرفه‌های جاری این محیط برای پرداخت آزمایشی هستند؛ وجه واقعی دریافت نمی‌شود.'};};
  app.get(root+'/catalog',async(_req,res)=>res.json(await catalog()));
  app.get(root+'/vehicles',async(req,res)=>{
    const q=z.object({q:z.string().max(100).default(''),make:z.string().max(100).optional(),model:z.string().max(100).optional()}).parse(req.query);
    const rows=await prisma.marketCar.findMany({where:{...(q.make?{maker:q.make}:{}),...(q.model?{model:q.model}:{}),...(q.q?{OR:[{key:{contains:normalize(q.q)}},{aliases:{has:normalize(q.q)}}]}:{})},select:{maker:true,model:true,trim:true},orderBy:{key:'asc'},take:500});res.json({items:rows});
  });
  app.get(root+'/listings',async(req,res)=>{
    const q=pageSchema.extend({q:z.string().max(150).default(''),make:z.string().max(100).optional(),model:z.string().max(100).optional(),city:z.string().max(100).optional(),min:z.coerce.number().int().min(0).max(1000000000000).optional(),max:z.coerce.number().int().min(0).max(1000000000000).optional(),yearMin:z.coerce.number().int().min(1300).max(2100).optional(),yearMax:z.coerce.number().int().min(1300).max(2100).optional(),mileageMax:z.coerce.number().int().min(0).max(2000000).optional(),inspection:z.enum(['VERIFIED']).optional(),sort:z.enum(['newest','price_asc','price_desc','mileage']).default('newest')}).parse(req.query);
    const where={status:'PUBLISHED',...(q.q?{AND:normalize(q.q).split(' ').filter(Boolean).map(word=>({searchText:{contains:word}}))}:{}),...(q.make?{makeKey:normalize(q.make)}:{}),...(q.model?{modelKey:normalize(q.model)}:{}),...(q.city?{city:{contains:q.city}}:{}),...(q.min!=null||q.max!=null?{priceToman:{...(q.min!=null?{gte:BigInt(q.min)}:{}),...(q.max!=null?{lte:BigInt(q.max)}:{})}}:{}),...(q.yearMin||q.yearMax?{year:{...(q.yearMin?{gte:q.yearMin}:{}),...(q.yearMax?{lte:q.yearMax}:{})}}:{}),...(q.mileageMax!=null?{mileage:{lte:q.mileageMax}}:{}),...(q.inspection?{inspectionStatus:q.inspection}:{})};
    const orderBy=q.sort==='price_asc'?{priceToman:'asc'}:q.sort==='price_desc'?{priceToman:'desc'}:q.sort==='mileage'?{mileage:'asc'}:{bumpedAt:'desc'};
    const[items,total]=await Promise.all([prisma.hallListing.findMany({where,...pagination(q),include,orderBy:[orderBy,{id:'desc'}]}),prisma.hallListing.count({where})]);
    // Apply the same filters to promotions; rotation is stable for ten minutes and unique in one response.
    const featured=await prisma.hallListing.findMany({where:{...where,OR:[{featuredUntil:{gt:new Date()}},{ladderUntil:{gt:new Date()}},{urgentUntil:{gt:new Date()}}]},include,take:120,orderBy:{bumpedAt:'desc'}});
    const offset=(Math.floor(Date.now()/600000)+q.page*6)%Math.max(1,featured.length),rotated=[...featured.slice(offset),...featured.slice(0,offset)];
    res.set('Cache-Control','no-store').json({items:items.map(r=>listingDto(r)),featured:rotated.map(r=>listingDto(r)),total,page:q.page,limit:q.limit});
  });
  app.get(root+'/mine',auth,async(req,res)=>{
    const q=pageSchema.parse(req.query),where={ownerId:req.user.id,status:{not:'DELETED'}};const[items,total]=await Promise.all([prisma.hallListing.findMany({where,...pagination(q),include:{...include,_count:{select:{inquiries:true}}},orderBy:{updatedAt:'desc'}}),prisma.hallListing.count({where})]);res.set('Cache-Control','no-store').json({items:items.map(r=>listingDto(r,true)),total,...q});
  });
  app.post(root+'/mine',auth,limit('hall-draft',20,3600),async(req,res)=>{
    const draft=draftSchema.parse(req.body);res.status(201).json(listingDto(await prisma.hallListing.create({data:{ownerId:req.user.id,draft},include}),true));
  });
  app.get(root+'/mine/:id',auth,async(req,res)=>res.set('Cache-Control','no-store').json(listingDto(await service.owned(uuid.parse(req.params.id),req.user.id),true)));
  app.patch(root+'/mine/:id',auth,async(req,res)=>{const input=z.object({version:z.number().int().nonnegative(),details:draftSchema}).strict().parse(req.body);res.json(await service.save(uuid.parse(req.params.id),req.user.id,input.details,input.version));});
  app.post(root+'/estimate',auth,limit('hall-estimate',40,60),async(req,res)=>res.json(await service.estimate(priceInput.parse(req.body),req.user.id)));
  app.post(root+'/mine/:id/captcha',auth,limit('hall-captcha',12,600),async(req,res)=>{const id=uuid.parse(req.params.id);await service.owned(id,req.user.id);res.set('Cache-Control','no-store').json(await captcha.issue(req.user.id,id));});
  app.post(root+'/mine/:id/captcha/solve',auth,limit('hall-captcha-solve',12,600),async(req,res)=>{const input=z.object({id:uuid,x:z.number().min(0).max(280)}).strict().parse(req.body);res.json(await captcha.solve(req.user.id,uuid.parse(req.params.id),input));});
  app.post(root+'/mine/:id/publish',auth,limit('hall-publish',20,3600),async(req,res)=>{const id=uuid.parse(req.params.id),input=z.object({proof:uuid}).strict().parse(req.body);await captcha.consume(req.user.id,id,input.proof);res.json(await service.freePublish(id,req.user.id));});
  app.delete(root+'/mine/:id',auth,async(req,res)=>{await service.remove(uuid.parse(req.params.id),req.user.id);res.status(204).end();});
  app.post(root+'/mine/:id/checkout',auth,limit('hall-checkout',20,3600),async(req,res)=>{
    const input=z.object({planCode:z.enum(['MANAGED','REPAIR_SELL','EXPRESS48','LADDER','URGENT','FEATURED']),idempotencyKey:uuid}).strict().parse(req.body);
    if(['MANAGED','REPAIR_SELL','EXPRESS48'].includes(input.planCode))throw new HttpError(409,'در حال تکمیل بخش فنی');
    res.status(201).json(await service.checkout(req.user,uuid.parse(req.params.id),input));
  });
  app.get(root+'/mine/:id/inquiries',auth,async(req,res)=>{await service.owned(uuid.parse(req.params.id),req.user.id);res.set('Cache-Control','no-store').json({items:await prisma.hallInquiry.findMany({where:{listingId:req.params.id},orderBy:{createdAt:'desc'},take:100})});});
  app.get(root+'/mine/:id/orders',auth,async(req,res)=>{await service.owned(uuid.parse(req.params.id),req.user.id);res.set('Cache-Control','no-store').json({items:(await prisma.hallOrder.findMany({where:{listingId:req.params.id},orderBy:{createdAt:'desc'}})).map(service.orderDto)});});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0}});
  app.post(root+'/mine/:id/photos',auth,limit('hall-photo',60,3600),(req,res,next)=>upload.single('file')(req,res,error=>next(error?new HttpError(400,'تصویر JPEG یا PNG تا ۵ مگابایت انتخاب کنید.'):undefined)),async(req,res)=>{
    const id=uuid.parse(req.params.id),buffer=req.file?.buffer;
    const mimeType=buffer?.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':buffer?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;
    if(!mimeType)throw new HttpError(400,'تصویر JPEG یا PNG با حجم کمتر از ۵ مگابایت انتخاب کنید.');
    const key='hall-'+randomUUID(),filename=path.resolve(config.UPLOAD_DIR,key);await fs.mkdir(config.UPLOAD_DIR,{recursive:true});await fs.writeFile(filename,buffer,{flag:'wx',mode:0o600});
    try{const photo=await prisma.$transaction(async tx=>{await lock(tx,id);const row=await service.owned(id,req.user.id,tx);await service.editable(tx,row);if(row.photos.length>=5)throw new HttpError(400,'حداکثر ۵ تصویر مجاز است.');return tx.hallPhoto.create({data:{listingId:id,storageKey:key,mimeType,position:row.photos.length}});});res.status(201).json({id:photo.id,url:`/hall/photos/${photo.id}?token=${photo.readToken}`});}catch(e){await fs.unlink(filename).catch(()=>{});throw e;}
  });
  app.delete(root+'/mine/:id/photos/:photoId',auth,async(req,res)=>{
    const id=uuid.parse(req.params.id),photoId=uuid.parse(req.params.photoId);
    const photo=await prisma.$transaction(async tx=>{await lock(tx,id);const row=await service.owned(id,req.user.id,tx);await service.editable(tx,row);if(row.status==='PUBLISHED'&&row.photos.length<=1)throw new HttpError(400,'حداقل یک تصویر باید باقی بماند.');const photo=row.photos.find(p=>p.id===photoId);if(!photo)throw new HttpError(404,'تصویر پیدا نشد.');await tx.hallPhoto.delete({where:{id:photoId}});return photo;});await fs.unlink(path.resolve(config.UPLOAD_DIR,photo.storageKey)).catch(()=>{});res.status(204).end();
  });
  app.get(root+'/photos/:id',async(req,res)=>{
    const photo=await prisma.hallPhoto.findUnique({where:{id:uuid.parse(req.params.id)},include:{listing:{select:{status:true}}}});
    if(!photo||photo.listing.status!=='PUBLISHED'&&req.query.token!==photo.readToken)throw new HttpError(404,'تصویر پیدا نشد.');
    res.set({'Content-Type':photo.mimeType,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'cross-origin'});res.send(await fs.readFile(path.resolve(config.UPLOAD_DIR,photo.storageKey)));
  });
  app.get(root+'/listings/:id',async(req,res)=>{const row=await prisma.hallListing.findFirst({where:{id:uuid.parse(req.params.id),status:'PUBLISHED'},include});if(!row)throw new HttpError(404,'آگهی پیدا نشد.');res.json(listingDto(row));});
  app.post(root+'/listings/:id/view',limit('hall-view',100,60),async(req,res)=>{const id=uuid.parse(req.params.id);if(await redis.set('hall:view:'+id+':'+hash(req.ip+String(req.headers['user-agent'])),'1','EX',86400,'NX'))await prisma.hallListing.updateMany({where:{id,status:'PUBLISHED'},data:{viewCount:{increment:1}}});res.status(204).end();});
  app.post(root+'/listings/:id/inquiries',auth,limit('hall-inquiry',10,3600),async(req,res)=>{
    const id=uuid.parse(req.params.id),input=z.object({message:z.string().trim().min(5).max(1000),contactPhone:phone}).strict().parse(req.body);
    const row=await prisma.hallListing.findFirst({where:{id,status:'PUBLISHED'}});if(!row||row.ownerId===req.user.id)throw new HttpError(404,'آگهی قابل درخواست نیست.');
    await prisma.hallInquiry.upsert({where:{listingId_userId:{listingId:id,userId:req.user.id}},create:{listingId:id,userId:req.user.id,...input},update:input});res.json({contactPhone:row.draft.contactPhone,message:'درخواست خرید برای مالک ثبت شد.'});
  });
  async function ownedOrder(req){const order=await prisma.hallOrder.findFirst({where:{id:uuid.parse(req.params.id),userId:req.user.id}});if(!order)throw new HttpError(404,'پرداخت پیدا نشد.');return order;}
  app.get(root+'/orders/:id',auth,async(req,res)=>res.set('Cache-Control','no-store').json(service.orderDto(await ownedOrder(req))));
  app.post(root+'/orders/:id/verify',auth,limit('hall-verify',20,3600),async(req,res)=>{const o=await ownedOrder(req);res.json(service.orderDto(await service.verify(o.id,o.authority,'OK')));});
  app.post(root+'/orders/:id/cancel',auth,async(req,res)=>{const o=await ownedOrder(req);if(!o.authority)throw new HttpError(409,'درخواست درگاه هنوز در حال پردازش است.');res.json(service.orderDto(await service.verify(o.id,o.authority,'NOK')));});
  app.get(root+'/payments/callback',limit('hall-callback',120,60),async(req,res)=>{
    const q=z.object({order:uuid,Authority:z.string().regex(/^[AS][A-Za-z0-9]{35}$/),Status:z.enum(['OK','NOK'])}).parse(req.query);
    const order=await prisma.hallOrder.findUnique({where:{id:q.order}});if(!order||order.authority!==q.Authority)throw new HttpError(404,'پرداخت پیدا نشد.');
    try{await service.verify(order.id,q.Authority,q.Status);}catch(e){if(!(e instanceof HttpError))throw e;}
    const target=new URL('/hall/payment',config.CUSTOMER_APP_URL||'https://app.khodrochare.ir');target.searchParams.set('order',order.id);res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).redirect(303,target.href);
  });
  app.get(management+'/settings',async(_req,res)=>{await service.ready();res.json({plans:await prisma.hallPlan.findMany({orderBy:{sortOrder:'asc'}}),banners:await prisma.hallBanner.findMany({orderBy:{sortOrder:'asc'}})});});
  app.put(management+'/plans/:code',async(req,res)=>{await service.ready();const input=planSchema.parse(req.body);if(input.code!==req.params.code)throw new HttpError(400,'کد طرح معتبر نیست.');res.json(await prisma.hallPlan.upsert({where:{code:input.code},create:input,update:input}));});
  app.post(management+'/banners',async(req,res)=>res.status(201).json(await prisma.hallBanner.create({data:bannerSchema.parse(req.body)})));
  app.put(management+'/banners/:id',async(req,res)=>res.json(await prisma.hallBanner.update({where:{id:uuid.parse(req.params.id)},data:bannerSchema.parse(req.body)})));
  app.get(management+'/listings',async(req,res)=>{const q=pageSchema.parse(req.query);res.json({items:(await prisma.hallListing.findMany({...pagination(q),include:{...include,_count:{select:{inquiries:true}}},orderBy:{createdAt:'desc'}})).map(r=>listingDto(r,true)),total:await prisma.hallListing.count(),...q});});
  app.get(management+'/orders',async(req,res)=>{const q=pageSchema.parse(req.query);res.json({items:await prisma.hallOrder.findMany({...pagination(q),orderBy:{createdAt:'desc'}}),total:await prisma.hallOrder.count(),...q});});
  app.patch(management+'/listings/:id',async(req,res)=>{
    const input=z.object({status:z.enum(['PUBLISHED','BLOCKED','SOLD']).optional(),inspectionStatus:z.enum(['NOT_INSPECTED','VERIFIED']).optional(),inspectionNote:z.string().max(2000).optional()}).strict().parse(req.body),id=uuid.parse(req.params.id);
    const row=await prisma.$transaction(async tx=>{await lock(tx,id);const old=await tx.hallListing.findUnique({where:{id}});if(!old)throw new HttpError(404,'آگهی پیدا نشد.');if(input.status==='PUBLISHED'&&!old.publishedAt)throw new HttpError(409,'پیش‌نویس باید توسط مالک منتشر شود.');const result=await tx.hallListing.update({where:{id},data:input,include});await tx.marketAuditLog.create({data:{actor:'admin',action:'HALL_LISTING_REVIEW',entityId:id,note:JSON.stringify(input)}});return result;});res.json(listingDto(row,true));
  });
  app.get(management+'/plans',async(_req,res)=>{await service.ready();res.json({items:await prisma.hallPlan.findMany({orderBy:{sortOrder:'asc'}})});});
  app.put(management+'/plans/:code',async(req,res)=>{
    await service.ready();const data=planSchema.parse(req.body);if(data.code!==req.params.code)throw new HttpError(400,'کد طرح معتبر نیست.');
    const result=await prisma.$transaction(async tx=>{const result=await tx.hallPlan.upsert({where:{code:data.code},create:data,update:data});await tx.marketAuditLog.create({data:{actor:'admin',action:'HALL_PLAN_EDIT',entityId:data.code,note:JSON.stringify(data)}});return result;});res.json(result);
  });
  app.get(management+'/banners',async(_req,res)=>{await service.ready();res.json({items:await prisma.hallBanner.findMany({orderBy:{sortOrder:'asc'}})});});
  for(const method of ['post','put'])app[method](management+'/banners'+(method==='put'?'/:id':''),async(req,res)=>{
    const data=bannerSchema.parse(req.body);res.json(method==='post'?await prisma.hallBanner.create({data}):await prisma.hallBanner.update({where:{id:uuid.parse(req.params.id)},data}));
  });
  app.get(management+'/listings',async(req,res)=>{
    const q=pageSchema.extend({status:z.enum(['DRAFT','PUBLISHED','BLOCKED','SOLD']).optional()}).parse(req.query),where=q.status?{status:q.status}:{};
    const[rows,total]=await Promise.all([prisma.hallListing.findMany({where,...pagination(q),include:{...include,owner:{select:{fullName:true,phone:true}}},orderBy:{updatedAt:'desc'}}),prisma.hallListing.count({where})]);res.json({items:rows.map(r=>listingDto(r,true)),total,...q});
  });
  app.get(management+'/orders',async(req,res)=>{
    const q=pageSchema.parse(req.query);const[items,total]=await Promise.all([prisma.hallOrder.findMany({...pagination(q),include:{user:{select:{fullName:true,phone:true}}},orderBy:{createdAt:'desc'}}),prisma.hallOrder.count()]);res.json({items,total,...q});
  });
  app.post(management+'/orders/:id/verify',async(req,res)=>{const order=await prisma.hallOrder.findUnique({where:{id:uuid.parse(req.params.id)}});if(!order?.authority)throw new HttpError(404,'پرداخت پیدا نشد.');res.json(service.orderDto(await service.verify(order.id,order.authority,'OK')));});
  app.patch(management+'/orders/:id',async(req,res)=>{const data=z.object({supportNote:z.string().max(2000)}).strict().parse(req.body);res.json(await prisma.hallOrder.update({where:{id:uuid.parse(req.params.id)},data}));});
  return service;
}
module.exports={registerHall};
