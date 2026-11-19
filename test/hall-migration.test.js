const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {PrismaClient}=require('@prisma/client');
const {registerHall}=require('../src/hall/routes');

const migration=name=>readFile(path.join(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8');

test('actual Hall migrations and Prisma HTTP deletion reproduce the old CHECK failure and preserve orders, photos and chat after the fix',{timeout:60000},async()=>{
  const db=await PGlite.create();
  const tcp=new PGLiteSocketServer({db,host:'127.0.0.1',port:0});
  let prisma,server;
  try{
    // Only the foreign-key target is a fixture. The Hall tables and constraints are
    // created from the exact deployed migrations, not copies or JavaScript mocks.
    await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY)');
    await db.exec(await migration('202611180003_car_hall'));
    await db.exec(await migration('202611190001_hall_chat'));
    await tcp.start();
    prisma=new PrismaClient({datasources:{db:{url:`postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable`}}});
    const owner=randomUUID(),buyer=randomUUID(),stranger=randomUUID();
    for(const id of [owner,buyer,stranger])await db.query('INSERT INTO "User" (id) VALUES ($1)',[id]);
    const listing=await prisma.hallListing.create({data:{ownerId:owner,status:'PUBLISHED',version:2,draft:{contactPhone:'09901234567',color:'white',description:'fixture'},make:'Mazda',model:'3',priceToman:7700000000n,publishedAt:new Date()}});
    await prisma.hallPhoto.create({data:{listingId:listing.id,storageKey:'fixture-'+randomUUID(),mimeType:'image/png'}});
    await prisma.hallOrder.create({data:{userId:owner,listingId:listing.id,listingVersion:2,action:'UPGRADE',planCode:'FEATURED',snapshot:{name:'Featured',durationHours:48},amountToman:50000,idempotencyKey:randomUUID(),status:'VERIFIED',activatedAt:new Date()}});
    const conversation=await prisma.hallConversation.create({data:{listingId:listing.id,buyerId:buyer,sellerId:owner}});
    await prisma.hallMessage.create({data:{conversationId:conversation.id,senderId:buyer,clientId:randomUUID(),body:'Saved conversation'}});
    const errors=[],app=express();app.use(express.json());
    registerHall({app,prisma,redis:{},config:{},auth:(req,res,next)=>{if(![owner,buyer,stranger].includes(req.headers.authorization))return res.sendStatus(401);req.user={id:req.headers.authorization};next();},admin:(_req,res)=>res.sendStatus(401),limit:()=>((_req,_res,next)=>next())});
    app.use((error,_req,res,_next)=>{errors.push(error);res.status(error.status||500).json({error:'request failed'});});
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api/v1/hall`;
    const remove=(id,user=owner)=>fetch(`${base}/mine/${id}`,{method:'DELETE',headers:{authorization:user}});
    assert.equal((await remove(listing.id)).status,500);
    assert.match(errors.at(-1).message,/HallListing_status_check/);
    assert.equal((await prisma.hallListing.findUnique({where:{id:listing.id}})).version,2);

    await db.exec(await migration('202611190002_hall_deleted_status'));
    assert.equal((await remove(listing.id,stranger)).status,404);
    assert.equal((await remove(listing.id)).status,204);
    assert.equal((await remove(listing.id)).status,204,'deletion retries are idempotent');
    const removed=await prisma.hallListing.findUnique({where:{id:listing.id}});
    assert.equal(removed.status,'DELETED');assert.equal(removed.version,3);
    assert.equal((await fetch(`${base}/listings/${listing.id}`)).status,404);
    const mine=await fetch(`${base}/mine`,{headers:{authorization:owner}});
    assert.equal((await mine.json()).total,0);
    assert.equal(await prisma.hallPhoto.count({where:{listingId:listing.id}}),1);
    assert.equal(await prisma.hallOrder.count({where:{listingId:listing.id}}),1);
    assert.equal(await prisma.hallMessage.count({where:{conversationId:conversation.id}}),1);
    for(const status of ['DRAFT','BLOCKED','SOLD']){
      const row=await prisma.hallListing.create({data:{ownerId:owner,status}});
      assert.equal((await remove(row.id)).status,204);
    }
    await assert.rejects(prisma.hallListing.update({where:{id:listing.id},data:{status:'INVALID'}}),/HallListing_status_check/);
    assert.equal(errors.filter(e=>!e.status).length,1,'only the deliberately reproduced old schema fails');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(prisma)await prisma.$disconnect();
    await tcp.stop();await db.close();
  }
});
