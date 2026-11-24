const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {HttpError}=require('../domain');
function bridgeSignature(secret,method,url,timestamp,nonce,actor,body){
 const digest=createHash('sha256').update(JSON.stringify(body??null)).digest('hex');
 return createHmac('sha256',secret).update([method,url,timestamp,nonce,actor,digest].join('\n')).digest('hex');
}
function operatorAuth(config,redis){return async(req,_res,next)=>{
 try{
  if(!config.OPERATOR_BRIDGE_SECRET)throw new HttpError(503,'اتصال امن پنل اپراتور هنوز تنظیم نشده است.');
  const timestamp=req.get('X-Operator-Time')||'',nonce=req.get('X-Operator-Nonce')||'',encoded=req.get('X-Operator-Actor')||'',signature=req.get('X-Operator-Signature')||'';
  if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>60000||!/^[a-f0-9-]{36}$/.test(nonce)||encoded.length>1500||!/^[a-f0-9]{64}$/.test(signature))throw new HttpError(401,'Invalid operator signature');
  const expected=bridgeSignature(config.OPERATOR_BRIDGE_SECRET,req.method,req.originalUrl,timestamp,nonce,encoded,req.body);
  if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))throw new HttpError(401,'Invalid operator signature');
  let actor;try{actor=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw new HttpError(401,'Invalid operator identity');}
  if(!actor||!['admin','operator'].includes(actor.role)||typeof actor.id!=='string'||!actor.id||actor.id.length>64||typeof actor.name!=='string'||actor.name.length>160)throw new HttpError(403,'Operator access required');
  if(await redis.set(`operator-nonce:${nonce}`,'1','EX',120,'NX')!=='OK')throw new HttpError(401,'Operator request was already used');
  req.operatorActor=actor;next();
 }catch(error){next(error);}
};}
module.exports={operatorAuth,bridgeSignature};
