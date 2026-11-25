const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient,Prisma}=require('@prisma/client');
const {createApp}=require('../src/app');
const {createServices}=require('../src/services');
const {createPayments}=require('../src/payments');

test('driver verification: pending login and offers, private document review, versioned editing, approval notices, cash debt and settlement',{timeout:120000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server;
 try{
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  const names=['User','Document','Session','CustomerOtpChallenge','Vehicle','AssistanceRequest','Payment','PaymentAttempt','WalletDebit','WalletEntry','DriverEarning','Outbox','GatewayCheckout','OperatorAudit','UserLocation','DriverLocation'];
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>names.includes(m.name))){
   const columns=model.fields.filter(f=>f.kind!=='object'&&!(model.name==='Document'&&['verificationKind','vehicleEvidenceType'].includes(f.name))&&!(model.name==='User'&&['verificationStatus','verificationVersion','verificationReviewedAt','verificationReviewedBy','verificationNote','registrationNoticeSeenAt','verificationNoticeSeenAt'].includes(f.name))).map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);if(!type)return null;
    let def='';if(f.isList)def=" DEFAULT '{}'";else if(f.default?.name==='now'||f.isUpdatedAt)def=' DEFAULT CURRENT_TIMESTAMP';else if(f.hasDefaultValue&&typeof f.default!=='object')def=' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${f.default}'`);
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isUnique?' UNIQUE':f.isRequired?' NOT NULL':''}${def}`;
   }).filter(Boolean);await db.exec(`CREATE TABLE "${model.name}" (${columns.join(',')})`);
  }
  const legacyId=randomUUID();await db.query('INSERT INTO "User" (id,role,"fullName",phone) VALUES ($1,$2,$3,$4)',[legacyId,'DRIVER','Legacy driver','09120000099']);
  await db.exec(await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../prisma/migrations/202611240002_driver_verification/migration.sql'),'utf8'));
  const legacy=(await db.query('SELECT "verificationStatus","registrationNoticeSeenAt" FROM "User" WHERE id=$1',[legacyId])).rows[0];assert.equal(legacy.verificationStatus,'PENDING');assert.ok(legacy.registrationNoticeSeenAt);
  const legacyDoc=randomUUID();await db.query('INSERT INTO "Document" (id,"storageKey","mimeType","ownerId") VALUES ($1,$2,$3,$4)',[legacyDoc,randomUUID(),'image/png',legacyId]);await db.query('UPDATE "User" SET "identityDocumentId"=$1 WHERE id=$2',[legacyDoc,legacyId]);
  await db.exec(await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../prisma/migrations/202611240004_verification_documents/migration.sql'),'utf8'));
  assert.equal((await db.query('SELECT "verificationKind" FROM "Document" WHERE id=$1',[legacyDoc])).rows[0].verificationKind,'LEGACY_IDENTITY');await db.query('UPDATE "User" SET "identityDocumentId"=NULL WHERE id=$1',[legacyId]);await db.query('DELETE FROM "Document" WHERE id=$1',[legacyDoc]);await db.query('DELETE FROM "User" WHERE id=$1',[legacyId]);
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:20000}});
  const d=require('../src/domain'),{bridgeSignature}=require('../src/operator/auth');
  const passwordHash=await d.hashPassword('driverPassword123');
  const customer=await prisma.user.create({data:{role:'CUSTOMER',fullName:'مشتری نمونه',phone:'09120000001',nationalId:'1234567891',passwordHash,services:[]}});
  const driver=await prisma.user.create({data:{role:'DRIVER',fullName:'امدادگر نمونه',phone:'09120000002',nationalId:'1234567891',passwordHash,services:['REPAIR'],activityCity:'تهران',activityDistrict:'مرکزی',vehicleType:'نیسان',vehiclePlate:'12 ب 345'}});
  const other=await prisma.user.create({data:{role:'DRIVER',fullName:'امدادگر دیگر',phone:'09120000003',services:['REPAIR']}});
  const png=Buffer.from('89504e470d0a1a0a','hex'),fs=require('node:fs/promises'),path=require('node:path');
  const uploads=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'driver-review-'));
  const storageKey=randomUUID();await fs.writeFile(path.join(uploads,storageKey),png);
  const doc=await prisma.document.create({data:{storageKey,mimeType:'image/png',ownerId:driver.id,verificationKind:'NATIONAL_ID'}});
  await prisma.user.update({where:{id:driver.id},data:{identityDocumentId:doc.id}});
  const secret='verification-test-secret-012345678901234567890';
  const config={TRUST_PROXY:0,origins:[],SESSION_DAYS:30,UPLOAD_DIR:uploads,OPERATOR_BRIDGE_SECRET:secret,LOCATION_MAX_AGE_SECONDS:120,ZARINPAL_MODE:'live',OTP_HMAC_SECRET:'registration-test-secret-012345678901234567890'};
  const redis={eval:async()=>1,set:async()=> 'OK'},io={in:()=>({disconnectSockets:()=>{}})};
  const s=createServices({prisma,config,redis,io});
  const sent=[];
  server=createApp({prisma,config,redis,io,services:s,otpSms:{enabled:true,sendCode:async(phone,code)=>sent.push({phone,code})}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(route,method='GET',body,token){const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.status===204?null:await r.json()};}
  const registerPhone='09120000007',uploadToken='f'.repeat(64);
  const registrationDoc=await prisma.document.create({data:{storageKey:randomUUID(),mimeType:'image/png',uploadTokenHash:d.hash(uploadToken)}});
  const additional={};for(const key of ['birthCertificate','drivingLicense','vehicleOwnershipDocument']){const document=await prisma.document.create({data:{storageKey:randomUUID(),mimeType:'image/png',uploadTokenHash:d.hash(uploadToken)}});additional[key]={id:document.id,token:uploadToken};}
  const challenge=await call('/auth/drivers/otp/request','POST',{phone:registerPhone,purpose:'REGISTER'});assert.equal(challenge.status,200);
  const baseId='123456780',remainder=[...baseId].reduce((sum,value,index)=>sum+Number(value)*(10-index),0)%11;
  const registrationInput={challengeId:challenge.data.challengeId,code:sent.at(-1).code,phone:registerPhone,fullName:'امدادگر تازه ثبت نام شده',nationalId:baseId+(remainder<2?remainder:11-remainder),password:'driverPassword123',services:['REPAIR'],activityCity:'شیراز',vehicleType:'نیسان',vehiclePlate:'12 ب 345',identityDocument:{id:registrationDoc.id,token:uploadToken},...additional,vehicleEvidenceType:'INSURANCE'};
  for(const key of ['identityDocument','birthCertificate','drivingLicense','vehicleOwnershipDocument','vehicleEvidenceType']){const invalid={...registrationInput};delete invalid[key];assert.equal((await call('/auth/drivers/register','POST',invalid)).status,400);}
  const registered=await call('/auth/drivers/register','POST',registrationInput);
  assert.equal(registered.data.user.documents.filter(doc=>doc.verificationKind).length,4);
  assert.equal(registered.status,201,JSON.stringify(registered));assert.equal(registered.data.user.verificationStatus,'PENDING');assert.equal(registered.data.user.registrationNoticeSeenAt,null);assert.equal((await call('/me','GET',undefined,registered.data.token)).status,200);
  assert.equal((await prisma.document.findUnique({where:{id:registrationDoc.id}})).ownerId,registered.data.user.id);
  const login=await call('/auth/drivers/login','POST',{phone:driver.phone,password:'driverPassword123'});assert.equal(login.status,200);assert.equal(login.data.user.verificationStatus,'PENDING');assert.equal(login.data.user.registrationNoticeSeenAt,null);const token=login.data.token;
  const me=await call('/me','GET',undefined,token);assert.equal(me.status,200);assert.equal(me.data.passwordHash,undefined);
  const job=await prisma.assistanceRequest.create({data:{customerId:customer.id,service:'REPAIR',vehicleName:'پژو',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:800000}});
  assert.equal((await call('/drivers/requests/available','GET',undefined,token)).data.length,1);
  assert.equal((await call(`/requests/${job.id}/accept`,'POST',{},token)).status,403);
  assert.equal((await call('/assistant/chat','POST',{},token)).status,403);
  assert.equal((await call('/me/verification-notices/approval','POST',{},token)).data.verificationNoticeSeenAt,null);
  assert.equal((await call('/me','PATCH',{verificationStatus:'APPROVED'},token)).status,400);
  const ack=await call('/me/verification-notices/registration','POST',{},token);assert.equal(ack.status,200);assert.ok(ack.data.registrationNoticeSeenAt);
  assert.equal((await call('/me/verification-notices/registration','POST',{},token)).data.registrationNoticeSeenAt,ack.data.registrationNoticeSeenAt);
  const actor=Buffer.from(JSON.stringify({id:'operator-1',role:'operator',name:'اپراتور نمونه'})).toString('base64url');
  async function operator(route,method='GET',body){const routeUrl='/api/v1/operator'+route,timestamp=String(Date.now()),nonce=randomUUID();const r=await fetch(url.replace('/api/v1','')+routeUrl,{method,headers:{'Content-Type':'application/json','X-Operator-Time':timestamp,'X-Operator-Nonce':nonce,'X-Operator-Actor':actor,'X-Operator-Signature':bridgeSignature(secret,method,routeUrl,timestamp,nonce,actor,body)},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
  assert.equal((await call('/operator/driver-verifications')).status,401);
  const list=await operator('/driver-verifications');assert.equal(list.status,200);assert.equal(list.data.items.length,3);
  const detail=await operator(`/driver-verifications/${driver.id}`);assert.equal(detail.data.documents[0].id,doc.id);assert.equal(detail.data.user.passwordHash,undefined);
  assert.equal((await operator(`/driver-verifications/${other.id}/documents/${doc.id}`)).status,404);
  assert.equal((await operator(`/driver-verifications/${driver.id}/documents/${doc.id}`)).data.image,'data:image/png;base64,'+png.toString('base64'));
  assert.equal((await operator(`/driver-verifications/${other.id}/review`,'POST',{version:0,decision:'APPROVE'})).status,409);
  let reviewed=await operator(`/driver-verifications/${driver.id}/review`,'POST',{version:0,decision:'NEEDS_CORRECTION',note:'تماس برای اصلاح اطلاعات'});assert.equal(reviewed.status,200);assert.equal(reviewed.data.verificationStatus,'NEEDS_CORRECTION');
  assert.equal((await call(`/requests/${job.id}/accept`,'POST',{},token)).status,403);
  const profile={version:reviewed.data.verificationVersion,fullName:'امدادگر ویرایش‌شده',phone:driver.phone,nationalId:driver.nationalId,activityCity:'مشهد',activityDistrict:'بخش مرکزی',vehicleType:'نیسان',vehiclePlate:'12 ب 345',services:['REPAIR']};
  assert.equal((await call('/me/verification-documents/submit','POST',{},token)).status,409);
  assert.equal((await operator(`/driver-verifications/${driver.id}/review`,'POST',{version:reviewed.data.verificationVersion,decision:'APPROVE'})).status,409);
  for(const kind of ['BIRTH_CERTIFICATE','DRIVING_LICENSE','VEHICLE_OWNERSHIP']){
   const refToken=randomUUID()+randomUUID(),file=await prisma.document.create({data:{storageKey:randomUUID(),mimeType:'image/png',uploadTokenHash:d.hash(refToken)}});
   const result=await call('/me/verification-documents','POST',{kind,document:{id:file.id,token:refToken},...(kind==='VEHICLE_OWNERSHIP'?{vehicleEvidenceType:'INSURANCE'}:{})},token);assert.equal(result.status,204);
  }
  const correction=await call('/me','GET',undefined,token);assert.equal(correction.data.verificationStatus,'NEEDS_CORRECTION');assert.equal(correction.data.verificationNote,'تماس برای اصلاح اطلاعات');assert.equal(correction.data.documents.filter(doc=>doc.verificationKind==='VEHICLE_OWNERSHIP').length,1);
  const submitted=await call('/me/verification-documents/submit','POST',{},token);assert.equal(submitted.status,200);assert.equal(submitted.data.verificationStatus,'PENDING');profile.version=submitted.data.verificationVersion;
  const edited=await operator(`/driver-verifications/${driver.id}/profile`,'PATCH',profile);assert.equal(edited.status,200);assert.equal(edited.data.activityCity,'مشهد');
  assert.equal((await operator(`/driver-verifications/${driver.id}/review`,'POST',{version:0,decision:'APPROVE'})).status,409);
  reviewed=await operator(`/driver-verifications/${driver.id}/review`,'POST',{version:edited.data.verificationVersion,decision:'APPROVE'});assert.equal(reviewed.status,200);assert.equal(reviewed.data.verificationStatus,'APPROVED');
  const approved=await call('/me','GET',undefined,token);assert.equal(approved.data.verificationStatus,'APPROVED');assert.equal(approved.data.verificationNoticeSeenAt,null);
  const welcome=await call('/me/verification-notices/approval','POST',{},token);assert.ok(welcome.data.verificationNoticeSeenAt);assert.equal((await call('/me/verification-notices/approval','POST',{},token)).data.verificationNoticeSeenAt,welcome.data.verificationNoticeSeenAt);
  const unchanged=await call('/me/verification-documents/submit','POST',{},token);assert.equal(unchanged.data.verificationStatus,'APPROVED');assert.equal(unchanged.data.verificationVersion,reviewed.data.verificationVersion);
  const approvedEdit=await operator(`/driver-verifications/${driver.id}/profile`,'PATCH',{...profile,version:reviewed.data.verificationVersion,fullName:'امدادگر تأییدشده ویرایش‌شده'});assert.equal(approvedEdit.status,200);assert.equal(approvedEdit.data.verificationStatus,'APPROVED');
  await prisma.driverLocation.create({data:{driverId:driver.id,latitude:35.7,longitude:51.4,recordedAt:new Date()}});
  assert.equal((await call(`/requests/${job.id}/accept`,'POST',{},token)).status,200);
  await prisma.assistanceRequest.update({where:{id:job.id},data:{status:'ARRIVED',partsApprovedToman:200000,operationsStartedAt:new Date()}});
  const receipt=await call(`/requests/${job.id}/commission-confirm`,'POST',{confirmed:true},token);assert.equal(receipt.status,200,JSON.stringify(receipt));
  const paid=await prisma.payment.findUnique({where:{requestId:job.id}});assert.equal(paid.amountToman,1000000);assert.equal(paid.method,'CASH');
  await call(`/requests/${job.id}/commission-confirm`,'POST',{confirmed:true},token);
  assert.equal(await prisma.walletEntry.count({where:{paymentId:paid.id}}),1);assert.equal((await require('../src/driver-balance').driverBalance(prisma,driver.id)),-paid.commissionToman);
  assert.equal((await call(`/requests/${job.id}/status`,'PATCH',{status:'COMPLETED'},token)).status,200);
  const next=await prisma.assistanceRequest.create({data:{customerId:customer.id,service:'REPAIR',vehicleName:'پژو',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:800000}});
  assert.equal((await call('/drivers/requests/available','GET',undefined,token)).data.length,1);
  assert.equal((await call(`/requests/${next.id}/accept`,'POST',{},token)).status,409);
  const assignJob=await prisma.assistanceRequest.create({data:{customerId:customer.id,service:'REPAIR',vehicleName:'پژو',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:800000,operatorConfirmedAt:new Date()}});
  assert.equal((await operator(`/requests/${assignJob.id}/assign`,'POST',{driverId:other.id})).status,409);
  assert.equal((await operator(`/requests/${assignJob.id}/assign`,'POST',{driverId:driver.id})).status,409);
  await prisma.walletEntry.create({data:{userId:driver.id,amountToman:paid.commissionToman,mode:'live'}});
  assert.equal((await call(`/requests/${next.id}/accept`,'POST',{},token)).status,200);
  const newPhone='09120000009';assert.equal((await operator(`/driver-verifications/${driver.id}/profile`,'PATCH',{...profile,version:approvedEdit.data.verificationVersion,phone:newPhone})).status,200);assert.equal((await call('/me','GET',undefined,token)).status,401);
  assert.equal((await prisma.user.findUnique({where:{id:driver.id}})).phone,newPhone);
  const fresh=await call('/auth/drivers/login','POST',{phone:newPhone,password:'driverPassword123'});assert.equal(fresh.status,200);
  for(const type of ['VEHICLE_CARD','INSURANCE','TECHNICAL_INSPECTION']){
   const refToken=randomUUID()+randomUUID(),file=await prisma.document.create({data:{storageKey:randomUUID(),mimeType:'image/png',uploadTokenHash:d.hash(refToken)}});
   const reference={id:file.id,token:refToken};
   assert.equal((await call('/me/verification-documents','POST',{kind:'VEHICLE_OWNERSHIP',document:reference},fresh.data.token)).status,400);
   const previous=(await call('/me','GET',undefined,fresh.data.token)).data.documents.find(doc=>doc.verificationKind==='VEHICLE_OWNERSHIP');
   assert.equal((await call('/me/verification-documents','POST',{kind:'VEHICLE_OWNERSHIP',document:reference,vehicleEvidenceType:type},fresh.data.token)).status,204);
   const latest=await call('/me','GET',undefined,fresh.data.token);assert.equal(latest.data.verificationStatus,'PENDING');
   const active=latest.data.documents.filter(doc=>doc.verificationKind==='VEHICLE_OWNERSHIP');assert.equal(active.length,1);assert.equal(active[0].vehicleEvidenceType,type);
   const archived=await prisma.document.findUnique({where:{id:previous.id}});assert.equal(archived.verificationKind,null);assert.equal(archived.vehicleEvidenceType,null);
   const resubmitted=await call('/me/verification-documents/submit','POST',{},fresh.data.token);assert.equal(resubmitted.status,200);
   assert.equal((await operator(`/driver-verifications/${driver.id}/review`,'POST',{version:resubmitted.data.verificationVersion,decision:'APPROVE'})).status,200);
   assert.equal((await call('/me/verification-documents','POST',{kind:'NATIONAL_ID',document:reference},registered.data.token)).status,400);
  }
  await fs.unlink(path.join(uploads,storageKey));await fs.rmdir(uploads);
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();}
});
