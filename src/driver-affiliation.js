const {z}=require('zod');
const {HttpError}=require('./domain');
const input=z.discriminatedUnion('branding',[
 z.object({branding:z.literal(true)}).strict(),
 z.object({branding:z.literal(false),activity:z.enum(['OTHER_COMPANY','FREELANCE','ROADSIDE_COMPANY']),companyName:z.string().trim().min(2).max(150).optional()}).strict().refine(v=>v.activity!=='OTHER_COMPANY'||Boolean(v.companyName),'نام شرکت را وارد کنید.')
]);
async function read(prisma,userId){return (await prisma.$queryRaw`SELECT "branding","activity","companyName" FROM "DriverAffiliation" WHERE "userId"=${userId}`)[0]||null;}
function register({app,prisma,auth}){
 app.get('/api/v1/me/affiliation',auth,async(req,res)=>{if(req.user.role!=='DRIVER')throw new HttpError(403,'این بخش مخصوص امدادگران است.');res.set('Cache-Control','no-store').json(await read(prisma,req.user.id));});
 app.patch('/api/v1/me/affiliation',auth,async(req,res)=>{
  if(req.user.role!=='DRIVER')throw new HttpError(403,'این بخش مخصوص امدادگران است.');
  const value=input.parse(req.body),activity=value.branding?null:value.activity,companyName=!value.branding&&value.activity==='OTHER_COMPANY'?value.companyName:null;
  await prisma.$executeRaw`INSERT INTO "DriverAffiliation" ("userId","branding","activity","companyName") VALUES (${req.user.id},${value.branding},${activity},${companyName}) ON CONFLICT ("userId") DO UPDATE SET "branding"=EXCLUDED."branding","activity"=EXCLUDED."activity","companyName"=EXCLUDED."companyName","updatedAt"=CURRENT_TIMESTAMP`;
  res.set('Cache-Control','no-store').json(await read(prisma,req.user.id));
 });
}
module.exports={register,read,input};
