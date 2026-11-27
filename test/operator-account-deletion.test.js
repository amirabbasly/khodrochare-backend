const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite'),{PGLiteSocketServer}=require('@electric-sql/pglite-socket'),{Prisma,PrismaClient}=require('@prisma/client');
const {bridgeSignature}=require('../src/operator/auth'),{hash}=require('../src/domain');
test('signed account deletion is admin-only for both roles; active work, balances and payments block erasure; history survives',{timeout:120000},async()=>{
 const db=new PGlite(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server;
 try{
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  for(const model of Prisma.dmmf.datamodel.models){
   const cols=model.fields.filter(f=>f.kind!=='object'&&f.kind!=='unsupported').map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);if(!type)return null;
    let def=f.isList?" DEFAULT '{}'":f.default?.name==='now'||f.isUpdatedAt?' DEFAULT CURRENT_TIMESTAMP':f.hasDefaultValue&&typeof f.default!=='object'?' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${String(f.default).replaceAll("'","''")}'`):'';
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isUnique?' UNIQUE':f.isRequired?' NOT NULL':''}${def}`;
   }).filter(Boolean);await db.exec(`CREATE TABLE "${model.name}" (${cols.join(',')})`);
  }
  await db.exec('ALTER TABLE "WalletEntry" ADD CONSTRAINT ledger_owner FOREIGN KEY ("userId") REFERENCES "User"(id)');
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:20000}});
  const secret='test-only-account-delete-secret-32-characters',app=require('express')(),nonces=new Set();app.use(require('express').json());
  require('../src/operator/routes').registerOperator({app,prisma,redis:{set:async key=>{if(nonces.has(key))return null;nonces.add(key);return'OK';}},config:{OPERATOR_BRIDGE_SECRET:secret},io:{in:()=>({disconnectSockets:()=>{}})},limit:()=>((_req,_res,next)=>next())});
  app.use((e,_req,res,_next)=>res.status(e.status||400).json({error:e.message}));server=app.listen(0);await new Promise(r=>server.once('listening',r));
  async function call(user,role,body,pathSuffix='delete',method='POST'){
   const path=`/api/v1/operator/users/${user.id}/${pathSuffix}`,time=String(Date.now()),nonce=randomUUID(),actor=Buffer.from(JSON.stringify({id:'staff',role,name:'Staff'})).toString('base64url');
   const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{'content-type':'application/json','X-Operator-Time':time,'X-Operator-Nonce':nonce,'X-Operator-Actor':actor,'X-Operator-Signature':bridgeSignature(secret,method,path,time,nonce,actor,body)},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};
  }
  for(const role of ['CUSTOMER','DRIVER']){
   const user=await prisma.user.create({data:{role,phone:role==='DRIVER'?'09120000002':'09120000001',fullName:'Private Name',nationalId:'1234567891',activityCity:'Private City',services:['REPAIR'],verificationStatus:'APPROVED'}}),body={confirmation:'DELETE',phone:user.phone,reason:'Requested deletion'};
   await prisma.session.create({data:{userId:user.id,tokenHash:hash(user.id),expiresAt:new Date(Date.now()+60000)}});
   assert.equal((await call(user,'operator',body)).status,403);assert.equal((await prisma.user.findUnique({where:{id:user.id}})).deletedAt,null);
   assert.equal((await call(user,'operator',{isActive:false,reason:'Suspended'},'active','PATCH')).status,200);assert.equal(await prisma.session.count({where:{userId:user.id}}),0);
   assert.equal((await call(user,'operator',{isActive:true,reason:'Restored'},'active','PATCH')).status,200);
   assert.equal((await call(user,'admin',{...body,phone:'wrong'})).status,409);
   const credit=await prisma.walletEntry.create({data:{userId:user.id,amountToman:100,mode:'live'}});assert.equal((await call(user,'admin',body)).status,409);
   await prisma.walletEntry.create({data:{userId:user.id,amountToman:-100,mode:'live'}});
   let job;
   if(role==='CUSTOMER'){
    job=await prisma.assistanceRequest.create({data:{customerId:user.id,service:'REPAIR',status:'PENDING',vehicleName:'Car',vehiclePlate:'12345',originLat:35,originLng:51}});
    assert.equal((await call(user,'admin',body)).status,409);await prisma.assistanceRequest.update({where:{id:job.id},data:{status:'CANCELLED'}});
   }
   if(role==='DRIVER'){
    const customer=await prisma.user.create({data:{role:'CUSTOMER',phone:'09120000003',fullName:'Other customer',services:[]}});
    job=await prisma.assistanceRequest.create({data:{customerId:customer.id,driverId:user.id,service:'REPAIR',status:'ACCEPTED',vehicleName:'Car',vehiclePlate:'12345',originLat:35,originLng:51}});
    assert.equal((await call(user,'admin',body)).status,409);await prisma.assistanceRequest.update({where:{id:job.id},data:{status:'COMPLETED'}});
    const payment=await prisma.payment.create({data:{requestId:job.id,status:'AWAITING_PAYMENT',serviceToman:100,partsToman:0,amountToman:100,commissionPercent:30,commissionToman:30,driverShareToman:70}});
    assert.equal((await call(user,'admin',body)).status,409);await prisma.payment.update({where:{id:payment.id},data:{status:'VERIFIED'}});
    await prisma.driverLocation.create({data:{driverId:user.id,latitude:35,longitude:51,recordedAt:new Date()}});
   }
   await prisma.session.create({data:{userId:user.id,tokenHash:hash(user.id+'fresh'),expiresAt:new Date(Date.now()+60000)}});
   const removed=await call(user,'admin',body);assert.equal(removed.status,200,JSON.stringify(removed));
   const erased=await prisma.user.findUnique({where:{id:user.id}});assert(erased.deletedAt);assert.equal(erased.isActive,false);assert.equal(erased.nationalId,null);assert.equal(erased.activityCity,null);assert.equal(await prisma.session.count({where:{userId:user.id}}),0);assert.notEqual(erased.phone,user.phone);
   assert.equal((await prisma.walletEntry.findUnique({where:{id:credit.id}})).amountToman,100);assert.equal(await prisma.operatorAudit.count({where:{targetId:user.id,action:'USER_DELETE'}}),1);assert.equal(await prisma.driverLocation.count({where:{driverId:user.id}}),0);
   if(job)assert.equal((await prisma.assistanceRequest.findUnique({where:{id:job.id}})).status,role==='DRIVER'?'COMPLETED':'CANCELLED');
   assert.equal((await call(user,'admin',body)).status,404);
  }
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();}
});
test('an already authenticated suspended or deleted driver cannot pass the acceptance recheck',()=>{
 const {assertVerifiedDriver}=require('../src/driver-verification');
 for(const user of [null,{role:'DRIVER',verificationStatus:'APPROVED',isActive:false},{role:'DRIVER',verificationStatus:'APPROVED',deletedAt:new Date()}])assert.throws(()=>assertVerifiedDriver(user),{status:403});
});
