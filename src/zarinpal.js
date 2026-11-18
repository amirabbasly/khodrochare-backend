const {HttpError}=require('./domain');
const SANDBOX_MERCHANT='4f888a55-6826-4d3b-bd96-52aa36723114';
function createZarinpal(config,fetcher=fetch){
  const mode=config.ZARINPAL_MODE||'sandbox';
  function merchant(selected=mode){
    const value=selected==='sandbox'?SANDBOX_MERCHANT:config.ZARINPAL_MERCHANT_ID;
    if(!value||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)||selected==='live'&&value===SANDBOX_MERCHANT)throw new HttpError(503,'Payment gateway is not configured');
    return value;
  }
  const host=selected=>selected==='sandbox'?'https://sandbox.zarinpal.com':'https://payment.zarinpal.com';
  async function post(method,body,selected=mode){
    let response,data;
    try{
      response=await fetcher(`${host(selected)}/pg/v4/payment/${method}.json`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...body,merchant_id:merchant(selected)}),signal:AbortSignal.timeout(15000)});
      const raw=await response.text();if(raw.length>65536)throw new Error('Oversized response');data=JSON.parse(raw);
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'Payment gateway unavailable');}
    if(!response.ok||!data?.data)throw new HttpError(502,'Payment gateway rejected the request');
    return data.data;
  }
  async function request({amountToman,callbackUrl,description,mobile}){
    // Use integer rial in BOTH request and verify, without relying on defaults.
    const data=await post('request',{amount:amountToman*10,currency:'IRR',callback_url:callbackUrl,description,metadata:{mobile}});
    if(data.code!==100||typeof data.authority!=='string'||!/^[AS][A-Za-z0-9]{35}$/.test(data.authority)||data.authority[0]!== (mode==='sandbox'?'S':'A'))throw new HttpError(502,'Invalid payment gateway response');
    return{authority:data.authority};
  }
  async function verify(checkout){
    const data=await post('verify',{amount:checkout.amountToman*10,authority:checkout.authority},checkout.mode);
    if(![100,101].includes(data.code)||!/^\d{1,32}$/.test(String(data.ref_id)))throw new HttpError(409,'Payment was not verified');
    return{refId:String(data.ref_id)};
  }
  return{mode,merchant,request,verify,redirect:(authority,selected=mode)=>`${host(selected)}/pg/StartPay/${encodeURIComponent(authority)}`};
}
module.exports={createZarinpal,SANDBOX_MERCHANT};
