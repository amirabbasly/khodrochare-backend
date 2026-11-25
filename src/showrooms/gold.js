const {createHmac,timingSafeEqual}=require('node:crypto');
const {HttpError}=require('../domain');
const {publicWhere,include,showroomDto}=require('./domain');
function createGold({prisma,config}){
 const secret=config.OPERATOR_BRIDGE_SECRET||config.OTP_HMAC_SECRET||config.JWT_SECRET;
 const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
 const visitor=req=>hash(req.user?`user:${req.user.id}`:`anon:${req.ip}:${req.get('user-agent')||''}`);
 function token(req,campaign){const body=Buffer.from(JSON.stringify({id:campaign.id,v:visitor(req),until:Date.now()+600000})).toString('base64url');return body+'.'+hash(body);}
 async function ads(req){
  if(!secret)return [];
  const rows=await prisma.goldCampaign.findMany({where:{isActive:true,balanceToman:{gte:prisma.goldCampaign.fields.bidToman},showroom:publicWhere},include:{showroom:{include}},orderBy:[{bidToman:'desc'},{createdAt:'asc'}],take:100});
  return rows.filter(c=>c.balanceToman>=c.bidToman).slice(0,12).map(c=>({showroom:showroomDto(c.showroom),token:token(req,c)}));
 }
 async function click(req,input){
  if(!secret)throw new HttpError(503,'تبلیغات هنوز تنظیم نشده است.');
  const [body,sig]=input.token.split('.');if(!body||!/^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(Buffer.from(hash(body),'hex'),Buffer.from(sig,'hex')))throw new HttpError(400,'لینک تبلیغ معتبر نیست.');
  let data;try{data=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new HttpError(400,'لینک تبلیغ معتبر نیست.');}
  if(data.until<Date.now()||data.v!==visitor(req))throw new HttpError(400,'لینک تبلیغ منقضی شده است.');
  return prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "GoldCampaign" WHERE id=${data.id} FOR UPDATE`;
   const campaign=await tx.goldCampaign.findUnique({where:{id:data.id},include:{showroom:{include}}});
   if(!campaign)throw new HttpError(404,'نمایشگاه پیدا نشد.');
   const s=campaign.showroom;
   if(s.status!=='PUBLISHED'||!s.isActive||!s.owner.isActive||!s.owner.user.isActive||s.owner.user.deletedAt)throw new HttpError(404,'نمایشگاه در دسترس نیست.');
   if(req.user?.id===s.ownerId)return {showroomId:s.id,charged:false};
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran'}).format(new Date()),existing=await tx.goldClick.findUnique({where:{campaignId_visitorHash_day:{campaignId:campaign.id,visitorHash:data.v,day}}});
   if(existing||!campaign.isActive||campaign.balanceToman<campaign.bidToman)return {showroomId:s.id,charged:false};
   await tx.goldClick.create({data:{campaignId:campaign.id,visitorHash:data.v,day,amountToman:campaign.bidToman}});
   await tx.goldCampaign.update({where:{id:campaign.id},data:{balanceToman:{decrement:campaign.bidToman}}});
   return {showroomId:s.id,charged:true};
  });
 }
 return {ads,click};
}
module.exports={createGold};
