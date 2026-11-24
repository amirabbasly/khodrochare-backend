const {createGatewayPayments}=require('./gateway-payments');
const {createHall}=require('./hall/service');

// Recover missed callbacks from the provider. Failure to verify NEVER means paid
// or cancelled: unresolved attempts continue to block account deletion.
async function reconcileCustomerPayments(prisma,config,userId){
 const [checkouts,orders]=await Promise.all([
  prisma.gatewayCheckout.findMany({where:{userId,status:'PENDING',authority:{not:null}},select:{id:true,authority:true},orderBy:{createdAt:'asc'},take:3}),
  prisma.hallOrder.findMany({where:{userId,status:'PENDING',authority:{not:null}},select:{id:true,authority:true},orderBy:{createdAt:'asc'},take:3}),
 ]);
 const gateway=createGatewayPayments(prisma,config),hall=createHall(prisma,config);
 await Promise.allSettled([
  ...checkouts.map(row=>gateway.verify(row.id,row.authority,'OK')),
  ...orders.map(row=>hall.verify(row.id,row.authority,'OK')),
 ]);
}
module.exports={reconcileCustomerPayments};
