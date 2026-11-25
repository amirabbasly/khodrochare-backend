const {z}=require('zod');
const d=require('./domain');
const pendingMessage='احراز هویت شما در صف بررسی قرار دارد. اگر مشکلی در اطلاعات یا مدارک باشد، اپراتور با شماره تماس ثبت‌شده شما تماس می‌گیرد.';
function assertVerifiedDriver(user){if(user.role==='DRIVER'&&user.verificationStatus!=='APPROVED')throw new d.HttpError(403,pendingMessage);}
function restrictedDriverAction(req){
 if(req.user?.role!=='DRIVER'||req.user.verificationStatus==='APPROVED'||['GET','HEAD','OPTIONS'].includes(req.method))return false;
 // Authentication, profile, documents, support and telemetry remain available.
 // Previously assigned work may still be finished while a review is pending.
 if(/^\/api\/v1\/requests\/[^/]+\/accept$/.test(req.path))return true;
 return /^\/api\/v1\/(hall|market|garage|assistant|gateway)(\/|$)/.test(req.path);
}
function registerVerificationNotices({app,prisma,auth,role}){
 app.post('/api/v1/me/verification-notices/:kind',auth,role('DRIVER'),async(req,res)=>{
  const kind=z.enum(['registration','approval']).parse(req.params.kind);
  const field=kind==='registration'?'registrationNoticeSeenAt':'verificationNoticeSeenAt';
  const where={id:req.user.id,[field]:null,...(kind==='approval'?{verificationStatus:'APPROVED'}:{})};
  await prisma.user.updateMany({where,data:{[field]:new Date()}});
  const user=await prisma.user.findUnique({where:{id:req.user.id}});
  const {passwordHash,...safe}=user;res.set('Cache-Control','no-store').json(safe);
 });
}
module.exports={pendingMessage,assertVerifiedDriver,restrictedDriverAction,registerVerificationNotices};
