const {HttpError,hash}=require('./domain');
const {createPayments,lockRequest,settleEarning}=require('./payments');
const {createZarinpal}=require('./zarinpal');
const {isRequestExpired}=require('./request-expiry');
function safePayment(payment,gatewayMode='sandbox'){if(!payment)return null;const{cardNumber,accountName,attempts,...safe}=payment;return{...safe,gatewayMode};}
function createGatewayPayments(prisma,config,provider=createZarinpal(config)){
  async function releasePending(tx,paymentId,checkoutId){
    if(!await tx.gatewayCheckout.findFirst({where:{paymentId,id:{not:checkoutId},status:{in:['CREATING','PENDING']}}}))await tx.payment.updateMany({where:{id:paymentId,status:'GATEWAY_PENDING'},data:{status:'AWAITING_PAYMENT'}});
  }
  const payments=createPayments(prisma);
  const present=checkout=>({id:checkout.id,status:checkout.status,mode:checkout.mode,amountToman:checkout.amountToman,purpose:checkout.purpose,refId:checkout.refId,verifiedAt:checkout.verifiedAt,url:checkout.status==='PENDING'?provider.redirect(checkout.authority,checkout.mode):null});
  async function start(user,input){
    const payment=input.requestId?await payments.getOrCreate(input.requestId,user.id):null;
    const amountToman=payment?.amountToman??input.amountToman;
    const checkout=await prisma.$transaction(async tx=>{
      if(payment){
        await lockRequest(tx,payment.requestId);
        const request=await tx.assistanceRequest.findUnique({where:{id:payment.requestId}});
        if(request?.status==='CANCELLED')throw new HttpError(409,'Cancelled request cannot be paid');
        if(request&&isRequestExpired(request))throw new HttpError(409,'Expired request cannot be paid');
        const current=await tx.payment.findUnique({where:{id:payment.id}});
        if(current.status==='VERIFIED'||provider.mode==='sandbox'&&current.status==='SANDBOX_VERIFIED')throw new HttpError(409,'Payment is already verified');
        if(current.status==='SUBMITTED')throw new HttpError(409,'Legacy payment requires review');
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}),hashtext(${input.idempotencyKey}))::text AS locked`;
      const existing=await tx.gatewayCheckout.findUnique({where:{userId_idempotencyKey:{userId:user.id,idempotencyKey:input.idempotencyKey}}});
      if(existing){if(existing.amountToman!==amountToman||existing.paymentId!==(payment?.id||null)||existing.mode!==provider.mode)throw new HttpError(409,'Payment attempt changed');return existing;}
      if(payment){
        const pending=await tx.gatewayCheckout.findFirst({where:{paymentId:payment.id,status:{in:['CREATING','PENDING']}}});
        if(pending){
          if(pending.status==='CREATING'&&Date.now()-pending.createdAt.getTime()>120000)await tx.gatewayCheckout.update({where:{id:pending.id},data:{status:'FAILED',errorCode:'REQUEST_EXPIRED'}});
          else{if(pending.mode!==provider.mode)throw new HttpError(409,'Finish the existing payment attempt first');return pending;}
        }
        await tx.payment.update({where:{id:payment.id},data:{status:'GATEWAY_PENDING'}});
      }
      return tx.gatewayCheckout.create({data:{userId:user.id,paymentId:payment?.id||null,purpose:payment?'REQUEST':'WALLET',amountToman,mode:provider.mode,merchantHash:hash(provider.merchant()),idempotencyKey:input.idempotencyKey}});
    });
    if(checkout.status==='PENDING'||checkout.status==='VERIFIED')return present(checkout);
    if(checkout.status!=='CREATING')throw new HttpError(409,'Start a new payment attempt');
    // Only the creator may contact the gateway; concurrent duplicate submissions reuse it.
    const lease=await prisma.gatewayCheckout.updateMany({where:{id:checkout.id,status:'CREATING',errorCode:null},data:{errorCode:'REQUESTING'}});
    if(!lease.count)throw new HttpError(409,'Payment request is being created');
    try{
      const callback=new URL(config.PAYMENT_CALLBACK_URL||'https://api.khodrochare.ir/api/v1/payments/zarinpal/callback');callback.searchParams.set('checkout',checkout.id);
      const result=await provider.request({amountToman,callbackUrl:callback.href,description:payment?'پرداخت خدمات خودرو چاره':'شارژ کیف پول خودرو چاره',mobile:user.phone});
      return present(await prisma.gatewayCheckout.update({where:{id:checkout.id},data:{authority:result.authority,status:'PENDING',errorCode:null}}));
    }catch(error){
      await prisma.$transaction(async tx=>{if(payment)await lockRequest(tx,payment.requestId);await tx.gatewayCheckout.updateMany({where:{id:checkout.id,status:'CREATING'},data:{status:'FAILED',errorCode:'REQUEST_FAILED'}});if(payment)await tx.payment.updateMany({where:{id:payment.id,status:'GATEWAY_PENDING'},data:{status:'AWAITING_PAYMENT'}});});
      throw error;
    }
  }
  async function verify(id,authority,status){
    const checkout=await prisma.gatewayCheckout.findUnique({where:{id}});
    if(!checkout||!checkout.authority||checkout.authority!==authority)throw new HttpError(404,'Payment attempt not found');
    if(checkout.status==='VERIFIED')return checkout;
    if(status!=='OK'){
      return prisma.$transaction(async tx=>{
        if(checkout.paymentId){const payment=await tx.payment.findUnique({where:{id:checkout.paymentId}});await lockRequest(tx,payment.requestId);}
        await tx.$queryRaw`SELECT id FROM "GatewayCheckout" WHERE id=${id} FOR UPDATE`;
        const current=await tx.gatewayCheckout.findUnique({where:{id}});if(current.status==='VERIFIED')return current;
        const cancelled=await tx.gatewayCheckout.update({where:{id},data:{status:'CANCELLED'}});
        if(checkout.paymentId)await releasePending(tx,checkout.paymentId,checkout.id);
        return cancelled;
      });
    }
    if(checkout.merchantHash!==hash(provider.merchant(checkout.mode)))throw new HttpError(409,'Payment credentials changed');
    const result=await provider.verify(checkout);
    return prisma.$transaction(async tx=>{
      const payment=checkout.paymentId?await tx.payment.findUnique({where:{id:checkout.paymentId}}):null;
      if(payment)await lockRequest(tx,payment.requestId);
      await tx.$queryRaw`SELECT id FROM "GatewayCheckout" WHERE id=${id} FOR UPDATE`;
      const current=await tx.gatewayCheckout.findUnique({where:{id}});if(current.status==='VERIFIED')return current;
      const updated=await tx.gatewayCheckout.update({where:{id},data:{status:'VERIFIED',refId:result.refId,verifiedAt:new Date(),errorCode:null}});
      if(checkout.purpose==='WALLET')await tx.walletEntry.create({data:{userId:checkout.userId,checkoutId:id,amountToman:checkout.amountToman,mode:checkout.mode}});
      else{
        const latest=await tx.payment.findUnique({where:{id:payment.id}});
        if(latest.status==='VERIFIED'&&checkout.mode==='live')return tx.gatewayCheckout.update({where:{id},data:{status:'DUPLICATE_PAYMENT',errorCode:'REFUND_REVIEW_REQUIRED'}});
        const request=await tx.assistanceRequest.findUnique({where:{id:payment.requestId}});
        const status=request.status==='CANCELLED'||isRequestExpired(request)?'REFUND_REQUIRED':checkout.mode==='sandbox'?'SANDBOX_VERIFIED':'VERIFIED';
        const livePending=checkout.mode==='sandbox'&&await tx.gatewayCheckout.findFirst({where:{paymentId:payment.id,mode:'live',status:{in:['CREATING','PENDING']}}});
        if(latest.status!=='VERIFIED'&&!livePending)await tx.payment.update({where:{id:payment.id},data:{status,method:'GATEWAY',verifiedAt:new Date()}});
        await settleEarning(tx,payment.requestId);
        if (status === 'VERIFIED' && request.service === 'REPAIR' && request.operationsStartedAt && !request.driverCommissionConfirmedAt) await tx.assistanceRequest.update({where:{id:request.id},data:{driverCommissionConfirmedAt:new Date()}});
        await tx.outbox.create({data:{requestId:payment.requestId}});
        if(status==='REFUND_REQUIRED')return tx.gatewayCheckout.update({where:{id},data:{status:'REFUND_REQUIRED',errorCode:'REFUND_REVIEW_REQUIRED'}});
      }
      return updated;
    });
  }
  async function wallet(userId){
    const[groups,entries,earnings,debits]=await Promise.all([prisma.walletEntry.groupBy({by:['mode'],where:{userId},_sum:{amountToman:true}}),prisma.walletEntry.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50,select:{id:true,mode:true,amountToman:true,createdAt:true}}),prisma.driverEarning.aggregate({where:{driverId:userId,payment:{method:{not:'CASH'}}},_sum:{amountToman:true}}),prisma.walletDebit.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50}),]);
    const spent=await prisma.walletDebit.aggregate({where:{userId},_sum:{amountToman:true}});
    const history=[...entries.map(entry=>({...entry,kind:entry.amountToman<0?'CASH_COMMISSION':'TOPUP'})),...debits.map(entry=>({...entry,mode:'live',amountToman:-entry.amountToman,kind:entry.goldFundingId?'GOLD_FUNDING':entry.hallOrderId?'HALL_PAYMENT':'REQUEST_PAYMENT'}))].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,50);
    return{balanceToman:(groups.find(g=>g.mode==='live')?._sum.amountToman||0)+(earnings._sum.amountToman||0)-(spent._sum.amountToman||0),sandboxBalanceToman:groups.find(g=>g.mode==='sandbox')?._sum.amountToman||0,mode:provider.mode,entries:history};
  }
  return{start,verify,wallet,present};
}
module.exports={createGatewayPayments,safePayment};
