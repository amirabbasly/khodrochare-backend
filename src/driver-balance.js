const {HttpError}=require('./domain');
const driverBalance=require('./wallet-spending').walletBalance;
async function assertDriverCredit(db,userId){if(await driverBalance(db,userId)<0)throw new HttpError(409,'تا زمان تسویه کمیسیون و بدهی کیف پول، اجازه گرفتن بار جدید ندارید.');}
module.exports={driverBalance,assertDriverCredit};
