const {z}=require('zod');
const {HttpError}=require('../domain');
const {eraseCustomer}=require('../customer-deletion');
const path=require('node:path');const fs=require('node:fs/promises');
function registerAccountDeletion({app,root,prisma,config,io,audit}){
 app.post(root+'/users/:id/delete',async(req,res)=>{
  if(req.operatorActor.role!=='admin')throw new HttpError(403,'حذف دائمی حساب فقط برای مدیر مجاز است.');
  const userId=z.string().uuid().parse(req.params.id),input=z.object({confirmation:z.literal('DELETE'),phone:z.string().trim().min(1).max(32),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body);
  const result=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const user=await tx.user.findUnique({where:{id:userId}});
   if(!user||user.deletedAt)throw new HttpError(404,'حساب پیدا نشد.');
   if(user.phone!==input.phone)throw new HttpError(409,'شماره همراه تأیید با حساب انتخاب‌شده مطابقت ندارد.');
   if(user.role==='DRIVER'){
    if(await tx.assistanceRequest.findFirst({where:{driverId:userId,status:{in:['ACCEPTED','ARRIVED']}},select:{id:true}}))throw new HttpError(409,'ابتدا مأموریت فعال امدادگر را تعیین تکلیف کنید.');
    if(await require('../wallet-spending').walletBalance(tx,userId))throw new HttpError(409,'ابتدا موجودی یا بدهی کیف پول امدادگر را تسویه کنید.');
    if(await tx.payment.findFirst({where:{request:{driverId:userId,status:{notIn:['CANCELLED','EXPIRED']}},status:{notIn:['VERIFIED','SANDBOX_VERIFIED']}},select:{id:true}}))throw new HttpError(409,'ابتدا پرداخت‌های تسویه‌نشده امدادگر را تعیین تکلیف کنید.');
   }
   const erased=await eraseCustomer(tx,user,new Date());
   await audit(tx,req.operatorActor,'USER_DELETE',userId,{reason:input.reason,role:user.role});
   return erased;
  });
  io.in(`user:${userId}`).disconnectSockets(true);
  for(const key of result.removedFiles){if(!key||path.basename(key)!==key||!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?$/.test(key))continue;try{await fs.unlink(path.join(config.UPLOAD_DIR,key));}catch(e){if(e.code!=='ENOENT')console.error('Account media cleanup:',e.code||'FAILED');}}
  res.json({deleted:true});
 });
}
module.exports={registerAccountDeletion};
