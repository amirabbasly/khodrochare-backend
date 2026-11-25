const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{readFile}=require('node:fs/promises'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{PGLiteSocketServer}=require('@electric-sql/pglite-socket'),{PrismaClient}=require('@prisma/client');
const {registerImportRequests,registerImportReview}=require('../src/import-requests'),{operatorAuth,bridgeSignature}=require('../src/operator/auth');
test('real import migration and HTTP: captcha gate, single-use owner binding, idempotent submissions and signed operator filters',{timeout:90000},async()=>{
 const db=await PGlite.create(),tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});let prisma,server;
 try{
  await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY)');await db.exec(await readFile(path.join(__dirname,'../prisma/migrations/202611240009_import_requests/migration.sql'),'utf8'));
  const owner=randomUUID(),other=randomUUID();for(const id of [owner,other])await db.query('INSERT INTO "User" VALUES ($1)',[id]);
  await tcp.start();prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}}});
  const values=new Map(),redis={set:async(key,value,...args)=>{if(args.includes('NX')&&values.has(key))return null;values.set(key,value);return 'OK';},getdel:async key=>{const value=values.get(key);values.delete(key);return value;}};
  const app=express();app.use(express.json());const auth=(req,res,next)=>{if(![owner,other].includes(req.get('Authorization')))return res.sendStatus(401);req.user={id:req.get('Authorization')};next();};
  registerImportRequests({app,prisma,redis,auth,limit:()=>((_req,_res,next)=>next())});
  const secret='imports-operator-bridge-secret-01234567890123456789';app.use('/api/v1/operator',operatorAuth({OPERATOR_BRIDGE_SECRET:secret},redis));registerImportReview({app,root:'/api/v1/operator',prisma});
  app.use((error,_req,res,_next)=>res.status(error.name==='ZodError'?400:error.status||500).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(route,body,who=owner){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:who,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
  async function operator(query='',signed=true){const route='/api/v1/operator/imports'+query,time=String(Date.now()),nonce=randomUUID(),actor=Buffer.from(JSON.stringify({id:'op',role:'operator',name:'اپراتور'})).toString('base64url');const r=await fetch(base.replace('/api/v1','')+route,{headers:signed?{'X-Operator-Time':time,'X-Operator-Nonce':nonce,'X-Operator-Actor':actor,'X-Operator-Signature':bridgeSignature(secret,'GET',route,time,nonce,actor)}:{}});return{status:r.status,data:await r.json()};}
  assert.equal((await call('/imports/captcha/'+randomUUID(),{},'unknown')).status,401);assert.equal((await operator('',false)).status,401);
  for(const kind of ['CARS','PARTS']){
   const id=randomUUID(),payload={id,kind,fullName:'مشتری نمونه',phone:'۰۹۱۲۱۲۳۴۵۶۷',city:'تهران',subject:kind==='CARS'?'خودرو BMW':'قطعه ترمز',description:'درخواست بررسی شرایط تأمین و واردات',partCode:kind==='PARTS'?'A-123':''};
   assert.equal((await call('/imports/requests',{...payload,proof:randomUUID()})).status,400);assert.equal(await prisma.importRequest.count(),kind==='CARS'?0:1);
   const challenge=await call('/imports/captcha/'+id,{}),key=`imports:captcha:challenge:${owner}:${id}:${challenge.data.id}`,target=JSON.parse(values.get(key));
   target.at-=600;values.set(key,JSON.stringify(target));
   const solved=await call('/imports/captcha/'+id+'/solve',{id:challenge.data.id,x:target.x});assert.equal(solved.status,200);
   assert.equal((await call('/imports/requests',{...payload,proof:solved.data.proof},other)).status,400);
   assert.equal((await call('/imports/requests',{...payload,proof:solved.data.proof})).status,201);
   assert.equal((await call('/imports/requests',{...payload,proof:solved.data.proof})).status,201);
   assert.equal((await call('/imports/requests',{...payload,id:randomUUID(),proof:solved.data.proof})).status,400);
   assert.equal((await call('/imports/requests',{...payload,subject:'متفاوت',proof:solved.data.proof})).status,409);
   const rows=await operator('?kind='+kind);assert.equal(rows.status,200);assert.equal(rows.data.items.length,1);assert.equal(rows.data.items[0].phone,'09121234567');assert.equal(rows.data.items[0].kind,kind);
  }
  assert.equal(await prisma.importRequest.count(),2);assert.equal((await operator('?q='+encodeURIComponent('BMW'))).data.items.length,1);
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();await tcp.stop();await db.close();}
});
