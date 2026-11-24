const {z}=require('zod');
const multer=require('multer');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {HttpError,digits}=require('./domain');
function destination(config){const card=(config.WALLET_TRANSFER_CARD||'').replace(/\s/g,'');return /^\d{16}$/.test(card)&&config.WALLET_TRANSFER_ACCOUNT?{cardNumber:card,accountName:config.WALLET_TRANSFER_ACCOUNT}:null;}
function registerWalletReceipts({app,prisma,config,auth,limit}){
 const root='/api/v1/wallet/receipts';
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,fieldSize:100}});
 app.get(root,auth,async(req,res)=>{const items=await prisma.walletReceipt.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:50,select:{id:true,amountToman:true,bankReference:true,status:true,reviewNote:true,createdAt:true,reviewedAt:true}});res.set('Cache-Control','no-store').json({items,destination:destination(config)});});
 app.post(root,auth,limit('wallet-receipt',10,3600),upload.single('file'),async(req,res)=>{
  if(!destination(config))throw new HttpError(503,'اطلاعات کارت شرکت هنوز تنظیم نشده است؛ از درگاه استفاده کنید.');
  const input=z.object({amountToman:z.preprocess(v=>typeof v==='string'?Number(digits(v).replace(/[,٬]/g,'')):v,z.number().int().min(10000).max(100000000)),bankReference:z.string().transform(digits).pipe(z.string().regex(/^\d{6,30}$/))}).strict().parse(req.body);
  const buffer=req.file?.buffer,mimeType=buffer?.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':buffer?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;
  if(!mimeType)throw new HttpError(400,'تصویر رسید باید JPEG یا PNG و حداکثر ۵ مگابایت باشد.');
  const storageKey='receipt-'+randomUUID();await fs.mkdir(config.UPLOAD_DIR,{recursive:true});await fs.writeFile(path.join(config.UPLOAD_DIR,storageKey),buffer,{flag:'wx',mode:0o600});
  let oldKey;
  try{const row=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('wallet-receipt'),hashtext(${input.bankReference}))::text AS locked`;
   const old=await tx.walletReceipt.findUnique({where:{bankReference:input.bankReference}});
   if(!old)return tx.walletReceipt.create({data:{...input,userId:req.user.id,storageKey,mimeType}});
   await tx.$queryRaw`SELECT id FROM "WalletReceipt" WHERE id=${old.id} FOR UPDATE`;
   const current=await tx.walletReceipt.findUnique({where:{id:old.id}});
   if(current.userId!==req.user.id||current.status!=='REJECTED')throw new HttpError(409,'رسیدی با این شماره پیگیری قبلاً ثبت شده است.');
   oldKey=current.storageKey;return tx.walletReceipt.update({where:{id:current.id},data:{...input,storageKey,mimeType,status:'SUBMITTED',reviewedAt:null,reviewedBy:null,reviewNote:null,version:{increment:1}}});
  });if(oldKey)await fs.unlink(path.join(config.UPLOAD_DIR,oldKey)).catch(()=>{});res.status(201).json({id:row.id,status:row.status,amountToman:row.amountToman,createdAt:row.createdAt});}catch(error){await fs.unlink(path.join(config.UPLOAD_DIR,storageKey)).catch(()=>{});throw error;}
 });
}
async function reviewReceipt(tx,id,approve,actor,note,version){
 const initial=await tx.walletReceipt.findUnique({where:{id}});if(!initial)throw new HttpError(404,'رسید پیدا نشد.');
 await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "WalletReceipt" WHERE id=${id} FOR UPDATE`;
 const row=await tx.walletReceipt.findUnique({where:{id}});
 if(row.status!=='SUBMITTED'||row.version!==version)throw new HttpError(409,'این رسید قبلاً بررسی شده است.');
 if(!approve&&note.length<3)throw new HttpError(400,'علت رد رسید را بنویسید.');
 const result=await tx.walletReceipt.update({where:{id},data:{status:approve?'APPROVED':'REJECTED',reviewedAt:new Date(),reviewedBy:actor.name,reviewNote:note,version:{increment:1}}});
 if(approve)await tx.walletEntry.create({data:{userId:row.userId,receiptId:id,amountToman:row.amountToman,mode:'live'}});
 await tx.operatorAudit.create({data:{actorId:actor.id,actorRole:actor.role,actorName:actor.name,action:approve?'RECEIPT_APPROVE':'RECEIPT_REJECT',targetId:id,details:{note,amountToman:row.amountToman,userId:row.userId}}});
 return result;
}
module.exports={registerWalletReceipts,reviewReceipt};
