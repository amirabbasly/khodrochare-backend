function orderPlans(order){return order.snapshot.plans||[{...order.snapshot,code:order.planCode}];}
const boostFields={LADDER:'ladderUntil',FEATURED:'featuredUntil',URGENT:'urgentUntil'};
module.exports={orderPlans,boostFields};
