const {HttpError}=require('./domain');
const {createPayments,lockRequest,settleEarning}=require('./payments');
const {isRequestExpired}=require('./request-expiry');
async function walletBalance(db,userId){
 const [credits,earnings,debits]=await Promise.all([
  db.walletEntry.aggregate({where:{userId,mode:'live'},_sum:{amountToman:true}}),
  db.driverEarning.aggregate({where:{driverId:userId,payment:{method:{not:'CASH'}}},_sum:{amountToman:true}}),
  db.walletDebit.aggregate({where:{userId},_sum:{amountToman:true}}),
 ]);
 return (credits._sum.amountToman||0)+(earnings._sum.amountToman||0)-(debits._sum.amountToman||0);
}
// The caller holds the User row lock before any target locks. All wallet
// spending and cash commission debits serialize on that same account lock.
async function spendWallet(tx,userId,{paymentId,hallOrderId,amountToman}){
 if(!Number.isSafeInteger(amountToman)||amountToman<=0)throw new HttpError(400,'مبلغ پرداخت معتبر نیست.');
 if(await walletBalance(tx,userId)<amountToman)throw new HttpError(409,'موجودی کیف پول کافی نیست؛ ابتدا حساب را شارژ کنید.');
 return tx.walletDebit.create({data:{userId,paymentId,hallOrderId,amountToman}});
}
async function payRequestWithWallet(prisma,requestId,userId){
 await createPayments(prisma).getOrCreate(requestId,userId);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  await lockRequest(tx,requestId);
  const request=await tx.assistanceRequest.findUnique({where:{id:requestId}}),payment=await tx.payment.findUnique({where:{requestId}});
  if(!request||request.customerId!==userId)throw new HttpError(404,'درخواست پیدا نشد.');
  if(payment?.status==='VERIFIED'&&payment.method==='WALLET')return payment;
  if(!request.driverId||request.status!=='ARRIVED'||isRequestExpired(request))throw new HttpError(409,'پرداخت کیف پول در این مرحله قابل ثبت نیست.');
  if(!payment||!['AWAITING_PAYMENT','AWAITING_TRANSFER','REJECTED'].includes(payment.status)||payment.method==='CASH_PENDING')throw new HttpError(409,'ابتدا پرداخت در جریان را تعیین تکلیف کنید.');
  if(await tx.gatewayCheckout.findFirst({where:{paymentId:payment.id,status:{in:['CREATING','PENDING']}}}))throw new HttpError(409,'ابتدا پرداخت در جریان درگاه را تعیین تکلیف کنید.');
  await spendWallet(tx,userId,{paymentId:payment.id,amountToman:payment.amountToman});
  const paid=await tx.payment.update({where:{id:payment.id},data:{method:'WALLET',status:'VERIFIED',verifiedAt:new Date()}});
  await settleEarning(tx,requestId);
  if(['REPAIR','PERIODIC_SERVICE'].includes(request.service)&&request.operationsStartedAt&&!request.driverCommissionConfirmedAt)await tx.assistanceRequest.update({where:{id:requestId},data:{driverCommissionConfirmedAt:new Date()}});
  await tx.outbox.create({data:{requestId}});return paid;
 });
}
module.exports={walletBalance,spendWallet,payRequestWithWallet};
