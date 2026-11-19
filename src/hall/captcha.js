const {randomUUID,randomInt}=require('node:crypto');
const {HttpError}=require('../domain');
const piece='M0 0H14C10 -13 32 -13 28 0H42V14C55 10 55 32 42 28V42H28C32 55 10 55 14 42H0V28C-13 32 -13 10 0 14Z';
function createCaptcha(redis){
  const key=(type,user,listing,id)=>`hall:captcha:${type}:${user}:${listing}:${id}`;
  return {
    async issue(user,listing){
      const id=randomUUID(),x=randomInt(100,250),y=randomInt(35,85);
      await redis.set(key('challenge',user,listing,id),JSON.stringify({x,at:Date.now()}),'EX',120);
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><defs><linearGradient id="g"><stop stop-color="#164e63"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="320" height="160" rx="16" fill="url(#g)"/><path d="M0 135L70 70L140 130L210 50L320 140" fill="none" stroke="#99f6e4" stroke-width="18" opacity=".35"/><path d="${piece}" transform="translate(${x} ${y})" fill="#092f38" stroke="white" stroke-width="2" stroke-dasharray="4 3"/></svg>`;
      return {id,y,image:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'),expiresIn:120};
    },
    async solve(user,listing,{id,x}){
      const raw=await redis.getdel(key('challenge',user,listing,id));
      if(!raw)throw new HttpError(400,'پازل منقضی شده است؛ دوباره تلاش کنید.');
      const value=JSON.parse(raw);
      if(Date.now()-value.at<500||Math.abs(value.x-x)>12)throw new HttpError(400,'قطعه در جای درست قرار نگرفت؛ پازل تازه را حل کنید.');
      const proof=randomUUID();await redis.set(key('proof',user,listing,proof),'1','EX',120);return {proof};
    },
    async consume(user,listing,proof){if(!await redis.getdel(key('proof',user,listing,proof)))throw new HttpError(400,'برای انتشار، پازل را دوباره تکمیل کنید.');}
  };
}
module.exports={createCaptcha,piece};
