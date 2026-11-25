const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient,Prisma}=require('@prisma/client');
const {createApp}=require('../src/app');
const {createServices}=require('../src/services');
const {bridgeSignature}=require('../src/operator/auth');
const {walletBalance}=require('../src/wallet-spending');
test('real receipt/spending migrations: Hall wallet mode regression, image-only review, both roles, five services, idempotence, ownership, insufficient and concurrent funds',{timeout:120000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server,uploads;
 try{
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  const names=['User','Document','Vehicle','Payment','PaymentAttempt','AssistanceRequest','DriverEarning','GatewayCheckout','WalletEntry','OperatorAudit','Outbox','HallOrder','HallListing','HallPlan','HallPhoto','HallBanner'];
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>names.includes(m.name))){
   const columns=model.fields.filter(f=>f.kind!=='object').map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);if(!type)return null;
    let def='';if(f.isList)def=" DEFAULT '{}'";else if(f.default?.name==='now'||f.isUpdatedAt)def=' DEFAULT CURRENT_TIMESTAMP';else if(f.hasDefaultValue&&typeof f.default!=='object')def=' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${f.default}'`);
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isUnique?' UNIQUE':f.isRequired?' NOT NULL':''}${def}`;
   }).filter(Boolean);await db.exec(`CREATE TABLE "${model.name}" (${columns.join(',')})`);
  }
  const migration=name=>fs.readFile(path.join(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8');
  const receiptSql=await migration('202611230004_onsite_cash_receipts');await db.exec(receiptSql.slice(receiptSql.indexOf('CREATE TABLE "WalletReceipt"'),receiptSql.indexOf('ALTER TABLE "WalletEntry"')));
  await db.exec(await migration('202611240005_receipt_review_amount'));await db.exec(await migration('202611240006_wallet_spending'));await db.exec('ALTER TABLE "HallListing" DROP COLUMN "showroomId"');await db.exec(await migration('202611250001_showrooms'));
  await db.exec('CREATE UNIQUE INDEX "HallPlan_code_key" ON "HallPlan"(code);CREATE UNIQUE INDEX "HallOrder_userId_idempotencyKey_key" ON "HallOrder"("userId","idempotencyKey");');
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:30000,maxWait:30000}});
  const customer=await prisma.user.create({data:{role:'CUSTOMER',fullName:'مشتری تست',phone:'09120000001',nationalId:'1234567891',passwordHash:'test',services:[]}}),other=await prisma.user.create({data:{role:'CUSTOMER',fullName:'مشتری دوم',phone:'09120000003',services:[]}}),driver=await prisma.user.create({data:{role:'DRIVER',fullName:'امدادگر تست',phone:'09120000002',verificationStatus:'PENDING',services:['REPAIR','TOWING','PERIODIC_SERVICE','MOBILE_CARWASH','INSPECTION']}});
  const people={customer,other,driver},secret='wallet-operator-test-secret-01234567890123456789';uploads=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'wallet-spending-'));
  const config={TRUST_PROXY:0,origins:[],UPLOAD_DIR:uploads,OPERATOR_BRIDGE_SECRET:secret,ZARINPAL_MODE:'sandbox'},redis={eval:async()=>1,set:async()=> 'OK'},io={};
  const services=createServices({prisma,redis,config,io});services.authenticateSession=undefined;services.authenticate=async token=>{if(!people[token])throw Object.assign(new Error('Authentication required'),{status:401});return people[token];};
  server=createApp({prisma,redis,config,io,services}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,method='GET',body,token='customer'){const r=await fetch(base+'/api/v1'+route,{method,headers:{Authorization:`Bearer ${token}`,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});return{status:r.status,data:r.status===204?null:await r.json()};}
  async function operator(route,method='GET',body){const url='/api/v1/operator'+route,at=String(Date.now()),nonce=randomUUID(),actor=Buffer.from(JSON.stringify({id:'op',role:'operator',name:'اپراتور تست'})).toString('base64url');const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Operator-Time':at,'X-Operator-Nonce':nonce,'X-Operator-Actor':actor,'X-Operator-Signature':bridgeSignature(secret,method,url,at,nonce,actor,body)},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
  async function submit(token,suffix){const form=new FormData();form.set('amountToman','99999999');form.set('file',new Blob([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from(suffix)],{type:'image/png'}),'receipt.png');return call('/wallet/receipts','POST',form,token);}
  const settings=await call('/wallet/receipts');assert.equal(settings.data.destination.cardNumber,'6219861435789192');
  for(const token of ['customer','driver']){
   const receipt=await submit(token,token);assert.equal(receipt.status,201);assert.equal(receipt.data.amountToman,null);assert.equal(await walletBalance(prisma,people[token].id),0);
   assert.equal((await submit(token,token)).data.id,receipt.data.id);assert.equal((await submit(token==='customer'?'other':'customer',token)).status,409);
   assert.equal((await operator(`/receipts/${receipt.data.id}`)).data.user.role,people[token].role);
   assert.equal((await operator(`/receipts/${receipt.data.id}/review`,'POST',{decision:'APPROVE',version:0})).status,400);
   assert.equal((await operator(`/receipts/${receipt.data.id}/review`,'POST',{decision:'APPROVE',version:0,amountToman:0})).status,400);
   assert.equal((await operator(`/receipts/${receipt.data.id}/review`,'POST',{decision:'APPROVE',version:0,amountToman:3000000})).status,200);
   assert.equal(await walletBalance(prisma,people[token].id),3000000);assert.equal((await submit(token,token)).status,409);
   assert.equal((await operator(`/receipts/${receipt.data.id}/review`,'POST',{decision:'APPROVE',version:0,amountToman:6000000})).status,409);assert.equal(await prisma.walletEntry.count({where:{receiptId:receipt.data.id}}),1);
  }
  driver.verificationStatus='APPROVED';await prisma.user.update({where:{id:driver.id},data:{verificationStatus:'APPROVED'}});
  let expected=3000000,driverExpected=3000000;
  async function job(service,owner=customer,amount=100000){return prisma.assistanceRequest.create({data:{customerId:owner.id,driverId:driver.id,service,status:'ARRIVED',vehicleName:'پژو',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:amount,partsApprovedToman:0,operationsStartedAt:new Date()}});}
  for(const service of driver.services){const request=await job(service);
   assert.equal((await call(`/requests/${request.id}/payment/wallet`,'POST',{confirmed:true},'other')).status,404);
   const paid=await call(`/requests/${request.id}/payment/wallet`,'POST',{confirmed:true});assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.data.method,'WALLET');assert.equal(paid.data.status,'VERIFIED');assert.equal(paid.data.amountToman,100000);
   expected-=100000;driverExpected+=service==='TOWING'?80000:70000;assert.equal(await walletBalance(prisma,customer.id),expected);assert.equal(await walletBalance(prisma,driver.id),driverExpected);
   assert.equal((await call(`/requests/${request.id}/payment/wallet`,'POST',{confirmed:true})).status,200);assert.equal(await prisma.walletDebit.count({where:{paymentId:paid.data.id}}),1);assert.equal(await prisma.driverEarning.count({where:{paymentId:paid.data.id}}),1);
   assert.equal((await call(`/requests/${request.id}/status`,'PATCH',{status:'COMPLETED'},'driver')).status,200);
  }
  const unfunded=await job('REPAIR',other);assert.equal((await call(`/requests/${unfunded.id}/payment/wallet`,'POST',{confirmed:true},'other')).status,409);assert.equal(await prisma.walletDebit.count({where:{userId:other.id}}),0);
  const pending=await job('REPAIR');const invoice=await require('../src/payments').createPayments(prisma).getOrCreate(pending.id,customer.id);await prisma.gatewayCheckout.create({data:{userId:customer.id,paymentId:invoice.id,purpose:'REQUEST',mode:'sandbox',status:'PENDING',amountToman:100000,merchantHash:'test',idempotencyKey:randomUUID()}});assert.equal((await call(`/requests/${pending.id}/payment/wallet`,'POST',{confirmed:true})).status,409);assert.equal(await prisma.walletDebit.count({where:{paymentId:invoice.id}}),0);
  const full={make:'پژو',model:'207',trim:'پانوراما',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودرو سالم با سابقه سرویس و نگهداری منظم',contactPhone:customer.phone,priceToman:3500000000,fuelType:'بنزین',gearboxType:'اتوماتیک',location:{latitude:35.7,longitude:51.4,visibility:'AREA'}};
  const listing=await prisma.hallListing.create({data:{ownerId:customer.id,status:'PUBLISHED',draft:full}});await prisma.hallPhoto.create({data:{listingId:listing.id,storageKey:randomUUID(),mimeType:'image/png',position:0}});
  await call('/hall/catalog');const plan=await prisma.hallPlan.findUnique({where:{code:'LADDER'}}),key=randomUUID();
  // Reproduce the production constraint from the actual original Hall migration.
  const hallSql=await migration('202611180003_car_hall');
  const modeCheck=hallSql.split('\n').find(line=>line.includes('ADD CONSTRAINT "HallOrder_mode_check"'));
  assert.ok(modeCheck);await db.exec(modeCheck);
  const beforeFailed=await walletBalance(prisma,customer.id);
  const failedHall=await call(`/hall/mine/${listing.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:key,method:'WALLET'});
  assert.equal(failedHall.status,500);assert.equal(await walletBalance(prisma,customer.id),beforeFailed);
  assert.equal(await prisma.hallOrder.count({where:{listingId:listing.id}}),0);
  assert.equal(await prisma.walletDebit.count({where:{hallOrderId:{not:null}}}),0);
  await db.exec(await migration('202611240007_hall_wallet_mode'));
  const hall=await call(`/hall/mine/${listing.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:key,method:'WALLET'});assert.equal(hall.status,201,JSON.stringify(hall));assert.equal(hall.data.paymentMethod,'WALLET');assert.equal(hall.data.mode,'live');assert.equal(hall.data.status,'VERIFIED');assert.ok((await prisma.hallListing.findUnique({where:{id:listing.id}})).ladderUntil>new Date());expected-=plan.priceToman;
  for(const data of [{mode:'live'},{mode:'live',refId:'GATEWAY-123'},{mode:'live',refId:'WALLET-test',authority:'gateway-authority'},{mode:'invalid'}])await assert.rejects(prisma.hallOrder.create({data:{userId:customer.id,listingId:listing.id,listingVersion:0,action:'UPGRADE',planCode:'LADDER',snapshot:{},amountToman:99000,idempotencyKey:randomUUID(),...data}}),/HallOrder_mode_check/);
  await prisma.hallOrder.create({data:{userId:customer.id,listingId:listing.id,listingVersion:0,action:'UPGRADE',planCode:'FEATURED',snapshot:{},amountToman:199000,idempotencyKey:randomUUID(),mode:'sandbox',status:'FAILED'}});
  assert.equal(await walletBalance(prisma,customer.id),expected);assert.equal((await call(`/hall/mine/${listing.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:key,method:'WALLET'})).status,201);assert.equal(await prisma.walletDebit.count({where:{hallOrderId:hall.data.id}}),1);
  assert.equal((await call(`/hall/mine/${listing.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:randomUUID(),method:'WALLET'})).status,409);
  const queued=await prisma.hallListing.create({data:{ownerId:customer.id,status:'PENDING_REVIEW',draft:full}});
  await prisma.hallPhoto.create({data:{listingId:queued.id,storageKey:randomUUID(),mimeType:'image/png',position:0}});
  const prepaid=await call(`/hall/mine/${queued.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:randomUUID(),method:'WALLET'});
  assert.equal(prepaid.status,201,JSON.stringify(prepaid));assert.equal(prepaid.data.status,'VERIFIED');expected-=plan.priceToman;
  assert.equal((await prisma.hallOrder.findUnique({where:{id:prepaid.data.id}})).activatedAt,null);
  assert.equal((await prisma.hallListing.findUnique({where:{id:queued.id}})).ladderUntil,null);
  assert.equal((await call(`/hall/mine/${queued.id}/checkout`,'POST',{planCode:'LADDER',idempotencyKey:randomUUID(),method:'WALLET'})).status,409);
  assert.equal((await operator(`/listings/${queued.id}/review`,'POST',{decision:'APPROVE',version:queued.version})).status,200);
  assert.ok((await prisma.hallListing.findUnique({where:{id:queued.id}})).ladderUntil>new Date());
  assert.ok((await prisma.hallOrder.findUnique({where:{id:prepaid.data.id}})).activatedAt);
  assert.equal(await prisma.walletDebit.count({where:{hallOrderId:prepaid.data.id}}),1);
  const receipt=await submit('other','other-credit');assert.equal((await operator(`/receipts/${receipt.data.id}/review`,'POST',{decision:'APPROVE',version:0,amountToman:100000})).status,200);
  const first=await job('REPAIR',other),second=await job('REPAIR',other);const results=await Promise.all([first,second].map(row=>call(`/requests/${row.id}/payment/wallet`,'POST',{confirmed:true},'other')));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(await walletBalance(prisma,other.id),0);assert.equal(await prisma.walletDebit.count({where:{userId:other.id}}),1);
  const draftBundle=await prisma.hallListing.create({data:{ownerId:customer.id,status:'DRAFT',draft:full}});
  await prisma.hallPhoto.create({data:{listingId:draftBundle.id,storageKey:randomUUID(),mimeType:'image/png',position:0}});
  const bundleCodes=['LADDER','FEATURED'],bundleKey=randomUUID(),bundlePath=`/hall/mine/${draftBundle.id}/checkout`;
  assert.equal((await call(bundlePath,'POST',{planCodes:bundleCodes,idempotencyKey:bundleKey,method:'WALLET'})).status,409);
  assert.ok(!(await operator('/listings?status=ALL')).data.items.some(row=>row.id===draftBundle.id));
  const hallService=require('../src/hall/service').createHall(prisma,config);
  await hallService.freePublish(draftBundle.id,customer.id,bundleCodes);
  assert.equal((await prisma.hallListing.findUnique({where:{id:draftBundle.id}})).status,'DRAFT');
  assert.ok(!(await operator('/listings?status=ALL')).data.items.some(row=>row.id===draftBundle.id));
  assert.equal((await call(bundlePath,'POST',{planCodes:['LADDER'],idempotencyKey:randomUUID(),method:'WALLET'})).status,409);
  const bundlePaid=await call(bundlePath,'POST',{planCodes:bundleCodes,idempotencyKey:bundleKey,method:'WALLET'});
  assert.equal(bundlePaid.status,201,JSON.stringify(bundlePaid));assert.equal(bundlePaid.data.amountToman,298000);expected-=298000;
  assert.equal(await prisma.hallOrder.count({where:{listingId:draftBundle.id}}),1);
  assert.equal(await prisma.walletDebit.count({where:{hallOrderId:bundlePaid.data.id}}),1);
  assert.equal((await call(bundlePath,'POST',{planCodes:[...bundleCodes].reverse(),idempotencyKey:bundleKey,method:'WALLET'})).status,201);
  assert.equal(await walletBalance(prisma,customer.id),expected);
  const sent=await prisma.hallListing.findUnique({where:{id:draftBundle.id}});assert.equal(sent.status,'PENDING_REVIEW');
  const pendingOwned=await call(`/hall/mine/${sent.id}`);assert.deepEqual(pendingOwned.data.paidBoosts.sort(),['FEATURED','LADDER']);
  assert.ok((await operator('/listings?status=ALL')).data.items.some(row=>row.id===draftBundle.id));
  assert.equal((await operator(`/listings/${sent.id}/review`,'POST',{decision:'APPROVE',version:sent.version})).status,200);
  const activeBundle=await prisma.hallListing.findUnique({where:{id:sent.id}});assert.ok(activeBundle.ladderUntil>new Date());assert.ok(activeBundle.featuredUntil>new Date());
  const edited=await hallService.save(sent.id,customer.id,full,activeBundle.version);
  assert.deepEqual(edited.paidBoosts.sort(),['FEATURED','LADDER']);
  const republished=await hallService.freePublish(sent.id,customer.id,['LADDER','FEATURED']);assert.equal(republished.status,'PENDING_REVIEW');
  assert.equal(await prisma.hallOrder.count({where:{listingId:sent.id}}),1);assert.equal(await walletBalance(prisma,customer.id),expected);
  assert.equal((await operator(`/listings/${sent.id}/review`,'POST',{decision:'APPROVE',version:republished.version})).status,200);
  assert.equal((await call(`/hall/mine/${sent.id}/checkout`,'POST',{planCode:'FEATURED',idempotencyKey:randomUUID(),method:'WALLET'})).status,409);
  const feedNow=Date.now();let newest;
  for(let i=0;i<6;i++)newest=await prisma.hallListing.create({data:{ownerId:customer.id,status:'PUBLISHED',draft:full,ladderUntil:new Date(feedNow+3600000),bumpedAt:new Date(feedNow+(i+1)*1000)}});
  for(let i=0;i<10;i++)await prisma.hallListing.create({data:{ownerId:customer.id,status:'PUBLISHED',draft:full,publishedAt:new Date(feedNow-i*1000)}});
  const featuredAd=await prisma.hallListing.create({data:{ownerId:customer.id,status:'PUBLISHED',draft:full,featuredUntil:new Date(feedNow+3600000)}});
  const expired=await prisma.hallListing.create({data:{ownerId:customer.id,status:'PUBLISHED',draft:full,ladderUntil:new Date(feedNow-1000),urgentUntil:new Date(feedNow+3600000)}});
  const feed=await call('/hall/listings?limit=10');assert.equal(feed.status,200);assert.equal(feed.data.items[0].id,newest.id);
  assert.deepEqual(feed.data.items.slice(0,9).map(row=>new Date(row.ladderUntil)>new Date()),[true,false,false,false,true,false,false,false,true]);
  assert.deepEqual(new Set(feed.data.featured.map(row=>row.id)),new Set([featuredAd.id,draftBundle.id]));assert.ok(!feed.data.featured.some(row=>row.id===expired.id));
  const a=await call('/hall/listings?limit=5&page=1'),b=await call('/hall/listings?limit=5&page=2');assert.deepEqual([...a.data.items,...b.data.items].map(row=>row.id),feed.data.items.map(row=>row.id));
  assert.ok(!(await call('/hall/catalog')).data.plans.some(row=>row.code==='URGENT'));
  assert.equal((await call(`/hall/mine/${listing.id}/checkout`,'POST',{planCode:'URGENT',idempotencyKey:randomUUID(),method:'WALLET'})).status,400);
  const wallet=await call('/wallet');assert.equal(wallet.data.balanceToman,expected);assert.ok(wallet.data.entries.some(entry=>entry.kind==='HALL_PAYMENT'&&entry.amountToman<0));assert.ok(wallet.data.entries.some(entry=>entry.kind==='REQUEST_PAYMENT'&&entry.amountToman<0));
  await assert.rejects(prisma.walletDebit.create({data:{userId:customer.id,amountToman:1}}),error=>error.message.includes('wallet_debit_one_target'));
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();if(uploads){for(const file of await fs.readdir(uploads))await fs.unlink(path.join(uploads,file));await fs.rmdir(uploads);}}
});
