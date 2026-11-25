const{test}=require('node:test');const assert=require('node:assert/strict');
const{createZarinpal,SANDBOX_MERCHANT}=require('../src/zarinpal');
const{createGatewayPayments,safePayment}=require('../src/gateway-payments');const{hash}=require('../src/domain');
const authority='S'+'1'.repeat(35);
test('Zarinpal sandbox uses official endpoints and the same integer rial amount for request and verify',async()=>{
  const calls=[];const provider=createZarinpal({ZARINPAL_MODE:'sandbox'},async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return{ok:true,text:async()=>JSON.stringify({data:url.includes('request')?{code:100,authority}:{code:101,ref_id:12345}})};});
  await provider.request({amountToman:10000,callbackUrl:'https://api.khodrochare.ir/callback',description:'Test'});assert.equal(calls[0].body.amount,100000);assert.equal(calls[0].body.currency,'IRR');assert.equal(calls[0].body.merchant_id,SANDBOX_MERCHANT);assert.equal(calls[0].redirect,'error');
  assert.equal((await provider.verify({mode:'sandbox',amountToman:10000,authority})).refId,'12345');assert.equal(calls[1].body.amount,100000);assert.ok(calls.every(c=>c.url.startsWith('https://sandbox.zarinpal.com/pg/v4/payment/')));
  assert.equal(new URL(provider.redirect(authority)).hostname,'sandbox.zarinpal.com');
});
test('Live payments require an actual merchant and gateway failures never become successful payments',async()=>{
  assert.throws(()=>createZarinpal({ZARINPAL_MODE:'live'}).merchant(),{status:503});
  const provider=createZarinpal({ZARINPAL_MODE:'sandbox'},async()=>({ok:true,text:async()=>JSON.stringify({data:{code:-21}})}));
  await assert.rejects(provider.verify({mode:'sandbox',amountToman:10000,authority}),{status:409});
  await assert.rejects(provider.request({amountToman:10000,callbackUrl:'https://example.com',description:'Test'}),{status:502});
});
function database(mode='sandbox',purpose='WALLET'){
  const entries=[],earnings=[],checks=[];let calls=0;
  let payment={id:'p',requestId:'r',status:'AWAITING_PAYMENT',amountToman:1000000,driverShareToman:700000,commissionToman:300000};
  const request={id:'r',customerId:'u',driverId:'d',status:'COMPLETED',service:'REPAIR',priceToman:800000,partsApprovedToman:200000};
  const checkout={id:'checkout',userId:'u',paymentId:purpose==='REQUEST'?'p':null,purpose,mode,amountToman:purpose==='REQUEST'?1000000:10000,status:'PENDING',authority,merchantHash:hash('merchant'),idempotencyKey:'key',createdAt:new Date(),errorCode:null};checks.push(checkout);
  const matches=(row,where)=>Object.entries(where).every(([k,v])=>k==='userId_idempotencyKey'?row.userId===v.userId&&row.idempotencyKey===v.idempotencyKey:v&&typeof v==='object'?'in'in v?v.in.includes(row[k]):'not'in v?row[k]!==v.not:true:row[k]===v);
  const tx={walletDebit:{findMany:async()=>[],aggregate:async()=>({_sum:{amountToman:0}})},$queryRaw:async()=>[],gatewayCheckout:{findUnique:async({where})=>checks.find(c=>matches(c,where)),findFirst:async({where})=>checks.find(c=>matches(c,where)),create:async({data})=>{const row={id:'new-'+checks.length,status:'CREATING',errorCode:null,createdAt:new Date(),...data};checks.push(row);return row;},update:async({where,data})=>Object.assign(checks.find(c=>matches(c,where)),data),updateMany:async({where,data})=>{const rows=checks.filter(c=>matches(c,where));rows.forEach(c=>Object.assign(c,data));return{count:rows.length};}},payment:{findUnique:async()=>({...payment}),update:async({data})=>Object.assign(payment,data),updateMany:async({where,data})=>{if(matches(payment,where)){Object.assign(payment,data);return{count:1};}return{count:0};}},assistanceRequest:{findUnique:async()=>({...request,payment})},walletEntry:{create:async({data})=>{assert.equal(entries.some(e=>e.checkoutId===data.checkoutId),false);entries.push(data);},groupBy:async()=>['sandbox','live'].map(mode=>({mode,_sum:{amountToman:entries.filter(e=>e.mode===mode).reduce((s,e)=>s+e.amountToman,0)}})),findMany:async()=>entries},driverEarning:{aggregate:async({where})=>({_sum:{amountToman:earnings.filter(e=>e.driverId===where.driverId).reduce((sum,e)=>sum+e.amountToman,0)}}),createMany:async({data})=>earnings.push(...data)},outbox:{create:async()=>{}}};
  const provider={mode,merchant:()=> 'merchant',request:async()=>({authority}),redirect:()=> 'https://sandbox.zarinpal.com/pg/StartPay/'+authority,verify:async()=>{calls++;return{refId:'12345'};}};
  const prisma={...tx,$transaction:fn=>fn(tx)};
  return{service:createGatewayPayments(prisma,{},provider),checkout,entries,earnings,payment,request,checks,provider,calls:()=>calls};
}
test('Sandbox wallet confirmation is idempotent and cannot credit the real balance',async()=>{
  const db=database();await db.service.verify('checkout',authority,'OK');await db.service.verify('checkout',authority,'OK');
  assert.equal(db.entries.length,1);assert.equal(db.calls(),1);const wallet=await db.service.wallet('u');assert.equal(wallet.balanceToman,0);assert.equal(wallet.sandboxBalanceToman,10000);
});
test('Sandbox service payments preserve commissions but cannot produce live driver earnings',async()=>{
  const db=database('sandbox','REQUEST');await db.service.verify('checkout',authority,'OK');assert.equal(db.payment.status,'SANDBOX_VERIFIED');assert.equal(db.earnings.length,0);assert.equal(db.entries.length,0);
  const live=database('live','REQUEST');await live.service.verify('checkout',authority,'OK');await live.service.verify('checkout',authority,'OK');assert.equal(live.payment.status,'VERIFIED');assert.equal(live.earnings.length,1);assert.equal(live.earnings[0].amountToman,700000);
});
test('Callback authority tampering and cancellation cannot credit any wallet',async()=>{
  const db=database();await assert.rejects(db.service.verify('checkout','wrong','OK'),{status:404});assert.equal(db.calls(),0);
  await db.service.verify('checkout',authority,'NOK');assert.equal(db.checkout.status,'CANCELLED');assert.equal(db.entries.length,0);assert.equal(db.calls(),0);
  await db.service.verify('checkout',authority,'OK');assert.equal(db.entries.length,1,'A verified late callback can recover an earlier cancelled browser return');
});
test('Repeated checkout initiation reuses an existing request attempt without contacting the provider',async()=>{
  const db=database('sandbox','REQUEST');const result=await db.service.start({id:'u',phone:'09121234567'},{requestId:'r',idempotencyKey:'key'});assert.equal(result.id,'checkout');assert.equal(db.checks.length,1);assert.equal(db.calls(),0);
  assert.equal(safePayment({id:'p',cardNumber:'legacy-private',accountName:'legacy',attempts:[{}]}).cardNumber,undefined);
});
test('Unverified callbacks remain pending when server-side verification fails',async()=>{
  const db=database();db.provider.verify=async()=>{throw new Error('Gateway timeout');};await assert.rejects(db.service.verify('checkout',authority,'OK'));assert.equal(db.entries.length,0);assert.equal(db.checkout.status,'PENDING');
});
test('New wallet checkout stores its authority once and repeated clicks reuse it',async()=>{
  const db=database();db.checks.length=0;let requests=0;db.provider.request=async()=>{requests++;return{authority};};
  const user={id:'u',phone:'09121234567'},input={amountToman:10000,idempotencyKey:'new-key'};
  const first=await db.service.start(user,input),second=await db.service.start(user,input);assert.equal(requests,1);assert.equal(first.id,second.id);assert.equal(second.status,'PENDING');assert.equal(db.entries.length,0);
  await assert.rejects(db.service.start(user,{...input,amountToman:20000}),{status:409});
});
test('Gateway HTTP requires ownership and rejects malformed topups and retired manual transfers',async t=>{
  const http=require('node:http');const{createApp}=require('../src/app');
  const app=createApp({prisma:{gatewayCheckout:{findFirst:async()=>null}},redis:{eval:async()=>1},config:{origins:[],TRUST_PROXY:0},io:{},services:{authenticate:async token=>{if(!token)throw Object.assign(new Error('Authentication required'),{status:401});return{id:token,role:token==='driver'?'DRIVER':'CUSTOMER'};}}});
  const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const root=`http://127.0.0.1:${server.address().port}/api/v1`,post=(path,body,token='customer')=>fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal((await fetch(root+'/wallet')).status,401);
  assert.equal((await post('/wallet/topups',{amountToman:-1,idempotencyKey:'invalid'})).status,400);
  assert.equal((await post('/requests/r/payment/checkout',{},'driver')).status,403);
  assert.equal((await post('/requests/r/payment/report',{})).status,410);
  assert.equal((await fetch(root+'/payments/checkouts/00000000-0000-4000-8000-000000000001',{headers:{Authorization:'Bearer customer'}})).status,404);
});


test('a verified payment callback after request expiry preserves funds for refund review and never credits a driver',async()=>{
 for(const status of ['EXPIRED','PENDING']){
  const db=database('live','REQUEST');db.request.status=status;db.request.driverId=null;db.request.createdAt=new Date(Date.now()-7*60*60*1000);
  const result=await db.service.verify('checkout',authority,'OK');assert.equal(result.status,'REFUND_REQUIRED');assert.equal(db.payment.status,'REFUND_REQUIRED');assert.equal(db.earnings.length,0);assert.equal(db.entries.length,0);assert.equal(db.calls(),1);
 }
});

test('live request credits the assigned driver wallet before completion without charging an extra fee',async()=>{
 const db=database('live','REQUEST');db.request.status='ARRIVED';
 await db.service.verify('checkout',authority,'OK');await db.service.verify('checkout',authority,'OK');
 const wallet=await db.service.wallet(db.request.driverId);
 assert.equal(wallet.balanceToman,700000);assert.equal(db.earnings.length,1);
 assert.equal(db.payment.amountToman,1000000);
});
