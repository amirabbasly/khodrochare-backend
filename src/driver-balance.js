const {HttpError}=require('./domain');
async function driverBalance(db,userId){
 const [wallet,earnings]=await Promise.all([db.walletEntry.aggregate({where:{userId,mode:'live'},_sum:{amountToman:true}}),db.driverEarning.aggregate({where:{driverId:userId,payment:{method:{not:'CASH'}}},_sum:{amountToman:true}})]);
 return (wallet._sum.amountToman||0)+(earnings._sum.amountToman||0);
}
async function assertDriverCredit(db,userId){if(await driverBalance(db,userId)<0)throw new HttpError(409,'تا زمان تسویه کمیسیون و بدهی کیف پول، اجازه گرفتن بار جدید ندارید.');}
module.exports={driverBalance,assertDriverCredit};
