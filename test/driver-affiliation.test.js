const {test}=require('node:test');const assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');const {readFile}=require('node:fs/promises');const {input,register}=require('../src/driver-affiliation');
test('branding choices validate company names; real SQL persists changes, isolates users and rejects customers',async()=>{
 const db=new PGlite();await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); INSERT INTO "User" VALUES (\'driver\'),(\'other\'),(\'customer\')');await db.exec(await readFile(require('node:path').join(__dirname,'../prisma/migrations/202611260001_driver_affiliation/migration.sql'),'utf8'));
 const query=(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values);const prisma={$queryRaw:async(...args)=>(await query(...args)).rows,$executeRaw:query};
 assert(!input.safeParse({branding:false,activity:'OTHER_COMPANY'}).success);assert(!input.safeParse({branding:true,activity:'FREELANCE'}).success);
 const app=require('express')();app.use(require('express').json());register({app,prisma,auth:(req,res,next)=>{req.user={id:req.headers['x-user']||'driver',role:req.headers['x-user']==='customer'?'CUSTOMER':'DRIVER'};next();}});app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const call=(method,body,user='driver')=>fetch(base+'/api/v1/me/affiliation',{method,headers:{'content-type':'application/json','x-user':user},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal(await(await call('GET')).json(),null);assert.equal((await call('PATCH',{branding:false,activity:'OTHER_COMPANY'})).status,400);
  const result=await(await call('PATCH',{branding:false,activity:'OTHER_COMPANY',companyName:'Test Company'})).json();assert.equal(result.companyName,'Test Company');assert.equal(await(await call('GET',null,'other')).json(),null);
  assert.equal((await call('PATCH',{branding:true},'customer')).status,403);
  assert.equal((await call('PATCH',{branding:true})).status,200);assert.deepEqual(await(await call('GET')).json(),{branding:true,activity:null,companyName:null});
  assert.equal((await call('PATCH',{branding:false,activity:'FREELANCE'})).status,200);assert.equal((await(await call('GET')).json()).activity,'FREELANCE');
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
