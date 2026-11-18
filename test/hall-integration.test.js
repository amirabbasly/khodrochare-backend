const{test}=require('node:test');const assert=require('node:assert/strict');const{randomUUID}=require('node:crypto');
test('Hall real PostgreSQL persists BigInt prices, isolates owners, snapshots tariffs and activates a paid ad once',{skip:process.env.RUN_INTEGRATION!=='1',timeout:60000},async()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/khodrochare_test');
 const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();const ids=[];
 try{
  const {createHall}=require('../src/hall/service'),{indexFields}=require('../src/hall/domain');
  const owner=await db.user.create({data:{role:'CUSTOMER',fullName:'Hall test owner',phone:'09'+String(Date.now()).slice(-9),nationalId:String(Date.now()).slice(-10),passwordHash:'fixture-not-a-real-password'}});ids.push(owner.id);
  const provider={mode:'sandbox',redirect:a=>'https://sandbox.zarinpal.com/pg/StartPay/'+a,request:async()=>({authority:'S'+randomUUID().replace(/-/g,'')+'123'}),verify:async()=>({refId:'123456789'})};
  const service=createHall(db,{},provider);await service.ready();
  const details={make:'پژو',model:'207',trim:'fixture',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودروی نمونه برای آزمون یکپارچه تالار و قیمت میلیاردی',contactPhone:'09901234567',priceToman:3500000000};
  const draft=await db.hallListing.create({data:{ownerId:owner.id,draft:{}}});await service.save(draft.id,owner.id,details,0);
  await db.hallPhoto.create({data:{listingId:draft.id,storageKey:'fixture-'+randomUUID(),mimeType:'image/png'}});
  await assert.rejects(service.owned(draft.id,randomUUID()),{status:404});
  const order=await service.checkout(owner,draft.id,{planCode:'MANAGED',idempotencyKey:randomUUID()});assert.equal(order.status,'PENDING');assert.equal((await db.hallListing.findUnique({where:{id:draft.id}})).status,'DRAFT');
  const originalFee=order.amountToman;await db.hallPlan.update({where:{code:'MANAGED'},data:{priceToman:originalFee+100000}});
  const stored=await db.hallOrder.findUnique({where:{id:order.id}});assert.equal(stored.amountToman,originalFee);
  await service.verify(order.id,stored.authority,'OK');await service.verify(order.id,stored.authority,'OK');
  const published=await service.owned(draft.id,owner.id);assert.equal(published.status,'PUBLISHED');assert.equal(published.priceToman,3500000000n);assert.equal(published.draft.contactPhone,'09901234567');assert.equal(published.orders.length,1);
  assert.equal((await db.user.findUnique({where:{id:owner.id}})).phone,owner.phone);
  await db.hallPlan.update({where:{code:'MANAGED'},data:{priceToman:originalFee}});
  const incompatible=await db.hallListing.create({data:{ownerId:owner.id,status:'PUBLISHED',publishedAt:new Date(),draft:{...details,trim:'different'},...indexFields({...details,trim:'different'})}});
  assert.ok(incompatible.id);const result=await service.estimate(details,randomUUID());assert.equal(result.sampleCount,1);assert.equal(result.isEstimate,true);
 }finally{
  if(ids.length){const listings=await db.hallListing.findMany({where:{ownerId:{in:ids}},select:{id:true}}),where={listingId:{in:listings.map(l=>l.id)}};await db.hallOrder.deleteMany({where});await db.hallPhoto.deleteMany({where});await db.hallInquiry.deleteMany({where});await db.hallListing.deleteMany({where:{ownerId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});}
  await db.$disconnect();
 }
});
