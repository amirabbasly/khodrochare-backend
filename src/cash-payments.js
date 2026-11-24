const {HttpError}=require('./domain');
const {createPayments,lockRequest,settleEarning}=require('./payments');
async function noPendingGateway(tx,paymentId){if(await tx.gatewayCheckout.findFirst({where:{paymentId,status:{in:['CREATING','PENDING']}}}))throw new HttpError(409,'ابتدا پرداخت در جریان درگاه را تعیین تکلیف کنید.');}
function createCashPayments(prisma){
 async function report(requestId,customerId){
  await createPayments(prisma).getOrCreate(requestId,customerId);
  return prisma.$transaction(async tx=>{
   await lockRequest(tx,requestId);const request=await tx.assistanceRequest.findUnique({where:{id:requestId}}),payment=await tx.payment.findUnique({where:{requestId}});
   if(!request||request.customerId!==customerId)throw new HttpError(404,'درخواست پیدا نشد.');
   if(!request.driverId||request.status!=='ARRIVED'||!payment||['VERIFIED','SANDBOX_VERIFIED','SUBMITTED','REFUND_REQUIRED'].includes(payment.status))throw new HttpError(409,'پرداخت در محل در این مرحله قابل ثبت نیست.');
   await noPendingGateway(tx,payment.id);
   const result=await tx.payment.update({where:{id:payment.id},data:{method:'CASH_PENDING',cashReportedAt:new Date(),status:'AWAITING_PAYMENT'}});await tx.outbox.create({data:{requestId}});return result;
  });
 }
 async function confirm(requestId,driverId){return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${driverId} FOR UPDATE`;await lockRequest(tx,requestId);
  const request=await tx.assistanceRequest.findUnique({where:{id:requestId}}),payment=await tx.payment.findUnique({where:{requestId}});
  if(!request||request.driverId!==driverId)throw new HttpError(404,'درخواست پیدا نشد.');
  if(payment?.method==='CASH'&&payment.status==='VERIFIED')return payment;
  if(request.status!=='ARRIVED'||payment?.method!=='CASH_PENDING'||!payment.cashReportedAt||payment.status!=='AWAITING_PAYMENT')throw new HttpError(409,'ابتدا مشتری پرداخت در محل را اعلام کند.');
  await noPendingGateway(tx,payment.id);
  const updated=await tx.payment.update({where:{id:payment.id},data:{status:'VERIFIED',method:'CASH',verifiedAt:new Date()}});
  await tx.walletEntry.create({data:{userId:driverId,paymentId:payment.id,amountToman:-payment.commissionToman,mode:'live'}});
  await settleEarning(tx,requestId);
  await tx.assistanceRequest.update({where:{id:requestId},data:{driverCommissionConfirmedAt:new Date()}});
  await tx.outbox.create({data:{requestId}});return updated;
 });}
 return{report,confirm};
}
module.exports={createCashPayments};
