const {z}=require('zod');
const {HttpError}=require('./domain');
const uuid=z.string().uuid();
const digits=s=>s.replace(/[۰-۹٠-٩]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.includes(d)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(d):'٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const input=z.object({id:uuid,proof:uuid,kind:z.enum(['CARS','PARTS']),fullName:z.string().trim().min(2).max(120),phone:z.string().transform(digits).pipe(z.string().regex(/^09\d{9}$/)),city:z.string().trim().min(2).max(100),subject:z.string().trim().min(2).max(200),description:z.string().trim().min(10).max(3000),partCode:z.string().trim().max(100).default('')}).strict();
function registerImportRequests({app,prisma,redis,auth,limit}){
 const captcha=require('./hall/captcha').createCaptcha(redis,'imports');
 app.post('/api/v1/imports/captcha/:id',auth,limit('import-captcha',12,600),async(req,res)=>res.json(await captcha.issue(req.user.id,uuid.parse(req.params.id))));
 app.post('/api/v1/imports/captcha/:id/solve',auth,limit('import-captcha-solve',12,600),async(req,res)=>{
  const body=z.object({id:uuid,x:z.number().min(0).max(280)}).strict().parse(req.body);
  res.json(await captcha.solve(req.user.id,uuid.parse(req.params.id),body));
 });
 app.post('/api/v1/imports/requests',auth,limit('import-submit',10,3600),async(req,res)=>{
  const {proof,...data}=input.parse(req.body);
  // Per-request advisory lock serializes retries without exposing another owner.
  const row=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${data.id}))::text AS locked`;
   const old=await tx.importRequest.findUnique({where:{id:data.id}});
   if(old){if(old.userId!==req.user.id||Object.entries(data).some(([key,value])=>old[key]!==value))throw new HttpError(409,'درخواست با این شناسه قبلاً ثبت شده است.');return old;}
   await captcha.consume(req.user.id,data.id,proof);
   return tx.importRequest.create({data:{...data,userId:req.user.id}});
  });res.status(201).json({id:row.id,createdAt:row.createdAt});
 });
}
function registerImportReview({app,root,prisma}){
 app.get(root+'/imports',async(req,res)=>{
  const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),kind:z.enum(['ALL','CARS','PARTS']).default('ALL'),q:z.string().trim().max(100).default('')}).parse(req.query);
  const where={...(q.kind==='ALL'?{}:{kind:q.kind}),...(q.q?{OR:['fullName','phone','subject','city'].map(key=>({[key]:{contains:q.q,mode:'insensitive'}}))}:{})};
  const [total,items]=await Promise.all([prisma.importRequest.count({where}),prisma.importRequest.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.limit,take:q.limit})]);
  res.json({items,pagination:{page:q.page,limit:q.limit,total,totalPages:Math.max(1,Math.ceil(total/q.limit))}});
 });
}
module.exports={registerImportRequests,registerImportReview};
