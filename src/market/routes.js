const {z}=require('zod');
const {HttpError}=require('../domain');
const {createMarketService}=require('./service');
const {pageSchema,paged}=require('./torob/routes');
function registerMarket({app,prisma,redis,auth,admin,limit,config}){
  const root='/api/v1/market',service=createMarketService(prisma);
  const{published}=require('./torob/routes').registerTorobRoutes({app,prisma,redis,admin,limit,config});
  app.get(root+'/alerts',auth,async(req,res)=>res.json(await paged(prisma.marketAlert,{userId:req.user.id},pageSchema.parse(req.query),{include:{product:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'}})));
  app.post(root+'/alerts',auth,limit('market-alert',30,3600),async(req,res)=>{
    const p=z.object({productId:z.string().uuid(),targetToman:z.number().int().min(1).max(2147483647),sms:z.boolean().default(false),notifyStock:z.boolean().default(false)}).strict().parse(req.body);await published(p.productId);
    if(p.sms&&(!config.MARKET_SMS_URL||!config.MARKET_SMS_TOKEN))throw new HttpError(409,'SMS provider not configured');
    const result=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.user.id}),hashtext(${p.productId}))::text AS locked`;
      const key={userId_productId:{userId:req.user.id,productId:p.productId}};
      const existing=await tx.marketAlert.findUnique({where:key});
      if(existing?.active&&existing.targetToman===p.targetToman&&existing.sms===p.sms&&existing.notifyStock===p.notifyStock)return existing;
      const data={...p,active:true,lastEligible:false,lastInStock:false};
      return tx.marketAlert.upsert({where:key,create:{userId:req.user.id,...data},update:data});
    });res.status(201).json(result);
  });
  app.patch(root+'/alerts/:id',auth,async(req,res)=>{const data=z.object({active:z.boolean()}).strict().parse(req.body);const result=await prisma.marketAlert.updateMany({where:{id:req.params.id,userId:req.user.id},data});if(!result.count)throw new HttpError(404,'Market alert not found');res.status(204).end();});
  app.get(root+'/notifications',auth,async(req,res)=>res.json(await paged(prisma.marketNotification,{alert:{userId:req.user.id}},pageSchema.parse(req.query),{orderBy:{createdAt:'desc'},include:{alert:{select:{productId:true}}}})));
  app.patch(root+'/notifications/:id/read',auth,async(req,res)=>{const result=await prisma.marketNotification.updateMany({where:{id:req.params.id,alert:{userId:req.user.id},readAt:null},data:{readAt:new Date()}});res.json({updated:result.count});});

}
module.exports={registerMarket,pageSchema};
