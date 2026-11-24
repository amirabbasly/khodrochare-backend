const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient,Prisma}=require('@prisma/client');
const {registerProfile}=require('../src/profile');
const {createCustomerAuth}=require('../src/customer-auth');
const d=require('../src/domain');

test('real profile migration and HTTP: both roles edit identity, activity is informational, phone needs bound single-use OTP and password', {timeout:120000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server;
 try{
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>['User','Session','CustomerOtpChallenge','Vehicle'].includes(m.name))){
   const fields=model.fields.filter(f=>f.kind!=='object'&&!['activityCity','activityDistrict'].includes(f.name));
   const columns=fields.map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);
    let def='';if(f.isList)def=" DEFAULT '{}'";else if(f.default?.name==='now'||f.isUpdatedAt)def=' DEFAULT CURRENT_TIMESTAMP';else if(f.hasDefaultValue&&typeof f.default!=='object')def=' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${f.default}'`);
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isRequired?' NOT NULL':''}${def}`;
   });await db.exec(`CREATE TABLE "${model.name}" (${columns.join(',')})`);
  }
  await db.exec('CREATE UNIQUE INDEX "User_role_phone_key" ON "User"(role,phone);CREATE UNIQUE INDEX "User_role_nationalId_key" ON "User"(role,"nationalId");ALTER TABLE "CustomerOtpChallenge" ADD CONSTRAINT "CustomerOtpChallenge_purpose_check" CHECK(purpose IN (\'REGISTER\',\'LOGIN\'));');
  await db.exec(await readFile(path.join(__dirname,'../prisma/migrations/202611240001_profile_activity/migration.sql'),'utf8'));
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:20000}});
  const passwordHash=await d.hashPassword('profilePassword123');
  const customer=await prisma.user.create({data:{role:'CUSTOMER',phone:'09120000001',fullName:'مشتری نمونه',nationalId:'1234567891',passwordHash,services:[]}});
  const driver=await prisma.user.create({data:{role:'DRIVER',phone:'09120000002',fullName:'امدادگر نمونه',nationalId:'1234567891',passwordHash,services:['REPAIR'],vehicleType:'نیسان'}});
  const tokens=new Map([['a'.repeat(64),customer.id],['b'.repeat(64),driver.id]]);
  for(const [token,userId]of tokens)await prisma.session.create({data:{userId,tokenHash:d.hash(token),expiresAt:new Date(Date.now()+86400000)}});
  await prisma.session.create({data:{userId:customer.id,tokenHash:d.hash('c'.repeat(64)),expiresAt:new Date(Date.now()+86400000)}});
  const sent=[],config={OTP_HMAC_SECRET:'profile-test-secret',SESSION_DAYS:90},sms={enabled:true,sendCode:async(phone,code)=>sent.push({phone,code})};
  const auth=async(req,res,next)=>{req.token=req.headers.authorization?.replace(/^Bearer /,'');const userId=tokens.get(req.token);if(!userId)return res.sendStatus(401);req.user=await prisma.user.findUnique({where:{id:userId}});next();};
  const app=express();app.use(express.json());registerProfile({app,prisma,config,sms,auth,limit:()=>((_req,_res,next)=>next()),io:{in:()=>({disconnectSockets:()=>{}})}});
  app.use((e,_req,res,_next)=>res.status(e.status||(e.name==='ZodError'?400:e.code==='P2002'?409:500)).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function call(route,body,token='a'.repeat(64),method='POST'){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1`+route,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
  const edited=await call('/me',{fullName:'مشتری ویرایش‌شده',nationalId:'۱۲۳۴۵۶۷۸۹۱'},undefined,'PATCH');assert.equal(edited.status,200);assert.equal(edited.data.nationalId,'1234567891');assert.equal(edited.data.passwordHash,undefined);
  assert.equal((await call('/me',{phone:'09120000009'},undefined,'PATCH')).status,400,'Phone updates cannot bypass verification');
  assert.equal((await call('/me',{activityCity:'تهران'},undefined,'PATCH')).status,400);
  assert.equal((await call('/me',{nationalId:'1111111111'},undefined,'PATCH')).status,400);
  const activity=await call('/me',{fullName:'امدادگر جدید',activityCity:'مشهد',activityDistrict:'بخش مرکزی'},'b'.repeat(64),'PATCH');assert.equal(activity.status,200);assert.equal(activity.data.activityCity,'مشهد');assert.deepEqual(activity.data.services,['REPAIR']);
  assert.equal((await call('/me',{services:['TOWING']},'b'.repeat(64),'PATCH')).status,400);
  assert.equal((await call('/me/phone/otp',{phone:'09120000003',currentPassword:'wrong'})).status,400);assert.equal(sent.length,0);
  const challenge=await call('/me/phone/otp',{phone:'09120000003',currentPassword:'profilePassword123'});assert.equal(challenge.status,200);assert.equal(sent[0].phone,'09120000003');
  const input={challengeId:challenge.data.challengeId,code:sent[0].code};
  const login=createCustomerAuth({prisma,config,sms,services:{}});await assert.rejects(login.consume(input),{status:400});
  assert.equal((await call('/me/phone',input,'b'.repeat(64))).status,400,'Another account cannot consume a phone-change code');
  assert.equal((await call('/me/phone',{...input,code:input.code==='111111'?'222222':'111111'})).status,400);
  const changed=await call('/me/phone',input);assert.equal(changed.status,200);assert.equal(changed.data.phone,'09120000003');assert.equal(changed.data.passwordHash,undefined);
  assert.equal(await prisma.session.count({where:{userId:customer.id}}),1);assert.equal((await call('/me/phone',input)).status,400);
  const driverChallenge=await call('/me/phone/otp',{phone:'09120000004',currentPassword:'profilePassword123'},'b'.repeat(64));assert.equal(driverChallenge.status,200);
  assert.equal((await call('/me/phone',{challengeId:driverChallenge.data.challengeId,code:sent.at(-1).code},'b'.repeat(64))).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();}
});
