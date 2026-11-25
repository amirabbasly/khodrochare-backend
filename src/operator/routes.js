const {z}=require('zod');
const {randomUUID}=require('node:crypto');
const {HttpError,hashPassword}=require('../domain');
const {operatorAuth}=require('./auth');
const {pendingRequestCutoff,isPendingRequestExpired}=require('../request-expiry');
const {listingDto,include:listingInclude}=require('../hall/service');
const id=z.string().uuid();
const paging=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),q:z.string().trim().max(100).default('')});
const person={id:true,role:true,fullName:true,phone:true,nationalId:true,isActive:true,deletedAt:true,phoneVerifiedAt:true,vehiclePlate:true,vehicleType:true,activityCity:true,activityDistrict:true,verificationStatus:true,verificationVersion:true,services:true,createdAt:true};
const requestInclude={customer:{select:person},driver:{select:person},payment:{select:{id:true,status:true,method:true,cashReportedAt:true,serviceToman:true,partsToman:true,amountToman:true,commissionToman:true,driverShareToman:true,verifiedAt:true,checkouts:{select:{id:true,status:true,mode:true,refId:true,errorCode:true,createdAt:true,verifiedAt:true}}}}};
const guidance='لطفاً با امدادخواه تماس بگیرید و بار را به یکی از بچه‌های امدادی بسپرید و پرداخت را به شکل آنلاین از طریق اپلیکیشن یا در محل پیگیری کنید.';
const pageData=(q,total,items)=>({items,pagination:{page:q.page,limit:q.limit,total,totalPages:Math.max(1,Math.ceil(total/q.limit))}});
function registerOperator({app,prisma,redis,config,io,limit}){
 const root='/api/v1/operator';
 app.use(root,operatorAuth(config,redis),limit('operator-panel',180,60),(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const audit=(tx,actor,action,targetId,details={})=>tx.operatorAudit.create({data:{id:randomUUID(),actorId:actor.id,actorRole:actor.role,actorName:actor.name,action,targetId,details}});
 require('./driver-verification').registerDriverReviews({app,root,prisma,config,audit,io});
 require('../showrooms/operator').registerShowroomReview({app,root,prisma,audit,config});
 require('../import-requests').registerImportReview({app,root,prisma});
 require('./locations').registerRequestLocations({app,root,prisma,config,id});
 app.get(root+'/requests',async(req,res)=>{
  const q=paging.extend({status:z.enum(['ALL','PENDING','OPERATOR','ACCEPTED','ARRIVED','COMPLETED','CANCELLED','EXPIRED']).default('ALL')}).parse(req.query);
  const where={...(q.status==='PENDING'?{status:'PENDING',driverId:null,operatorConfirmedAt:null,createdAt:{gt:pendingRequestCutoff()}}:q.status==='OPERATOR'?{status:'PENDING',operatorConfirmedAt:{not:null}}:q.status==='EXPIRED'?{OR:[{status:'EXPIRED'},{status:'PENDING',driverId:null,operatorConfirmedAt:null,createdAt:{lte:pendingRequestCutoff()}}]}:q.status==='ALL'?{}:{status:q.status}),...(q.q?{AND:[{OR:[{vehicleName:{contains:q.q,mode:'insensitive'}},{vehiclePlate:{contains:q.q}},{customer:{fullName:{contains:q.q,mode:'insensitive'}}},{customer:{phone:{contains:q.q}}}]}]}:{})};
  const [total,rows]=await Promise.all([prisma.assistanceRequest.count({where}),prisma.assistanceRequest.findMany({where,include:requestInclude,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit,skip:(q.page-1)*q.limit})]);
  res.json(pageData(q,total,rows.map(row=>isPendingRequestExpired(row)?{...row,status:'EXPIRED'}:row)));
 });
 app.get(root+'/requests/:id',async(req,res)=>{
  const row=await prisma.assistanceRequest.findUnique({where:{id:id.parse(req.params.id)},include:requestInclude});
  if(!row)throw new HttpError(404,'درخواست پیدا نشد.');
  res.json({...row,status:isPendingRequestExpired(row)?'EXPIRED':row.status,audit:await prisma.operatorAudit.findMany({where:{targetId:row.id},orderBy:{createdAt:'desc'},take:50})});
 });
 app.post(root+'/requests/:id/confirm',async(req,res)=>{
  const requestId=id.parse(req.params.id),input=z.object({notes:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  const row=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "AssistanceRequest" WHERE id=${requestId} FOR UPDATE`;
   const old=await tx.assistanceRequest.findUnique({where:{id:requestId}});
   if(!old)throw new HttpError(404,'درخواست پیدا نشد.');
   if(old.status!=='PENDING'||old.driverId||isPendingRequestExpired(old)||old.operatorConfirmedAt)throw new HttpError(409,'این درخواست قبلاً تعیین تکلیف شده یا منقضی است.');
   const updated=await tx.assistanceRequest.update({where:{id:requestId},data:{operatorConfirmedAt:new Date(),operatorActorId:req.operatorActor.id,operatorActorName:req.operatorActor.name,operatorNotes:input.notes},include:requestInclude});
   await audit(tx,req.operatorActor,'REQUEST_CONFIRM',requestId,{notes:input.notes});await tx.outbox.create({data:{requestId}});return updated;
  });res.json({request:row,guidance});
 });
 app.post(root+'/requests/:id/assign',async(req,res)=>{
  const requestId=id.parse(req.params.id),input=z.object({driverId:id,notes:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  const row=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${input.driverId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM "AssistanceRequest" WHERE id=${requestId} FOR UPDATE`;
   const [old,driver]=await Promise.all([tx.assistanceRequest.findUnique({where:{id:requestId}}),tx.user.findUnique({where:{id:input.driverId}})]);
   if(!old||!driver)throw new HttpError(404,'درخواست یا امدادگر پیدا نشد.');
   if(old.status!=='PENDING'||old.driverId||!old.operatorConfirmedAt)throw new HttpError(409,'ابتدا درخواست معلق را تأیید کنید؛ درخواست تخصیص‌یافته قابل واگذاری مجدد نیست.');
   if(driver.verificationStatus!=='APPROVED')throw new HttpError(409,require('../driver-verification').pendingMessage);
   await require('../driver-balance').assertDriverCredit(tx,driver.id);
   if(driver.role!=='DRIVER'||!driver.isActive||driver.deletedAt||!driver.services.includes(old.service))throw new HttpError(409,'این امدادگر فعال نیست یا خدمت موردنیاز را ارائه نمی‌کند.');
   if(await tx.assistanceRequest.findFirst({where:{driverId:driver.id,status:{in:['ACCEPTED','ARRIVED']}},select:{id:true}}))throw new HttpError(409,'این امدادگر مأموریت فعال دیگری دارد.');
   const updated=await tx.assistanceRequest.update({where:{id:requestId},data:{driverId:driver.id,status:'ACCEPTED',acceptedAt:new Date(),operatorNotes:input.notes||old.operatorNotes},include:requestInclude});
   await require('./locations').captureRequestLocations(tx, updated, req.operatorActor, 'OPERATOR_ASSIGNED', config.LOCATION_MAX_AGE_SECONDS || 120);
   await audit(tx,req.operatorActor,'REQUEST_ASSIGN',requestId,{driverId:driver.id,notes:input.notes});await tx.outbox.create({data:{requestId}});return updated;
  });res.json(row);
 });
 app.get(root+'/users',async(req,res)=>{
  const q=paging.extend({role:z.enum(['ALL','CUSTOMER','DRIVER']).default('ALL'),active:z.enum(['ALL','true','false']).default('ALL')}).parse(req.query);
  const where={deletedAt:null,...(q.role==='ALL'?{}:{role:q.role}),...(q.active==='ALL'?{}:{isActive:q.active==='true'}),...(q.q?{OR:[{fullName:{contains:q.q,mode:'insensitive'}},{phone:{contains:q.q}},{nationalId:{contains:q.q}}]}:{})};
  const [total,rows]=await Promise.all([prisma.user.count({where}),prisma.user.findMany({where,select:person,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.limit,take:q.limit})]);res.json(pageData(q,total,rows));
 });
 app.get(root+'/users/:id',async(req,res)=>{
  const userId=id.parse(req.params.id),user=await prisma.user.findUnique({where:{id:userId},select:{...person,vehicles:{include:{maintenanceRecords:{orderBy:{performedAt:'desc'},take:20}}}}});
  if(!user||user.deletedAt)throw new HttpError(404,'حساب پیدا نشد.');
  const [requests,listingCount,earnings,wallet,tickets,activity]=await Promise.all([
   prisma.assistanceRequest.findMany({where:{OR:[{customerId:userId},{driverId:userId}]},include:requestInclude,orderBy:{createdAt:'desc'},take:50}),
   prisma.hallListing.count({where:{ownerId:userId,status:{not:'DELETED'}}}),prisma.driverEarning.aggregate({where:{driverId:userId},_sum:{amountToman:true}}),
   prisma.walletEntry.groupBy({by:['mode'],where:{userId},_sum:{amountToman:true}}),prisma.supportTicket.findMany({where:{userId},orderBy:{updatedAt:'desc'},take:20}),
   prisma.operatorAudit.findMany({where:{targetId:userId},orderBy:{createdAt:'desc'},take:50}),
  ]);await audit(prisma,req.operatorActor,'USER_VIEW',userId);res.json({user,requests,listingCount,balanceToman:user.role==='DRIVER'?await require('../driver-balance').driverBalance(prisma,userId):wallet.find(entry=>entry.mode==='live')?._sum.amountToman||0,driverEarningsToman:earnings._sum.amountToman||0,wallet,tickets,activity});
 });
 app.patch(root+'/users/:id/active',async(req,res)=>{
  const userId=id.parse(req.params.id),input=z.object({isActive:z.boolean(),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
  const updated=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const user=await tx.user.findUnique({where:{id:userId}});if(!user||user.deletedAt)throw new HttpError(404,'حساب پیدا نشد.');
   const row=await tx.user.update({where:{id:userId},data:{isActive:input.isActive},select:person});
   if(!input.isActive)await tx.session.deleteMany({where:{userId}});
   await audit(tx,req.operatorActor,input.isActive?'USER_ACTIVATE':'USER_DEACTIVATE',userId,{reason:input.reason});return row;
  });if(!input.isActive)io.in(`user:${userId}`).disconnectSockets(true);res.json(updated);
 });
 app.post(root+'/users/:id/password',async(req,res)=>{
  const userId=id.parse(req.params.id),input=z.object({password:z.string().min(8).max(128),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
  const passwordHash=await hashPassword(input.password);
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const old=await tx.user.findUnique({where:{id:userId}});if(!old||old.deletedAt)throw new HttpError(404,'حساب پیدا نشد.');
   await tx.user.update({where:{id:userId},data:{passwordHash}});await tx.session.deleteMany({where:{userId}});
   await tx.customerOtpChallenge.updateMany({where:{phone:old.phone,status:{in:['SENT','SENDING']}},data:{status:'INVALIDATED'}});
   await audit(tx,req.operatorActor,'USER_PASSWORD_RESET',userId,{reason:input.reason});
  });io.in(`user:${userId}`).disconnectSockets(true);res.json({changed:true});
 });
 app.get(root+'/receipts',async(req,res)=>{
  const q=paging.extend({status:z.enum(['ALL','SUBMITTED','APPROVED','REJECTED']).default('SUBMITTED')}).parse(req.query);
  const where={...(q.status==='ALL'?{}:{status:q.status}),...(q.q?{OR:[{bankReference:{contains:q.q}},{user:{phone:{contains:q.q}}},{user:{fullName:{contains:q.q,mode:'insensitive'}}}]}:{})};
  const [total,items]=await Promise.all([prisma.walletReceipt.count({where}),prisma.walletReceipt.findMany({where,include:{user:{select:person}},orderBy:{createdAt:'desc'},skip:(q.page-1)*q.limit,take:q.limit})]);
  res.json(pageData(q,total,items.map(({storageKey,...row})=>row)));
 });
 app.get(root+'/receipts/:id',async(req,res)=>{
  const row=await prisma.walletReceipt.findUnique({where:{id:id.parse(req.params.id)},include:{user:{select:person}}});if(!row)throw new HttpError(404,'رسید پیدا نشد.');
  const {storageKey,...safe}=row;const buffer=await require('node:fs/promises').readFile(require('node:path').join(config.UPLOAD_DIR,storageKey));
  res.json({...safe,image:`data:${row.mimeType};base64,${buffer.toString('base64')}`});
 });
 app.post(root+'/receipts/:id/review',async(req,res)=>{
  const receiptId=id.parse(req.params.id),input=z.object({version:z.number().int().nonnegative(),decision:z.enum(['APPROVE','REJECT']),amountToman:z.number().int().min(1).max(100000000).optional(),bankReference:z.string().regex(/^\d{6,30}$/).optional(),note:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  await prisma.$transaction(tx=>require('../wallet-receipts').reviewReceipt(tx,receiptId,input.decision==='APPROVE',req.operatorActor,input.note,input.version,input.amountToman,input.bankReference));res.json({reviewed:true});
 });
 app.get(root+'/listings',async(req,res)=>{
  const q=paging.extend({status:z.enum(['ALL','PENDING_REVIEW','PUBLISHED','REJECTED','DRAFT','BLOCKED','SOLD']).default('PENDING_REVIEW')}).parse(req.query);
  const where={AND:[{status:{notIn:['DELETED','DRAFT']}},{status:q.status==='ALL'?{not:'DELETED'}:q.status}],...(q.q?{OR:[{searchText:{contains:q.q,mode:'insensitive'}},{owner:{phone:{contains:q.q}}},{owner:{fullName:{contains:q.q,mode:'insensitive'}}}]}:{})};
  const [total,rows]=await Promise.all([prisma.hallListing.count({where}),prisma.hallListing.findMany({where,include:{...listingInclude,owner:{select:person}},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:q.limit,skip:(q.page-1)*q.limit})]);
  res.json(pageData(q,total,rows.map(row=>({...listingDto(row,true),owner:row.owner}))));
 });
 app.post(root+'/listings/:id/delete',async(req,res)=>{
  const listingId=id.parse(req.params.id),input=z.object({version:z.number().int().nonnegative()}).strict().parse(req.body);
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "HallListing" WHERE id=${listingId} FOR UPDATE`;
   const old=await tx.hallListing.findUnique({where:{id:listingId}});
   if(!old)throw new HttpError(404,'آگهی پیدا نشد.');
   if(old.status==='DELETED')return;
   if(old.version!==input.version)throw new HttpError(409,'نسخهٔ آگهی تغییر کرده است؛ دوباره آن را باز کنید.');
   await tx.hallListing.update({where:{id:listingId},data:{status:'DELETED',version:{increment:1}}});
   await audit(tx,req.operatorActor,'LISTING_DELETE',listingId,{version:input.version,previousStatus:old.status});
  });res.json({deleted:true});
 });
 app.post(root+'/listings/:id/review',async(req,res)=>{
  const listingId=id.parse(req.params.id),input=z.object({decision:z.enum(['APPROVE','REJECT']),version:z.number().int().nonnegative(),note:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  if(input.decision==='REJECT'&&input.note.length<3)throw new HttpError(400,'علت رد آگهی را بنویسید.');
  const row=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "HallListing" WHERE id=${listingId} FOR UPDATE`;
   const old=await tx.hallListing.findUnique({where:{id:listingId},include:{...listingInclude,owner:{select:person}}});
   if(!old)throw new HttpError(404,'آگهی پیدا نشد.');
   if(old.status!=='PENDING_REVIEW'||old.version!==input.version)throw new HttpError(409,'وضعیت یا نسخهٔ آگهی تغییر کرده است؛ دوباره آن را باز کنید.');
   if(input.decision==='APPROVE'){
    require('../hall/domain').publicationDetails.parse(old.draft);
    if(!old.owner.isActive||old.owner.deletedAt||!old.photos.length)throw new HttpError(409,'حساب غیرفعال است یا آگهی تصویر ندارد.');
    if(old.draft.contactPhone!==old.owner.phone&&old.draft.contactPhone!==old.verifiedContactPhone)throw new HttpError(409,'شمارهٔ تماس آگهی تأیید نشده است.');
   }
   const now=new Date(),approved=input.decision==='APPROVE';
   const boosts={};
   if(approved){
    const waiting=await tx.hallOrder.findMany({where:{listingId,status:'VERIFIED',activatedAt:null,errorCode:'AWAITING_MODERATION'}});
    for(const order of waiting){
     for(const plan of require('../hall/order-plans').orderPlans(order)){
      const field=require('../hall/order-plans').boostFields[plan.code];
      if(field){if(plan.code==='FEATURED')await require('../hall/featured-slots').reserveFeatured(tx,listingId,order.id);boosts[field]=new Date(now.getTime()+(plan.code==='FEATURED'?6:plan.durationHours)*3600000);}
     }
     await tx.hallOrder.update({where:{id:order.id},data:{activatedAt:now,errorCode:null}});
    }
   }
   const updated=await tx.hallListing.update({where:{id:listingId},data:{status:approved?'PUBLISHED':'REJECTED',reviewedAt:now,reviewedBy:req.operatorActor.name,moderationNote:input.note||null,...(approved?{publishedAt:now,bumpedAt:now,...boosts}:{}),version:{increment:1}},include:listingInclude});
   await audit(tx,req.operatorActor,approved?'LISTING_APPROVE':'LISTING_REJECT',listingId,{note:input.note,version:input.version});return updated;
  });res.json(listingDto(row,true));
 });
}
module.exports={registerOperator,guidance};
