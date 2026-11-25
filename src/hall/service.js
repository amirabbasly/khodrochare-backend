const {HttpError}=require('../domain');
const {publicLocation}=require('./location');
const {createZarinpal}=require('../zarinpal');
const {publicationDetails,details,indexFields,analyzePrices,expressEligible,defaultPlans,planSchema,bannerSchema,normalize}=require('./domain');
const include={photos:{orderBy:{position:'asc'}},orders:{where:{status:'VERIFIED',activatedAt:{not:null}},orderBy:{verifiedAt:'desc'}}};
const lock=async(tx,id)=>tx.$queryRaw`SELECT id FROM "HallListing" WHERE id=${id} FOR UPDATE`;
function listingDto(row,owned=false){
  const{ownerId,owner,draft,photos,orders,verifiedContactPhone,reviewedBy,moderationNote,...rest}=row;
  return{...rest,...(owned?{verifiedContactPhone,reviewedBy,moderationNote}:{}),seller:owner?{fullName:owner.fullName}:undefined,priceToman:row.priceToman==null?null:Number(row.priceToman),details:owned?draft:undefined,contactPhone:row.status==='PUBLISHED'||owned?draft.contactPhone:undefined,
    fuelType:draft.fuelType,gearboxType:draft.gearboxType,chassisCondition:draft.chassisCondition,gearboxCondition:draft.gearboxCondition,location:owned?draft.location:publicLocation(draft.location),
    description:row.status==='PUBLISHED'||owned?draft.description:undefined,color:draft.color,
    photos:(photos||[]).map(p=>({id:p.id,url:`/hall/photos/${p.id}`+(owned?`?token=${p.readToken}`:'')})),
    services:(orders||[]).filter(o=>o.activatedAt&&new Date(o.activatedAt.getTime()+o.snapshot.durationHours*3600000)>new Date()).map(o=>({name:o.snapshot.name,code:o.planCode,until:new Date(o.activatedAt.getTime()+o.snapshot.durationHours*3600000),mode:o.mode})),
  };
}
function createHall(prisma,config,provider=createZarinpal({...config,ZARINPAL_MODE:'sandbox'})){
  let boot;
  async function initialize(){
    const plans=config.HALL_PLANS_JSON===undefined?defaultPlans:JSON.parse(config.HALL_PLANS_JSON).map(p=>planSchema.parse(p));
    if(!Array.isArray(plans)||new Set(plans.map(p=>p.code)).size!==plans.length)throw new Error('HALL_PLANS_JSON_INVALID');
    if(!plans.some(p=>p.code==='FREE'))plans.push(defaultPlans.find(p=>p.code==='FREE'));
    const banners=config.HALL_BANNERS_JSON===undefined?null:JSON.parse(config.HALL_BANNERS_JSON).map(p=>bannerSchema.parse(p));
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('hall-settings'))::text AS locked`;
      if(config.HALL_PLANS_JSON!==undefined)await tx.hallPlan.updateMany({where:{code:{notIn:plans.map(p=>p.code)}},data:{active:false}});
      for(const p of plans)await tx.hallPlan.upsert({where:{code:p.code},create:p,update:config.HALL_PLANS_JSON===undefined?{}:p});
      if(banners){await tx.hallBanner.updateMany({data:{active:false}});for(const b of banners)await tx.hallBanner.create({data:b});}
    },{timeout:30000});
  }
  async function ready(){if(!boot)boot=initialize().catch(e=>{boot=null;throw e;});return boot;}
  async function owned(id,userId,tx=prisma){const row=await tx.hallListing.findFirst({where:{id,ownerId:userId},include});if(!row)throw new HttpError(404,'آگهی پیدا نشد.');return row;}
  async function editable(tx,row){
    if(!['DRAFT','PUBLISHED','PENDING_REVIEW','REJECTED'].includes(row.status))throw new HttpError(409,'این آگهی قابل ویرایش نیست.');
    await tx.hallOrder.updateMany({where:{listingId:row.id,status:'CREATING',createdAt:{lt:new Date(Date.now()-120000)}},data:{status:'FAILED',errorCode:'REQUEST_EXPIRED'}});
    const pending=await tx.hallOrder.findFirst({where:{listingId:row.id,status:{in:['CREATING','PENDING']}}});
    if(pending)throw new HttpError(409,'ابتدا پرداخت در جریان را تکمیل یا از بخش پرداخت لغو کنید.');
  }
  async function remove(id,userId){return prisma.$transaction(async tx=>{
    await lock(tx,id);const row=await owned(id,userId,tx);
    if(row.status==='DELETED')return;
    if(['DRAFT','PUBLISHED'].includes(row.status))await editable(tx,row);
    await tx.hallListing.update({where:{id},data:{status:'DELETED',version:{increment:1}}});
  });}
  async function save(id,userId,data,version){return prisma.$transaction(async tx=>{
    await lock(tx,id);const row=await owned(id,userId,tx);await editable(tx,row);
    if(row.status==='PUBLISHED')await assertContact(tx,row,data);
    if(row.status==='PUBLISHED')details.required({priceToman:true}).parse(data);
    if(row.version!==version)throw new HttpError(409,'پیش‌نویس در جای دیگری تغییر کرده است؛ دوباره آن را باز کنید.');
    return listingDto(await tx.hallListing.update({where:{id},data:{draft:data,...indexFields(data),...(row.status==='PUBLISHED'?{status:'PENDING_REVIEW',submittedAt:new Date(),reviewedAt:null,reviewedBy:null,moderationNote:null,inspectionStatus:'NOT_INSPECTED',inspectionNote:null}:{}),version:{increment:1}},include}),true);
  });}
  async function photosChanged(tx,row){
    await tx.hallListing.update({where:{id:row.id},data:{version:{increment:1},...(['PUBLISHED','PENDING_REVIEW'].includes(row.status)?{status:'PENDING_REVIEW',submittedAt:new Date(),reviewedAt:null,reviewedBy:null,moderationNote:null,inspectionStatus:'NOT_INSPECTED',inspectionNote:null}:{})}});
  }
  async function validatePublish(tx,row){
    const data=publicationDetails.parse(row.draft);
    await assertContact(tx,row,data);
    const year=data.year<1800?Number(new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric'}).formatToParts(new Date()).find(p=>p.type==='year')?.value):new Date().getUTCFullYear();
    if(data.year>year+1)throw new HttpError(400,'سال تولید معتبر نیست.');
    if(!row.photos.length)throw new HttpError(400,'حداقل یک تصویر خودرو بارگذاری کنید.');
    return data;
  }
  async function assertContact(tx,row,data){
    const owner=await tx.user.findUnique({where:{id:row.ownerId},select:{phone:true}});
    if(data.contactPhone!==owner?.phone&&data.contactPhone!==row.verifiedContactPhone)throw new HttpError(409,'ابتدا شماره تماس جایگزین آگهی را با کد تأیید کنید.');
  }
  async function freePublish(id,userId){await ready();return prisma.$transaction(async tx=>{
    await lock(tx,id);const row=await owned(id,userId,tx);
    if(['PUBLISHED','PENDING_REVIEW'].includes(row.status))return listingDto(row,true);
    await editable(tx,row);await validatePublish(tx,row);
    const plan=await tx.hallPlan.findUnique({where:{code:'FREE'}});if(!plan?.active||plan.priceToman!==0)throw new HttpError(409,'انتشار رایگان موقتاً در دسترس نیست.');
    return listingDto(await tx.hallListing.update({where:{id},data:{status:'PENDING_REVIEW',submittedAt:new Date(),reviewedAt:null,reviewedBy:null,moderationNote:null,version:{increment:1}},include}),true);
  });}
  async function estimate(data,userId){
    const current=data.year<1800?Number(new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric'}).formatToParts(new Date()).find(p=>p.type==='year')?.value):new Date().getUTCFullYear();
    if(data.year>current+1)throw new HttpError(400,'سال تولید معتبر نیست.');
    const rows=await prisma.hallListing.findMany({where:{status:'PUBLISHED',ownerId:{not:userId},makeKey:normalize(data.make),modelKey:normalize(data.model),trimKey:normalize(data.trim),year:data.year,mileage:{gte:Math.floor(Math.max(0,data.mileage-Math.max(20000,data.mileage*.25))),lte:Math.round(data.mileage+Math.max(20000,data.mileage*.25))},bodyCondition:data.bodyCondition,technicalCondition:data.technicalCondition,priceToman:{not:null},publishedAt:{gte:new Date(Date.now()-30*86400000)}},orderBy:{publishedAt:'desc'},take:200,select:{ownerId:true,priceToman:true,publishedAt:true}});
    const result=analyzePrices(rows);return{...result,isEstimate:result.sampleCount<5,criteria:'برند، مدل، تیپ، سال و وضعیت یکسان؛ اختلاف کارکرد حداکثر ۲۵٪ یا ۲۰ هزار کیلومتر',suggested:result.median?Math.round(result.median*.98/100000)*100000:null};
  }
  const orderDto=o=>({id:o.id,listingId:o.listingId,status:o.status,mode:o.mode,amountToman:o.amountToman,refId:o.refId,planName:o.snapshot.name,paymentMethod:o.refId?.startsWith('WALLET-')?'WALLET':'GATEWAY',errorCode:o.errorCode,url:o.status==='PENDING'?provider.redirect(o.authority,o.mode):null});
  async function checkout(user,id,input){
    await ready();const usingWallet=input.method==='WALLET';
    const order=await prisma.$transaction(async tx=>{
      if(usingWallet)await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
      await lock(tx,id);const row=await owned(id,user.id,tx);
      const existing=await tx.hallOrder.findUnique({where:{userId_idempotencyKey:{userId:user.id,idempotencyKey:input.idempotencyKey}}});
      if(existing){if(existing.listingId!==id||existing.planCode!==input.planCode||!!existing.refId?.startsWith('WALLET-')!==usingWallet)throw new HttpError(409,'شناسه پرداخت تکراری است.');return existing;}
      const action=['PUBLISHED','PENDING_REVIEW'].includes(row.status)?'UPGRADE':'PUBLISH';
      if(!['DRAFT','PUBLISHED','PENDING_REVIEW','REJECTED'].includes(row.status))throw new HttpError(409,'آگهی در وضعیت قابل انتشار نیست.');
      await validatePublish(tx,row);
      const plan=await tx.hallPlan.findUnique({where:{code:input.planCode}});
      if(plan?.code==='URGENT')throw new HttpError(400,'خدمت فوری دیگر ارائه نمی‌شود.');
      if(!plan?.active||plan.priceToman<=0||plan.kind!==(action==='PUBLISH'?'PLAN':'BOOST'))throw new HttpError(400,'طرح انتخاب‌شده معتبر نیست.');
      if(plan.code==='EXPRESS48'&&!expressEligible(row.draft))throw new HttpError(400,'این خودرو شرایط طرح ۴۸ ساعته را ندارد.');
      const pending=await tx.hallOrder.findFirst({where:{listingId:id,status:{in:['CREATING','PENDING']}}});
      if(pending){
        if(pending.status==='CREATING'&&Date.now()-pending.createdAt.getTime()>120000)await tx.hallOrder.update({where:{id:pending.id},data:{status:'FAILED',errorCode:'REQUEST_EXPIRED'}});
        else if(!usingWallet&&pending.planCode===plan.code)return pending;
        else throw new HttpError(409,'یک پرداخت دیگر در جریان است.');
      }
      if(action==='UPGRADE'){
        const last=await tx.hallOrder.findFirst({where:{listingId:id,planCode:plan.code,status:'VERIFIED'},orderBy:{activatedAt:'desc'}});
        if(last&&(!last.activatedAt||new Date(last.activatedAt.getTime()+last.snapshot.durationHours*3600000)>new Date()))throw new HttpError(409,'این خدمت خریداری شده یا هنوز فعال است.');
      }
      const created=await tx.hallOrder.create({data:{userId:user.id,listingId:id,listingVersion:row.version,action,planCode:plan.code,snapshot:JSON.parse(JSON.stringify(plan)),amountToman:plan.priceToman,mode:usingWallet?'live':provider.mode,idempotencyKey:input.idempotencyKey,...(usingWallet?{refId:'WALLET-'+input.idempotencyKey}:{})}});
      if(usingWallet){await require('../wallet-spending').spendWallet(tx,user.id,{hallOrderId:created.id,amountToman:created.amountToman});return activate(tx,created,row);}
      return created;
    });
    if(usingWallet)return orderDto(order);
    if(['PENDING','VERIFIED'].includes(order.status))return orderDto(order);
    if(order.status!=='CREATING')throw new HttpError(409,'برای تلاش مجدد پرداخت تازه ایجاد کنید.');
    if(!(await prisma.hallOrder.updateMany({where:{id:order.id,status:'CREATING',errorCode:null},data:{errorCode:'REQUESTING'}})).count)throw new HttpError(409,'در حال آماده‌سازی درگاه؛ چند لحظه دیگر بررسی کنید.');
    try{
      const callback=new URL('/api/v1/hall/payments/callback',config.PAYMENT_CALLBACK_URL||'https://api.khodrochare.ir');callback.searchParams.set('order',order.id);
      const response=await provider.request({amountToman:order.amountToman,callbackUrl:callback.href,description:'تالار خودرو چاره: '+order.snapshot.name,mobile:user.phone});
      return orderDto(await prisma.hallOrder.update({where:{id:order.id},data:{status:'PENDING',authority:response.authority,errorCode:null}}));
    }catch(error){await prisma.hallOrder.updateMany({where:{id:order.id,status:'CREATING'},data:{status:'FAILED',errorCode:'GATEWAY_REQUEST_FAILED'}});throw error;}
  }
  async function activate(tx,order,row){
    const boostField=order.planCode==='LADDER'?'ladderUntil':order.planCode==='URGENT'?'urgentUntil':order.planCode==='FEATURED'?'featuredUntil':null;
    if(row.status==='PENDING_REVIEW'&&order.action==='UPGRADE'&&boostField&&row.version===order.listingVersion)return tx.hallOrder.update({where:{id:order.id},data:{status:'VERIFIED',verifiedAt:new Date(),activatedAt:null,errorCode:'AWAITING_MODERATION'}});
    if(['BLOCKED','REJECTED','DELETED','PENDING_REVIEW'].includes(row.status)||row.version!==order.listingVersion||order.action==='PUBLISH'&&row.status!=='DRAFT'||order.action==='UPGRADE'&&(row.status!=='PUBLISHED'||boostField&&row[boostField]>new Date()))return tx.hallOrder.update({where:{id:order.id},data:{status:'REVIEW_REQUIRED',errorCode:'LISTING_CHANGED',verifiedAt:new Date()}});
    if(order.action==='PUBLISH'){
      await tx.hallListing.update({where:{id:row.id},data:{status:'PENDING_REVIEW',submittedAt:new Date(),moderationNote:null}});
      return tx.hallOrder.update({where:{id:order.id},data:{status:'REVIEW_REQUIRED',errorCode:'MODERATION_REQUIRED',verifiedAt:new Date()}});
    }
    const now=new Date(),until=new Date(Date.now()+order.snapshot.durationHours*3600000);
    const data=order.action==='PUBLISH'?{status:'PUBLISHED',publishedAt:now,bumpedAt:now}:{};
    if(['EXPRESS48','FEATURED'].includes(order.planCode))data.featuredUntil=until;
    if(order.planCode==='URGENT')data.urgentUntil=until;
    if(order.planCode==='LADDER'){data.ladderUntil=until;data.bumpedAt=now;}
    await tx.hallListing.update({where:{id:row.id},data});
    return tx.hallOrder.update({where:{id:order.id},data:{status:'VERIFIED',activatedAt:now,verifiedAt:now,errorCode:null}});
  }
  async function verify(id,authority,status){
    const order=await prisma.hallOrder.findUnique({where:{id}});
    if(!order||!order.authority||order.authority!==authority)throw new HttpError(404,'پرداخت پیدا نشد.');
    if(['VERIFIED','REVIEW_REQUIRED'].includes(order.status))return order;
    // Cancellations are user decisions, not proof of a successful payment.
    if(status!=='OK')return prisma.$transaction(async tx=>{await lock(tx,order.listingId);const current=await tx.hallOrder.findUnique({where:{id}});return ['VERIFIED','REVIEW_REQUIRED'].includes(current.status)?current:tx.hallOrder.update({where:{id},data:{status:'CANCELLED'}});});
    const result=await provider.verify(order);
    return prisma.$transaction(async tx=>{
      await lock(tx,order.listingId);const current=await tx.hallOrder.findUnique({where:{id}});
      if(['VERIFIED','REVIEW_REQUIRED'].includes(current.status))return current;
      const row=await tx.hallListing.findUnique({where:{id:order.listingId}});
      const paid=await tx.hallOrder.update({where:{id},data:{refId:result.refId}});
      return activate(tx,paid,row);
    });
  }
  return{ready,owned,editable,photosChanged,remove,save,estimate,freePublish,checkout,verify,orderDto,listingDto};
}
module.exports={createHall,listingDto,include,lock};
