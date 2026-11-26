const {z}=require('zod');
const d=require('../domain');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const fields={id:true,fullName:true,phone:true,nationalId:true,vehiclePlate:true,vehicleType:true,activityCity:true,activityDistrict:true,noDrivingLicense:true,services:true,isActive:true,identityDocumentId:true,verificationStatus:true,verificationVersion:true,verificationReviewedAt:true,verificationReviewedBy:true,verificationNote:true,createdAt:true};
const id=z.string().uuid();
function registerDriverReviews({app,root,prisma,config,audit,io}){
 async function driver(db,userId){const row=await db.user.findUnique({where:{id:userId},select:{...fields,role:true,deletedAt:true}});if(!row||row.role!=='DRIVER'||row.deletedAt)throw new d.HttpError(404,'امدادگر پیدا نشد.');return row;}
 app.get(root+'/driver-verifications',async(req,res)=>{
  const q=z.object({status:z.enum(['ALL','PENDING','APPROVED','NEEDS_CORRECTION']).default('PENDING'),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(req.query);
  const where={role:'DRIVER',deletedAt:null,...(q.status==='ALL'?{}:{verificationStatus:q.status}),...(q.q?{OR:[{fullName:{contains:q.q,mode:'insensitive'}},{phone:{contains:q.q}},{nationalId:{contains:q.q}}]}:{})};
  const [total,items]=await Promise.all([prisma.user.count({where}),prisma.user.findMany({where,select:fields,orderBy:[{createdAt:'asc'},{id:'asc'}],take:q.limit,skip:(q.page-1)*q.limit})]);
  res.json({items,pagination:{page:q.page,limit:q.limit,total,totalPages:Math.max(1,Math.ceil(total/q.limit))}});
 });
 app.get(root+'/driver-verifications/:id',async(req,res)=>{
  const user=await driver(prisma,id.parse(req.params.id));
  const documents=await prisma.document.findMany({where:{ownerId:user.id},select:require('../verification-documents').documentSelect,orderBy:{createdAt:'desc'}});
  await audit(prisma,req.operatorActor,'DRIVER_REVIEW_VIEW',user.id);res.json({user,documents,affiliation:await require("../driver-affiliation").read(prisma,user.id)});
 });
 app.get(root+'/driver-verifications/:id/documents/:documentId',async(req,res)=>{
  const user=await driver(prisma,id.parse(req.params.id));
  const doc=await prisma.document.findFirst({where:{id:id.parse(req.params.documentId),ownerId:user.id}});
  if(!doc)throw new d.HttpError(404,'مدرک پیدا نشد.');
  if(!['image/jpeg','image/png'].includes(doc.mimeType)||!/^[-a-zA-Z0-9]+$/.test(doc.storageKey))throw new d.HttpError(409,'مدرک قابل نمایش نیست.');
  const buffer=await readFile(path.join(config.UPLOAD_DIR,doc.storageKey));
  await audit(prisma,req.operatorActor,'DRIVER_DOCUMENT_VIEW',user.id,{documentId:doc.id});
  res.json({id:doc.id,image:`data:${doc.mimeType};base64,${buffer.toString('base64')}`});
 });
 app.patch(root+'/driver-verifications/:id/profile',async(req,res)=>{
  const userId=id.parse(req.params.id);
  const input=z.object({version:z.number().int().nonnegative(),fullName:d.driverRegistration.shape.fullName,phone:d.phone,nationalId:d.driverRegistration.shape.nationalId,vehicleType:d.driverRegistration.shape.vehicleType,vehiclePlate:d.driverRegistration.shape.vehiclePlate,activityCity:d.driverRegistration.shape.activityCity,activityDistrict:d.driverRegistration.shape.activityDistrict,services:d.driverRegistration.shape.services}).strict().parse(req.body);
  const {version,...data}=input;let changedPhone=false;
  const user=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const old=await driver(tx,userId);if(old.verificationVersion!==version)throw new d.HttpError(409,'اطلاعات تغییر کرده است؛ دوباره باز کنید.');
   changedPhone=old.phone!==data.phone;
   const updated=await tx.user.update({where:{id:userId},data:{...data,verificationVersion:{increment:1},...(changedPhone?{phoneVerifiedAt:null}:{})},select:fields});
   if(changedPhone){await tx.session.deleteMany({where:{userId}});await tx.customerOtpChallenge.updateMany({where:{phone:old.phone,status:{in:['SENT','SENDING']}},data:{status:'INVALIDATED'}});}
   await audit(tx,req.operatorActor,'DRIVER_PROFILE_EDIT',userId,{fields:Object.keys(data).filter(k=>JSON.stringify(data[k])!==JSON.stringify(old[k])),version});return updated;
  });if(changedPhone)io.in(`user:${userId}`).disconnectSockets(true);res.json(user);
 });
 app.post(root+'/driver-verifications/:id/review',async(req,res)=>{
  const userId=id.parse(req.params.id),input=z.object({version:z.number().int().nonnegative(),decision:z.enum(['APPROVE','NEEDS_CORRECTION']),note:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  if(input.decision==='NEEDS_CORRECTION'&&input.note.length<3)throw new d.HttpError(400,'توضیح مشکل مدارک را وارد کنید.');
  const user=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const old=await driver(tx,userId);if(old.verificationVersion!==input.version)throw new d.HttpError(409,'وضعیت تغییر کرده است؛ دوباره باز کنید.');
   if(input.decision==='APPROVE'){
    const doc=old.identityDocumentId&&await tx.document.findFirst({where:{id:old.identityDocumentId,ownerId:userId}});
    await require('../verification-documents').assertCompleteDocuments(tx,userId);
    if(!doc||!old.isActive)throw new d.HttpError(409,'برای تأیید، حساب باید فعال و مدرک هویتی متعلق به امدادگر ثبت شده باشد.');
   }
   const approved=input.decision==='APPROVE';
   const updated=await tx.user.update({where:{id:userId},data:{verificationStatus:approved?'APPROVED':'NEEDS_CORRECTION',verificationVersion:{increment:1},verificationNote:input.note||null,verificationReviewedAt:new Date(),verificationReviewedBy:req.operatorActor.name,...(!approved?{registrationNoticeSeenAt:new Date()}:{}),...(approved&&old.verificationStatus!=='APPROVED'?{verificationNoticeSeenAt:null}:{})},select:fields});
   await audit(tx,req.operatorActor,approved?'DRIVER_APPROVE':'DRIVER_NEEDS_CORRECTION',userId,{note:input.note,version:input.version});return updated;
  });res.json(user);
 });
}
module.exports={registerDriverReviews};
