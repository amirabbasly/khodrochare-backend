const {z}=require('zod');
const d=require('./domain');
const kinds=['NATIONAL_ID','BIRTH_CERTIFICATE','DRIVING_LICENSE','VEHICLE_OWNERSHIP'];
const vehicleEvidenceTypes=['VEHICLE_CARD','INSURANCE','TECHNICAL_INSPECTION'];
const documentSelect={id:true,mimeType:true,verificationKind:true,vehicleEvidenceType:true,createdAt:true};
const labels={NATIONAL_ID:'کارت ملی',BIRTH_CERTIFICATE:'شناسنامه',DRIVING_LICENSE:'گواهینامه',VEHICLE_OWNERSHIP:'مدرک خودرو'};
async function assertCompleteDocuments(db,userId){
 const docs=await db.document.findMany({where:{ownerId:userId,verificationKind:{in:kinds}},select:documentSelect});
 const missing=kinds.filter(kind=>!docs.some(doc=>doc.verificationKind===kind&&(kind!=='VEHICLE_OWNERSHIP'||vehicleEvidenceTypes.includes(doc.vehicleEvidenceType))));
 if(missing.length)throw new d.HttpError(409,'مدارک الزامی ناقص است: '+missing.map(kind=>labels[kind]).join('، '));
 return docs;
}
async function attachVerificationDocument(tx,services,userId,kind,ref,vehicleEvidenceType){
 await services.claimDocument(tx,ref,userId);
 await tx.document.updateMany({where:{ownerId:userId,verificationKind:kind},data:{verificationKind:null,vehicleEvidenceType:null}});
 return tx.document.update({where:{id:ref.id},data:{verificationKind:kind,vehicleEvidenceType:kind==='VEHICLE_OWNERSHIP'?vehicleEvidenceType:null}});
}
function registerVerificationDocuments({app,prisma,services,auth,role}){
 app.post('/api/v1/me/verification-documents',auth,role('DRIVER'),async(req,res)=>{
  const input=z.object({kind:z.enum(kinds),document:d.documentRef,vehicleEvidenceType:z.enum(vehicleEvidenceTypes).optional()}).strict().refine(value=>value.kind==='VEHICLE_OWNERSHIP'?!!value.vehicleEvidenceType:value.vehicleEvidenceType===undefined,'نوع مدرک خودرو را مشخص کنید.').parse(req.body);
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
   const user=await tx.user.findUnique({where:{id:req.user.id}});
   await attachVerificationDocument(tx,services,user.id,input.kind,input.document,input.vehicleEvidenceType);
   await tx.user.update({where:{id:user.id},data:{...(input.kind==='NATIONAL_ID'?{identityDocumentId:input.document.id}:{}),verificationStatus:user.verificationStatus==='NEEDS_CORRECTION'?'NEEDS_CORRECTION':'PENDING',verificationVersion:{increment:1},verificationNoticeSeenAt:null}});
  });res.status(204).end();
 });
 app.post('/api/v1/me/verification-documents/submit',auth,role('DRIVER'),async(req,res)=>{
  z.object({}).strict().parse(req.body);
  const user=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
   const old=await tx.user.findUnique({where:{id:req.user.id}});
   if(old.verificationStatus==='APPROVED')return tx.user.findUnique({where:{id:req.user.id},include:{documents:{select:documentSelect}}});
   await assertCompleteDocuments(tx,req.user.id);
   return tx.user.update({where:{id:req.user.id},data:{verificationStatus:'PENDING',verificationVersion:{increment:1},verificationNoticeSeenAt:null,...(!old.registrationNoticeSeenAt?{registrationNoticeSeenAt:new Date()}: {})},include:{documents:{select:documentSelect}}});
  });res.json(services.safeUser(user));
 });
}
module.exports={kinds,vehicleEvidenceTypes,documentSelect,assertCompleteDocuments,attachVerificationDocument,registerVerificationDocuments};
