async function walletSummary(db,userId){
 const [credits,earnings,spent,net]=await Promise.all([
  db.walletEntry.aggregate({where:{userId,mode:'live',amountToman:{gt:0}},_sum:{amountToman:true}}),
  db.driverEarning.aggregate({where:{driverId:userId,payment:{method:{not:'CASH'}}},_sum:{amountToman:true}}),
  db.walletDebit.aggregate({where:{userId},_sum:{amountToman:true}}),
  db.walletEntry.aggregate({where:{userId,mode:'live'},_sum:{amountToman:true}}),
 ]);
 const topupsToman=credits._sum.amountToman||0,earningsToman=earnings._sum.amountToman||0,spendingToman=spent._sum.amountToman||0,ledgerNet=net._sum.amountToman||0;
 return {topupsToman,earningsToman,deductionsToman:topupsToman-ledgerNet,spendingToman,balanceToman:ledgerNet+earningsToman-spendingToman};
}
module.exports={walletSummary};
