const {z} = require('zod');
const d = require('./domain');
const {createCustomerAuth} = require('./customer-auth');
const {createServices} = require('./services');

const nationalId = z.string().transform(d.digits).refine(d.validNationalId, 'کد ملی معتبر نیست.');
const base = {fullName:z.string().trim().min(3).max(150).optional(),nationalId:nationalId.optional()};
function profileInput(role, body) {
  return z.object(role==='DRIVER'?{...base,activityCity:z.string().trim().min(2).max(100).optional(),activityDistrict:z.string().trim().max(150).optional()}:base).strict().refine(value=>Object.keys(value).length>0,'اطلاعاتی برای ذخیره وارد کنید.').parse(body);
}
function registerProfile({app,prisma,config,auth,limit,io,sms}) {
  require('./driver-affiliation').register({app,prisma,auth});
  const services = createServices({prisma,config});
  const otp = createCustomerAuth({prisma,config,services,sms});
  app.patch('/api/v1/me',auth,async(req,res)=>{
    const input=profileInput(req.user.role,req.body);
    const user=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
      const old=await tx.user.findUnique({where:{id:req.user.id}});
      const identityChanged=req.user.role==='DRIVER'&&((input.fullName!==undefined&&input.fullName!==old.fullName)||(input.nationalId!==undefined&&input.nationalId!==old.nationalId));
      return tx.user.update({where:{id:req.user.id},data:{...input,...(req.user.role==='DRIVER'?{verificationVersion:{increment:1}}:{}),...(identityChanged?{verificationStatus:'PENDING',verificationReviewedAt:null,verificationReviewedBy:null,verificationNoticeSeenAt:null}: {})},include:{vehicles:true}});
    });
    res.set('Cache-Control','no-store').json(services.safeUser(user));
  });
  app.post('/api/v1/me/phone/otp',auth,limit('profile-phone-send',10,3600),async(req,res)=>{
    const input=z.object({phone:d.phone,currentPassword:z.string().min(1).max(128)}).strict().parse(req.body);
    const user=await prisma.user.findUnique({where:{id:req.user.id}});
    if(!user?.passwordHash||!await d.verifyPassword(input.currentPassword,user.passwordHash))throw new d.HttpError(400,'رمز عبور فعلی درست نیست.');
    if(input.phone===user.phone)throw new d.HttpError(400,'شماره جدید با شماره فعلی یکسان است.');
    if(await prisma.user.findUnique({where:{role_phone:{role:user.role,phone:input.phone}}}))throw new d.HttpError(409,'این شماره برای حساب دیگری ثبت شده است.');
    res.set('Cache-Control','no-store').json(await otp.requestCode({phone:input.phone,purpose:'PROFILE_PHONE',context:`profile:${user.id}:${user.phone}`}));
  });
  app.post('/api/v1/me/phone',auth,limit('profile-phone-confirm',20,900),async(req,res)=>{
    const input=z.object({challengeId:z.string().uuid(),code:z.string().transform(d.digits).pipe(z.string().regex(/^\d{6}$/))}).strict().parse(req.body);
    const result=await otp.consume({...input,changePhone:{userId:req.user.id,oldPhone:req.user.phone,role:req.user.role,tokenHash:d.hash(req.token)}});
    io.in(`user:${req.user.id}`).disconnectSockets(true);
    res.set('Cache-Control','no-store').json(result.user);
  });
}
module.exports={registerProfile,profileInput};
