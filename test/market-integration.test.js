const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const http=require('node:http');
test('Torob-only real database catalog, ingestion, shared fitments, offers and stale-price removal',{skip:process.env.RUN_INTEGRATION!=='1',timeout:120000},async()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/khodrochare_test');
 const{PrismaClient}=require('@prisma/client');const prisma=new PrismaClient();let server;
 try{
  const service=require('../src/market/torob/service').createTorobService(prisma,{});await service.bootstrap();
  const seed=await prisma.marketDiscoveryQuery.findFirst({where:{seedUrl:{not:null}}});assert.ok(seed);
  const parsed=require('../src/market/torob/parser').parseProduct(fs.readFileSync(require.resolve('./fixtures/market/torob-product.html'),'utf8'),'https://torob.com/p/c2a29e6f-b706-4695-ba9c-13767a09e807/');parsed.offers.forEach(o=>o.priceValidUntil=new Date(Date.now()+86400000));
  await service.ingest(seed,parsed,'test-cycle-one');await service.ingest(seed,parsed,'test-cycle-one');
  const ref=await prisma.marketReferencePrice.findUnique({where:{source_externalId:{source:'TOROB',externalId:parsed.externalId}}});assert.equal(await prisma.marketReferenceSnapshot.count({where:{referenceId:ref.id}}),1);
  assert.equal(await prisma.torobOffer.count({where:{referenceId:ref.id}}),6);
  const cars=[];for(const model of ['ماشین1','ماشین2'])cars.push(await prisma.marketCar.upsert({where:{key:'fixture|'+model},create:{key:'fixture|'+model,maker:'Fixture',model,trim:'نامشخص',aliases:[model]},update:{}}));
  await prisma.marketCompatibilityRule.create({data:{name:'TEST FIXTURE: shared battery',category:'batteries',carKeys:cars.map(c=>c.key),verified:true,evidenceUrl:'https://manufacturer.fixture-shop.ir/fitment',checkedAt:new Date(),expiresAt:new Date(Date.now()+86400000),requirements:{capacityAh:60,voltage:12,caseCode:'L2',polarity:'LEFT',technology:'WET',lengthMm:242,widthMm:175,heightMm:190}}});
  parsed.name='باتری سپاهان 60 آمپر 12 ولت L2 قطب چپ اتمی';parsed.specifications={طول:'242',عرض:'175',ارتفاع:'190'};
  await service.ingest(seed,parsed,'test-cycle-two');assert.equal(await prisma.marketProductCompatibility.count({where:{productId:ref.productId,confidence:'VERIFIED_RULE'}}),2);
  const app=require('../src/app').createApp({prisma,redis:{eval:async()=>1},config:{origins:[],TRUST_PROXY:0},services:{},io:{}});server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}/api/v1/market`;
  for(const car of cars){const res=await fetch(base+'/products?carId='+car.id),data=await res.json();assert.equal(res.status,200);assert.ok(data.items.some(p=>p.id===ref.productId));}
  const offers=await(await fetch(base+'/products/'+ref.productId+'/offers')).json();assert.equal(offers.total,4);assert.equal(offers.items[0].priceToman,4100000);assert.ok(offers.items[0].listing.url.startsWith('https://api.torob.com/v4/product-page/redirect/'));
  await prisma.marketReferencePrice.update({where:{id:ref.id},data:{expiresAt:new Date(Date.now()-1000)}});
  const product=await(await fetch(base+'/products/'+ref.productId)).json();assert.equal(product.minPriceToman,null);assert.equal(product.offerCount,0);
  assert.equal(await prisma.marketReferenceSnapshot.count({where:{referenceId:ref.id}}),2);
 }finally{if(server)await new Promise(r=>server.close(r));await prisma.$disconnect();}
});
