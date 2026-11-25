const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient,Prisma}=require('@prisma/client');
const {registerOperator}=require('../src/operator/routes');
const {bridgeSignature}=require('../src/operator/auth');
const {createHall}=require('../src/hall/service');
const {hashPassword,verifyPassword}=require('../src/domain');

test('real migration/Prisma/HTTP: signed operator actions, safe dispatch, user controls and Hall moderation', {timeout:120000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server,uploads;
 try{
  // Use the generated Prisma model for the baseline fixture; apply the real new
  // migration. Geography is not queried by this management module.
  const names=new Set(['User','Session','CustomerOtpChallenge','AssistanceRequest','Payment','PaymentAttempt','GatewayCheckout','DriverEarning','Outbox','HallListing','HallPhoto','HallOrder','HallPlan','Vehicle','MaintenanceRecord','WalletDebit','WalletEntry','SupportTicket','UserLocation','DriverLocation']);
  const added={Payment:['method','cashReportedAt'],WalletEntry:['receiptId','paymentId'],User:['isActive'],AssistanceRequest:['operatorConfirmedAt','operatorActorId','operatorActorName','operatorNotes'],HallListing:['submittedAt','reviewedAt','reviewedBy','moderationNote'],HallPlan:['originalPriceToman']};
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>names.has(m.name))){
   const fields=model.fields.filter(f=>f.kind!=='object'&&!f.isList||f.kind!=='object'&&f.isList).filter(f=>!(added[model.name]||[]).includes(f.name));
   const columns=fields.map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);
    if(!type)return null;
    let def='';
    if(f.isList)def=" DEFAULT '{}'";
    else if(f.default?.name==='now'||f.isUpdatedAt)def=' DEFAULT CURRENT_TIMESTAMP';
    else if(f.hasDefaultValue&&typeof f.default!=='object')def=' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${String(f.default).replaceAll("'","''")}'`);
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isRequired?' NOT NULL':''}${def}`;
   }).filter(Boolean);await db.exec(`CREATE TABLE "${model.name}" (${columns.join(',')})`);
  }
  await db.exec(`ALTER TABLE "HallListing" ADD CONSTRAINT "HallListing_status_check" CHECK(status IN ('DRAFT','PUBLISHED','BLOCKED','SOLD','DELETED'));CREATE UNIQUE INDEX "HallPlan_code_key" ON "HallPlan"(code);`);
  await db.exec(await readFile(path.join(__dirname,'../prisma/migrations/202611230003_operator_superapp/migration.sql'),'utf8'));
  await db.exec(await readFile(path.join(__dirname,'../prisma/migrations/202611230004_onsite_cash_receipts/migration.sql'),'utf8'));
  await db.exec(await readFile(path.join(__dirname,'../prisma/migrations/202611240005_receipt_review_amount/migration.sql'),'utf8'));
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:20000}});
  const passwordHash=await hashPassword('oldPassword123');
  const customer=await prisma.user.create({data:{role:'CUSTOMER',fullName:'مشتری آزمایشی',phone:'09121234567',passwordHash,nationalId:'1234567891',services:[]}});
  const driver=await prisma.user.create({data:{role:'DRIVER',verificationStatus:'APPROVED',fullName:'امدادگر آزمایشی',phone:'09121234568',passwordHash,nationalId:'9876543210',services:['REPAIR'],vehicleType:'نیسان'}});
  const job=await prisma.assistanceRequest.create({data:{customerId:customer.id,service:'REPAIR',vehicleName:'پژو ۲۰۷',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:800000}});
  await prisma.userLocation.create({data:{userId:customer.id,latitude:35.701234,longitude:51.401234,province:'تهران',recordedAt:new Date()}});
  await prisma.driverLocation.create({data:{driverId:driver.id,latitude:35.711234,longitude:51.411234,recordedAt:new Date(Date.now()-180000)}});
  const secret='operator-test-secret-012345678901234567890',seen=new Set(),disconnected=[];
  const redis={set:async key=>{if(seen.has(key))return null;seen.add(key);return 'OK';}};
  uploads=await require('node:fs/promises').mkdtemp(path.join(require('node:os').tmpdir(),'khodro-receipt-test-'));
  const app=express();app.use(express.json());require('../src/wallet-receipts').registerWalletReceipts({app,prisma,config:{UPLOAD_DIR:uploads,WALLET_TRANSFER_CARD:'0000000000000000',WALLET_TRANSFER_ACCOUNT:'Test only'},auth:(req,res,next)=>{if(req.get('X-Fixture-User')!==driver.id)return res.sendStatus(401);req.user=driver;next();},limit:()=>((_req,_res,next)=>next())});registerOperator({app,prisma,redis,config:{OPERATOR_BRIDGE_SECRET:secret,UPLOAD_DIR:uploads},io:{in:room=>({disconnectSockets:()=>disconnected.push(room)})},limit:()=> (_req,_res,next)=>next()});app.use((error,_req,res,_next)=>res.status(error.status||(error.name==='ZodError'?400:500)).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const actor=Buffer.from(JSON.stringify({id:'crm-7',role:'operator',name:'اپراتور آزمایشی'})).toString('base64url');
  function headers(method,url,body,nonce=randomUUID(),timestamp=String(Date.now())){return {'Content-Type':'application/json','X-Operator-Time':timestamp,'X-Operator-Nonce':nonce,'X-Operator-Actor':actor,'X-Operator-Signature':bridgeSignature(secret,method,url,timestamp,nonce,actor,body)};}
  async function call(route,method='GET',body){const url='/api/v1/operator'+route;const r=await fetch(base+url,{method,headers:headers(method,url,body),body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  assert.equal((await fetch(base+'/api/v1/operator/users')).status,401);
  const replayUrl='/api/v1/operator/users',replayHeaders=headers('GET',replayUrl,undefined);assert.equal((await fetch(base+replayUrl,{headers:replayHeaders})).status,200);assert.equal((await fetch(base+replayUrl,{headers:replayHeaders})).status,401);
  const forged=headers('PATCH',`/api/v1/operator/users/${customer.id}/active`,{isActive:false,reason:'test'});
  assert.equal((await fetch(base+`/api/v1/operator/users/${customer.id}/active`,{method:'PATCH',headers:forged,body:JSON.stringify({isActive:true,reason:'test'})})).status,401);
  assert.equal((await call('/requests?status=PENDING')).data.items.length,1);
  const confirmed=await call(`/requests/${job.id}/confirm`,'POST',{notes:'تماس گرفته شود'});assert.equal(confirmed.status,200);assert.match(confirmed.data.guidance,/تماس/);assert.equal(confirmed.data.request.driverId,null);assert.equal(confirmed.data.request.status,'PENDING');
  assert.equal((await call(`/requests/${job.id}/confirm`,'POST',{})).status,409);
  assert.equal((await call('/requests?status=PENDING')).data.items.length,0);assert.equal((await call('/requests?status=OPERATOR')).data.items.length,1);
  const assigned=await call(`/requests/${job.id}/assign`,'POST',{driverId:driver.id,notes:'ارجاع تلفنی'});assert.equal(assigned.status,200);assert.equal(assigned.data.status,'ACCEPTED');assert.equal(assigned.data.driver.fullName,driver.fullName);assert.equal(await prisma.outbox.count(),2);
  const account=await call(`/users/${customer.id}`);assert.equal(account.status,200);assert.equal(account.data.requests.length,1);assert.equal(JSON.stringify(account.data).includes(passwordHash),false);
  await prisma.session.create({data:{tokenHash:'a'.repeat(64),userId:customer.id,expiresAt:new Date(Date.now()+60000)}});
  assert.equal((await call(`/users/${customer.id}/active`,'PATCH',{isActive:false,reason:'درخواست پشتیبانی'})).status,200);assert.equal((await prisma.user.findUnique({where:{id:customer.id}})).isActive,false);assert.equal(await prisma.session.count({where:{userId:customer.id}}),0);
  assert.equal((await call(`/users/${customer.id}/active`,'PATCH',{isActive:true,reason:'رفع مشکل'})).status,200);
  assert.equal((await call(`/users/${customer.id}/password`,'POST',{password:'newPassword987',reason:'درخواست صاحب حساب'})).status,200);
  assert.ok(await verifyPassword('newPassword987',(await prisma.user.findUnique({where:{id:customer.id}})).passwordHash));assert.equal(JSON.stringify(await prisma.operatorAudit.findMany()).includes('newPassword987'),false);assert.ok(disconnected.includes(`user:${customer.id}`));
  const listing=await prisma.hallListing.create({data:{ownerId:customer.id,draft:{make:'پژو',model:'۲۰۷',trim:'پانوراما',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودروی سالم برای تست بررسی آگهی در پنل اپراتور',contactPhone:customer.phone,priceToman:2000000000,fuelType:'بنزین',gearboxType:'دستی',location:{latitude:35.7,longitude:51.4,visibility:'AREA'}}}});
  await prisma.hallPhoto.create({data:{listingId:listing.id,storageKey:'fixture-photo',mimeType:'image/png',position:0}});
  const hall=createHall(prisma,{});const queued=await hall.freePublish(listing.id,customer.id);assert.equal(queued.status,'PENDING_REVIEW');assert.equal(await prisma.hallListing.count({where:{status:'PUBLISHED'}}),0);
  assert.equal((await call('/listings')).data.items.length,1);
  assert.equal((await call(`/listings/${listing.id}/review`,'POST',{decision:'REJECT',version:queued.version,note:''})).status,400);
  const rejected=await call(`/listings/${listing.id}/review`,'POST',{decision:'REJECT',version:queued.version,note:'تصویر واضح‌تری ارسال کنید.'});assert.equal(rejected.status,200);assert.equal(rejected.data.status,'REJECTED');assert.match(rejected.data.moderationNote,/تصویر/);
  const resubmitted=await hall.freePublish(listing.id,customer.id);assert.equal(resubmitted.status,'PENDING_REVIEW');
  const approved=await call(`/listings/${listing.id}/review`,'POST',{decision:'APPROVE',version:resubmitted.version,note:''});assert.equal(approved.status,200);assert.equal(approved.data.status,'PUBLISHED');
  assert.equal((await call(`/listings/${listing.id}/review`,'POST',{decision:'APPROVE',version:resubmitted.version,note:''})).status,409);
  assert.equal((await call(`/listings/${listing.id}/delete`,'POST',{version:resubmitted.version})).status,409);
  assert.equal((await call(`/listings/${listing.id}/delete`,'POST',{version:approved.data.version})).status,200);
  assert.equal((await prisma.hallListing.findUnique({where:{id:listing.id}})).status,'DELETED');
  assert.equal((await call('/listings?status=ALL')).data.items.some(row=>row.id===listing.id),false);
  await assert.rejects(hall.freePublish(listing.id,customer.id),{status:409});
  assert.equal((await call(`/listings/${listing.id}/delete`,'POST',{version:approved.data.version})).status,200);
  assert.equal(await prisma.operatorAudit.count({where:{targetId:listing.id,action:'LISTING_DELETE'}}),1);
  assert.equal(await prisma.hallPhoto.count({where:{listingId:listing.id}}),1);
  const boosts=await prisma.hallPlan.findMany({where:{kind:'BOOST'},orderBy:{sortOrder:'asc'}});assert.deepEqual(boosts.map(row=>[row.priceToman,row.originalPriceToman]),[[99000,320000],[149000,700000],[199000,720000]]);
  const {createCashPayments}=require('../src/cash-payments'),{driverBalance,assertDriverCredit}=require('../src/driver-balance');
  await prisma.assistanceRequest.update({where:{id:job.id},data:{status:'ARRIVED',operationsStartedAt:new Date(),partsQuoteToman:200000,partsApprovedToman:200000}});
  const cash=createCashPayments(prisma);
  await assert.rejects(cash.report(job.id,driver.id),{status:404});
  const reported=await cash.report(job.id,customer.id);assert.equal(reported.method,'CASH_PENDING');assert.notEqual(reported.status,'VERIFIED');
  assert.equal(await driverBalance(prisma,driver.id),0);
  await assert.rejects(cash.confirm(job.id,customer.id),{status:404});
  const collected=await cash.confirm(job.id,driver.id);assert.equal(collected.status,'VERIFIED');assert.equal(collected.method,'CASH');
  await cash.confirm(job.id,driver.id);assert.equal(await prisma.walletEntry.count({where:{paymentId:collected.id}}),1);
  const reserved=await prisma.assistanceRequest.create({data:{customerId:customer.id,service:'REPAIR',vehicleName:'پژو',vehiclePlate:'12345',originLat:35.7,originLng:51.4,operatorConfirmedAt:new Date()}});
  const blockedAssign=await call(`/requests/${reserved.id}/assign`,'POST',{driverId:driver.id,notes:''});assert.equal(blockedAssign.status,409);assert.match(blockedAssign.data.error,/کمیسیون/);
  assert.equal(await driverBalance(prisma,driver.id),-300000);await assert.rejects(assertDriverCredit(prisma,driver.id),{status:409});
  assert.equal((await prisma.driverEarning.findUnique({where:{paymentId:collected.id}})).amountToman,700000,'cash income is preserved without adding it to wallet');
  const {createGatewayPayments}=require('../src/gateway-payments');
  for(const mode of ['sandbox','live']){
   const authority=(mode==='sandbox'?'S':'A')+'2'.repeat(35),provider={mode,merchant:()=>mode+'-test-merchant',request:async()=>({authority}),verify:async()=>({refId:mode+'-test-reference'}),redirect:()=>null};
   const gateway=createGatewayPayments(prisma,{},provider),checkout=await gateway.start(driver,{amountToman:10000,idempotencyKey:randomUUID()});
   await gateway.verify(checkout.id,authority,'OK');await gateway.verify(checkout.id,authority,'OK');
   assert.equal(await prisma.walletEntry.count({where:{checkoutId:checkout.id}}),1);
   assert.equal(await driverBalance(prisma,driver.id),mode==='sandbox'?-300000:-290000,'sandbox funds never clear real commission debt');
   assert.equal((await gateway.wallet(driver.id)).balanceToman,mode==='sandbox'?-300000:-290000);
  }
  assert.equal((await fetch(base+'/api/v1/wallet/receipts',{method:'POST'})).status,401);
  const form=new FormData();form.set('amountToman','290000');form.set('bankReference','987654321');form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgS8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'receipt.png');
  const uploaded=await fetch(base+'/api/v1/wallet/receipts',{method:'POST',headers:{'X-Fixture-User':driver.id},body:form});assert.equal(uploaded.status,201);const receipt=await uploaded.json();
  const locationRead=await call(`/requests/${job.id}/locations`);
  assert.equal(locationRead.data.snapshots[0].reason,'OPERATOR_ASSIGNED');
  assert.equal(locationRead.data.snapshots[0].locations.driver.latitude,35.711234);
  assert.equal(locationRead.status,200);assert.equal(locationRead.data.current.customer.latitude,35.701234);
  assert.equal(locationRead.data.current.origin.latitude,35.7);assert.equal(locationRead.data.current.origin.source,'REQUEST_ORIGIN');
  assert.equal(locationRead.data.current.driver.fresh,false,'Old GPS must be labelled stale');
  assert.equal((await call(`/requests/${job.id}/locations`,'POST',{latitude:0,longitude:0})).status,400,'Panel coordinates must never replace device samples');
  const capture=await call(`/requests/${job.id}/locations`,'POST',{});
  assert.equal(capture.status,201);assert.equal(capture.data.locations.customer.latitude,35.701234);
  await prisma.userLocation.update({where:{userId:customer.id},data:{latitude:35.801234,recordedAt:new Date()}});
  const newer=await call(`/requests/${job.id}/locations`);
  assert.equal(newer.data.current.customer.latitude,35.801234);
  assert.equal(newer.data.snapshots[0].locations.customer.latitude,35.701234,'Stored capture must not move with current GPS');
  assert.equal(newer.data.snapshots[0].actorName,'اپراتور آزمایشی');
  assert.equal((await call(`/requests/${randomUUID()}/locations`)).status,404);
  const receiptDetail=await call(`/receipts/${receipt.id}`);assert.equal(receiptDetail.status,200);assert.ok(receiptDetail.data.image.startsWith('data:image/png;base64,'));assert.equal(receiptDetail.data.storageKey,undefined);

  assert.equal(await driverBalance(prisma,driver.id),-290000,'submission never credits a wallet');
  const receiptReview=await call(`/receipts/${receipt.id}/review`,'POST',{version:0,decision:'APPROVE',amountToman:290000,note:'واریز در حساب شرکت تطبیق شد'});assert.equal(receiptReview.status,200);
  assert.equal(await driverBalance(prisma,driver.id),0);await assertDriverCredit(prisma,driver.id);
  assert.equal((await call(`/receipts/${receipt.id}/review`,'POST',{version:0,decision:'APPROVE',note:''})).status,409);assert.equal(await prisma.walletEntry.count({where:{receiptId:receipt.id}}),1);
  const rejectedReceipt=await prisma.walletReceipt.create({data:{userId:driver.id,amountToman:10000,bankReference:'987654322',storageKey:'receipt-fixture-2',mimeType:'image/png'}});
  assert.equal((await call(`/receipts/${rejectedReceipt.id}/review`,'POST',{version:0,decision:'REJECT',note:''})).status,400);
  assert.equal((await call(`/receipts/${rejectedReceipt.id}/review`,'POST',{version:0,decision:'REJECT',note:'واریز بانکی تطبیق ندارد'})).status,200);assert.equal(await driverBalance(prisma,driver.id),0);
  form.set('file',new Blob([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('new receipt')],{type:'image/png'}),'new.png');
  form.set('bankReference','987654322');form.set('amountToman','10000');
  const resubmittedReceipt=await fetch(base+'/api/v1/wallet/receipts',{method:'POST',headers:{'X-Fixture-User':driver.id},body:form});assert.equal(resubmittedReceipt.status,201);assert.equal((await resubmittedReceipt.json()).id,rejectedReceipt.id);
  assert.equal((await call(`/receipts/${rejectedReceipt.id}/review`,'POST',{version:0,decision:'APPROVE',note:''})).status,409,'a stale review cannot approve a resubmitted image');
  assert.equal((await call(`/receipts/${rejectedReceipt.id}/review`,'POST',{version:2,decision:'APPROVE',amountToman:10000,note:'بانک تطبیق شد'})).status,200);assert.equal(await driverBalance(prisma,driver.id),10000);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();if(uploads){const fs=require('node:fs/promises');for(const file of await fs.readdir(uploads))await fs.unlink(path.join(uploads,file));await fs.rmdir(uploads);}}
});
