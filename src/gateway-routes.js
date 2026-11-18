const {z}=require('zod');
const {HttpError}=require('./domain');
const {createGatewayPayments}=require('./gateway-payments');
function registerGateway({app,prisma,config,auth,role,limit}){
  const service=createGatewayPayments(prisma,config);
  const key=z.object({idempotencyKey:z.string().uuid()}).strict();
  app.get('/api/v1/wallet',auth,async(req,res)=>res.set('Cache-Control','no-store').json(await service.wallet(req.user.id)));
  app.post('/api/v1/wallet/topups',auth,limit('wallet-topup',20,3600),async(req,res)=>{
    const input=key.extend({amountToman:z.number().int().min(10000).max(100000000)}).parse(req.body);
    res.status(201).json(await service.start(req.user,input));
  });
  app.post('/api/v1/requests/:id/payment/checkout',auth,role('CUSTOMER'),limit('payment-checkout',20,3600),async(req,res)=>res.status(201).json(await service.start(req.user,{...key.parse(req.body),requestId:req.params.id})));
  async function owned(id,userId){const checkout=await prisma.gatewayCheckout.findFirst({where:{id,userId}});if(!checkout)throw new HttpError(404,'Payment attempt not found');return checkout;}
  app.get('/api/v1/payments/checkouts/:id',auth,async(req,res)=>res.set('Cache-Control','no-store').json(service.present(await owned(z.string().uuid().parse(req.params.id),req.user.id))));
  app.post('/api/v1/payments/checkouts/:id/verify',auth,limit('payment-verify',20,3600),async(req,res)=>{
    const checkout=await owned(z.string().uuid().parse(req.params.id),req.user.id);
    res.json(service.present(await service.verify(checkout.id,checkout.authority,'OK')));
  });
  app.get('/api/v1/payments/zarinpal/callback',limit('gateway-callback',120,60),async(req,res)=>{
    const input=z.object({checkout:z.string().uuid(),Authority:z.string().regex(/^[AS][A-Za-z0-9]{35}$/),Status:z.enum(['OK','NOK'])}).parse(req.query);
    const checkout=await prisma.gatewayCheckout.findUnique({where:{id:input.checkout},include:{user:{select:{role:true}}}});
    if(!checkout||checkout.authority!==input.Authority)throw new HttpError(404,'Payment attempt not found');
    // Never trust callback Status as proof of money received.
    try{await service.verify(checkout.id,input.Authority,input.Status);}catch(error){if(!(error instanceof HttpError))throw error;}
    const result=new URL('/payment/return',checkout.user.role==='DRIVER'?(config.DRIVER_APP_URL||'https://driver.khodrochare.ir'):(config.CUSTOMER_APP_URL||'https://app.khodrochare.ir'));
    result.searchParams.set('checkout',checkout.id);
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).redirect(303,result.href);
  });
}
module.exports={registerGateway};
