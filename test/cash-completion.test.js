const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient,Prisma}=require('@prisma/client');
const {createApp}=require('../src/app');
const {createServices}=require('../src/services');
const {createPayments}=require('../src/payments');

test('all five services complete after driver cash receipt, including legacy ticks and free maintenance, without double commission', {timeout:120000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server;
 try{
  for(const e of Prisma.dmmf.datamodel.enums)await db.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v=>`'${v.name}'`).join(',')})`);
  const names=['User','AssistanceRequest','Payment','PaymentAttempt','WalletEntry','DriverEarning','Outbox','GatewayCheckout'];
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>names.includes(m.name))){
   const columns=model.fields.filter(f=>f.kind!=='object').map(f=>{
    const type=f.kind==='enum'?`"${f.type}"`:({String:'TEXT',Int:'INTEGER',BigInt:'BIGINT',Float:'DOUBLE PRECISION',Boolean:'BOOLEAN',DateTime:'TIMESTAMP(3)',Json:'JSONB'}[f.type]);if(!type)return null;
    let def='';if(f.isList)def=" DEFAULT '{}'";else if(f.default?.name==='now'||f.isUpdatedAt)def=' DEFAULT CURRENT_TIMESTAMP';else if(f.hasDefaultValue&&typeof f.default!=='object')def=' DEFAULT '+(typeof f.default==='boolean'?(f.default?'TRUE':'FALSE'):typeof f.default==='number'?f.default:`'${f.default}'`);
    return `"${f.name}" ${type}${f.isList?'[]':''}${f.isId?' PRIMARY KEY':f.isUnique?' UNIQUE':f.isRequired?' NOT NULL':''}${def}`;
   }).filter(Boolean);await db.exec(`CREATE TABLE "${model.name}" (${columns.join(',')})`);
  }
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}},transactionOptions:{timeout:20000}});
  const customer=await prisma.user.create({data:{role:'CUSTOMER',fullName:'مشتری نمونه',phone:'09120000001',nationalId:'1234567891',passwordHash:'unused',services:[]}});
  const services=['REPAIR','TOWING','MOBILE_CARWASH','PERIODIC_SERVICE','INSPECTION'];
  const driver=await prisma.user.create({data:{role:'DRIVER',fullName:'امدادگر نمونه',phone:'09120000002',nationalId:'1234567891',passwordHash:'unused',services}});
  const config={TRUST_PROXY:0,origins:[],UPLOAD_DIR:'unused',LOCATION_MAX_AGE_SECONDS:120,ZARINPAL_MODE:'live'},redis={eval:async()=>1},io={};
  const s=createServices({prisma,config,redis,io});s.authenticateSession=undefined;s.authenticate=async token=>token==='customer'?customer:token==='driver'?driver:{...driver,id:'other'};
  server=createApp({prisma,config,redis,io,services:s}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function call(id,path,body={confirmed:true},token='driver',method='POST'){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/requests/${id}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};}
  async function job(service,extra={}){return prisma.assistanceRequest.create({data:{customerId:customer.id,driverId:driver.id,service,status:'ARRIVED',vehicleName:'خودروی تست',vehiclePlate:'12 ب 345',originLat:35.7,originLng:51.4,priceToman:service==='PERIODIC_SERVICE'?0:800000,partsApprovedToman:['REPAIR','PERIODIC_SERVICE'].includes(service)?200000:null,operationsStartedAt:['REPAIR','PERIODIC_SERVICE'].includes(service)?new Date():null,...extra}});}
  for(const service of services){
   const repair=['REPAIR','PERIODIC_SERVICE'].includes(service),request=await job(service,{driverCommissionConfirmedAt:repair?new Date():null});
   assert.equal((await call(request.id,'/status',{status:'COMPLETED'},'driver','PATCH')).status,409);
   const route=repair?'/commission-confirm':'/payment/cash/confirm';
   assert.equal((await call(request.id,route,undefined,'other')).status,404);
   assert.equal(await prisma.payment.count({where:{requestId:request.id}}),0);
   const result=await call(request.id,route);assert.equal(result.status,200,JSON.stringify(result.data));
   const paid=await prisma.payment.findUnique({where:{requestId:request.id}});
   assert.equal(paid.status,'VERIFIED');assert.equal(paid.method,'CASH');assert.equal(paid.amountToman,request.priceToman+(request.partsApprovedToman||0));
   await call(request.id,route);await call(request.id,'/payment/cash/confirm');
   assert.equal(await prisma.walletEntry.count({where:{paymentId:paid.id}}),1);
   const debit=await prisma.walletEntry.findUnique({where:{paymentId:paid.id}});assert.equal(debit.amountToman,-paid.commissionToman);
   const refreshed=await call(request.id,'',undefined,'driver','GET');assert.equal(refreshed.data.payment.status,'VERIFIED');assert.ok(refreshed.data.driverCommissionConfirmedAt);
   const done=await call(request.id,'/status',{status:'COMPLETED'},'driver','PATCH');assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.status,'COMPLETED');
   assert.equal(await prisma.driverEarning.count({where:{paymentId:paid.id}}),1);
  }
  const free=await job('PERIODIC_SERVICE',{priceToman:0,partsApprovedToman:0});assert.equal((await call(free.id,'/commission-confirm')).status,200);
  const freePayment=await prisma.payment.findUnique({where:{requestId:free.id}});assert.equal(freePayment.method,'FREE');assert.equal(freePayment.amountToman,0);assert.equal(await prisma.walletEntry.count({where:{paymentId:freePayment.id}}),0);
  assert.equal((await call(free.id,'/status',{status:'COMPLETED'},'driver','PATCH')).status,200);
  const unapproved=await job('REPAIR',{partsApprovedToman:null});assert.equal((await call(unapproved.id,'/payment/cash/confirm')).status,409);
  const pending=await job('REPAIR');const pendingPayment=await createPayments(prisma).getOrCreate(pending.id,customer.id);
  await prisma.gatewayCheckout.create({data:{userId:customer.id,paymentId:pendingPayment.id,purpose:'REQUEST',mode:'live',status:'PENDING',amountToman:pendingPayment.amountToman,merchantHash:'test',idempotencyKey:randomUUID()}});
  assert.equal((await call(pending.id,'/commission-confirm')).status,409);assert.equal(await prisma.walletEntry.count({where:{paymentId:pendingPayment.id}}),0);assert.notEqual((await prisma.payment.findUnique({where:{id:pendingPayment.id}})).status,'VERIFIED');
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();}
});
