const{test}=require('node:test');const assert=require('node:assert/strict');
const{randomUUID}=require('node:crypto');
const{details,draftSchema,analyzePrices,expressEligible,defaultPlans}=require('../src/hall/domain');
const{createHall,listingDto}=require('../src/hall/service');
const full={make:'پژو',model:'207',trim:'پانوراما',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودرو سالم با سابقه سرویس و نگهداری منظم',contactPhone:'09901234567',priceToman:3500000000};
test('Hall drafts may be incomplete, publication requires a separate valid contact and large car prices',()=>{
 assert.deepEqual(draftSchema.parse({description:'ناتمام',contactPhone:'09'}),{description:'ناتمام',contactPhone:'09'});
 assert.equal(details.required({priceToman:true}).parse(full).priceToman,3500000000);
 assert.throws(()=>details.parse({...full,contactPhone:'bad'}));assert.throws(()=>details.parse({...full,mileage:-1}));
});
test('Hall comparisons use actual prices, deduplicate owners and do not invent an empty-market quote',()=>{
 assert.equal(analyzePrices([]).suggested,null);
 const rows=[{ownerId:'a',priceToman:1000000000n},{ownerId:'a',priceToman:9000000000n},{ownerId:'b',priceToman:1200000000n}];
 const result=analyzePrices(rows);assert.equal(result.sampleCount,2);assert.equal(result.average,1100000000);assert.equal(result.min,1000000000);assert.equal(result.max,1200000000);
 const many=Array.from({length:10},(_,i)=>({ownerId:String(i),priceToman:BigInt(i===9?9000000000:1000000000+i*10000000)}));assert.ok(analyzePrices(many).max<9000000000);
});
test('48-hour priority requires healthy condition, recent year and bounded mileage',()=>{
 const now=new Date('2026-11-18T12:00:00Z');assert.equal(expressEligible(full,now),true);
 for(const patch of[{technicalCondition:'نیازمند تعمیر'},{bodyCondition:'تصادفی'},{mileage:200000},{year:1380},{year:2099}])assert.equal(expressEligible({...full,...patch},now),false);
});
function database(){
 const plans=new Map(),orders=[],row={id:randomUUID(),ownerId:'owner',version:2,status:'DRAFT',draft:{...full},priceToman:3500000000n,photos:[{id:randomUUID(),readToken:'secret',url:'',position:0}],orders:[]};let requests=0,verifications=0,activations=0;
 const match=(r,w)=>Object.entries(w).every(([k,v])=>k==='userId_idempotencyKey'?r.userId===v.userId&&r.idempotencyKey===v.idempotencyKey:v&&typeof v==='object'?'in'in v?v.in.includes(r[k]):'lt'in v?r[k]<v.lt:true:r[k]===v);
 const tx={$queryRaw:async()=>[],hallPlan:{upsert:async({where,create})=>{if(!plans.has(where.code))plans.set(where.code,create);},findUnique:async({where})=>plans.get(where.code),updateMany:async()=>({count:0})},hallBanner:{},hallListing:{findFirst:async({where})=>match(row,where)?{...row}:null,findUnique:async()=>({...row}),update:async({data})=>{if(data.status==='PUBLISHED')activations++;const{version,...rest}=data;Object.assign(row,rest);if(version)row.version+=version.increment;return{...row};}},hallOrder:{findUnique:async({where})=>orders.find(r=>match(r,where)),findFirst:async({where})=>orders.find(r=>match(r,where)),create:async({data})=>{const r={id:randomUUID(),status:'CREATING',errorCode:null,createdAt:new Date(),...data};orders.push(r);return{...r};},update:async({where,data})=>Object.assign(orders.find(r=>match(r,where)),data),updateMany:async({where,data})=>{const found=orders.filter(r=>match(r,where));found.forEach(r=>Object.assign(r,data));return{count:found.length};}}};
 const provider={mode:'sandbox',request:async()=>{requests++;return{authority:'S'+'1'.repeat(35)};},verify:async()=>{verifications++;return{refId:'123456'};},redirect:()=> 'https://sandbox.zarinpal.com/pg/StartPay/test'};
 const prisma={...tx,$transaction:fn=>fn(tx)},service=createHall(prisma,{},provider);
 return{service,row,orders,plans,provider,counts:()=>({requests,verifications,activations})};
}
test('free Hall publication requires ownership, complete data and a photo, without any payment',async()=>{
 const db=database();await assert.rejects(db.service.freePublish(db.row.id,'stranger'),{status:404});
 const photos=db.row.photos;db.row.photos=[];await assert.rejects(db.service.freePublish(db.row.id,'owner'),{status:400});db.row.photos=photos;
 const published=await db.service.freePublish(db.row.id,'owner');assert.equal(published.status,'PUBLISHED');await db.service.freePublish(db.row.id,'owner');assert.equal(db.counts().activations,1);assert.equal(db.counts().requests,0);assert.equal(db.row.draft.contactPhone,full.contactPhone);
});
test('paid Hall publication uses server fee, stays private until verified and activates once on repeated callbacks',async()=>{
 const db=database(),key=randomUUID();
 const order=await db.service.checkout({id:'owner',phone:'09121234567'},db.row.id,{planCode:'MANAGED',idempotencyKey:key});
 assert.equal(order.amountToman,defaultPlans[0].priceToman);assert.equal(db.row.status,'DRAFT');assert.equal(order.mode,'sandbox');await assert.rejects(db.service.save(db.row.id,'owner',full,db.row.version),{status:409});
 await db.service.checkout({id:'owner'},db.row.id,{planCode:'MANAGED',idempotencyKey:key});assert.equal(db.counts().requests,1);
 const paid=await db.service.verify(order.id,db.orders[0].authority,'OK');assert.equal(paid.status,'VERIFIED');assert.equal(db.row.status,'PUBLISHED');
 await db.service.verify(order.id,db.orders[0].authority,'OK');assert.equal(db.counts().activations,1);assert.equal(db.counts().verifications,1);
});
test('failed and cancelled payments retain drafts; a changed listing after late verification needs review',async()=>{
 const db=database(),user={id:'owner'};const first=await db.service.checkout(user,db.row.id,{planCode:'MANAGED',idempotencyKey:randomUUID()});
 await assert.rejects(db.service.verify(first.id,'S'+'2'.repeat(35),'OK'),{status:404});assert.equal(db.row.status,'DRAFT');
 await db.service.verify(first.id,db.orders[0].authority,'NOK');assert.equal(db.row.status,'DRAFT');assert.equal(db.orders[0].status,'CANCELLED');
 db.row.version++;const late=await db.service.verify(first.id,db.orders[0].authority,'OK');assert.equal(late.status,'REVIEW_REQUIRED');assert.equal(db.row.status,'DRAFT');assert.equal(db.counts().activations,0);
});
test('upgrades cannot activate before verification and publication rejects forged or ineligible plans',async()=>{
 const db=database();await assert.rejects(db.service.checkout({id:'owner'},db.row.id,{planCode:'LADDER',idempotencyKey:randomUUID()}),{status:400});
 db.row.draft.bodyCondition='تصادفی';await assert.rejects(db.service.checkout({id:'owner'},db.row.id,{planCode:'EXPRESS48',idempotencyKey:randomUUID()}),{status:400});db.row.draft.bodyCondition='سالم';
 await db.service.freePublish(db.row.id,'owner');const order=await db.service.checkout({id:'owner'},db.row.id,{planCode:'LADDER',idempotencyKey:randomUUID()});assert.equal(db.row.ladderUntil,undefined);
 await db.service.verify(order.id,db.orders[0].authority,'OK');assert.ok(db.row.ladderUntil>new Date());
});

test('a successful late boost payment on a sold car is held for review instead of consuming the service',async()=>{
 const db=database();await db.service.freePublish(db.row.id,'owner');
 const order=await db.service.checkout({id:'owner'},db.row.id,{planCode:'FEATURED',idempotencyKey:randomUUID()});db.row.status='SOLD';
 const result=await db.service.verify(order.id,db.orders[0].authority,'OK');assert.equal(result.status,'REVIEW_REQUIRED');assert.equal(db.row.featuredUntil,undefined);
});
test('gateway failure cannot publish an ad; stale edits and active pending payments are rejected',async()=>{
 const db=database();await assert.rejects(db.service.save(db.row.id,'owner',full,1),{status:409});
 db.provider.request=async()=>{throw new Error('offline');};await assert.rejects(db.service.checkout({id:'owner'},db.row.id,{planCode:'MANAGED',idempotencyKey:randomUUID()}),/offline/);assert.equal(db.orders[0].status,'FAILED');assert.equal(db.row.status,'DRAFT');
});
test('public Hall DTO exposes the listing contact only when published and strips owner identity and image read tokens',()=>{
 const db=database(),publicRow=listingDto({...db.row,status:'PUBLISHED'});assert.equal(publicRow.ownerId,undefined);assert.equal(publicRow.details,undefined);assert.ok(!publicRow.photos[0].url.includes('secret'));assert.equal(publicRow.contactPhone,full.contactPhone);assert.equal(listingDto(db.row).contactPhone,undefined);
});

test('every Hall admin mutation and private owner route authenticates before reading or writing data',async()=>{
 const express=require('express'),http=require('node:http'),app=express();app.use(express.json());
 const forbidden=new Proxy({},{get(){assert.fail('Unauthenticated request reached the database');}});
 const deny=(_req,res)=>res.status(401).json({error:'Authentication required'});
 require('../src/hall/routes').registerHall({app,prisma:forbidden,redis:{},config:{},auth:deny,admin:deny,limit:()=>((_req,_res,next)=>next())});
 app.use((e,_req,res,_next)=>res.status(400).json({error:e.message}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const root=`http://127.0.0.1:${server.address().port}/api/v1`,id=randomUUID();
  for(const[method,route]of[['GET','/admin/hall/orders'],['POST','/admin/hall/banners'],['PUT','/admin/hall/plans/FREE'],['PATCH',`/admin/hall/listings/${id}`],['PATCH',`/admin/hall/orders/${id}`],['POST',`/admin/hall/orders/${id}/verify`],['GET','/hall/mine'],['PATCH',`/hall/mine/${id}`]]){
   const response=await fetch(root+route,{method,headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:'{}'});assert.equal(response.status,401,route);
  }
 }finally{await new Promise(r=>server.close(r));}
});

test('published owner edits preserve publication, reject stale versions and clear the inspection approval',async()=>{
 const db=database();await db.service.freePublish(db.row.id,'owner');db.row.inspectionStatus='VERIFIED';db.row.inspectionNote='old';
 await assert.rejects(db.service.save(db.row.id,'stranger',full,db.row.version),{status:404});
 await assert.rejects(db.service.save(db.row.id,'owner',{},db.row.version));
 const edited=await db.service.save(db.row.id,'owner',{...full,priceToman:4000000000},db.row.version);
 assert.equal(edited.status,'PUBLISHED');assert.equal(edited.priceToman,4000000000);assert.equal(edited.inspectionStatus,'NOT_INSPECTED');assert.equal(edited.inspectionNote,null);
 await assert.rejects(db.service.save(db.row.id,'owner',full,2),{status:409});
});
