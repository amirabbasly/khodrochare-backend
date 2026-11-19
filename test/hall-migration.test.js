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
    const proofs=new Map(),errors=[],app=express();app.use(express.json());
    registerHall({app,prisma,redis:{getdel:async key=>{const value=proofs.get(key);proofs.delete(key);return value;}},config:{},auth:(req,res,next)=>{if(![owner,buyer,stranger].includes(req.headers.authorization))return res.sendStatus(401);req.user={id:req.headers.authorization};next();},admin:(_req,res)=>res.sendStatus(401),limit:()=>((_req,_res,next)=>next())});
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
    await db.exec('CREATE TABLE "MarketCar" (id TEXT PRIMARY KEY, "key" TEXT UNIQUE, maker TEXT, model TEXT, trim TEXT, aliases TEXT[])');
    await db.query('INSERT INTO "MarketCar" VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),'peugeot 207 panorama','پژو','207','پانوراما',['پژو 207','peugeot 207']]);
    await db.query('INSERT INTO "MarketCar" VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),'mazda 3','مزدا','3','سدان',['مزدا 3']]);
    const cars=await (await fetch(`${base}/vehicles?q=${encodeURIComponent('پژو ۲۰۷')}`)).json();assert.equal(cars.items.length,1);assert.equal(cars.items[0].model,'207');
    assert.equal((await (await fetch(`${base}/vehicles?q=${encodeURIComponent('پژو۲۰۷')}`)).json()).items.length,1);
    assert.equal((await (await fetch(`${base}/vehicles?q=${encodeURIComponent("207' OR 1=1--")}`)).json()).items.length,0);
    const draft=await prisma.hallListing.create({data:{ownerId:owner}});
    const details={make:'پژو',model:'207',trim:'پانوراما',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودروی سالم با سابقه نگهداری منظم برای تست کامل ثبت آگهی',contactPhone:'09901234567',priceToman:3500000000,fuelType:'بنزین',gearboxType:'اتوماتیک',chassisCondition:'سالم و پلمپ',gearboxCondition:'سالم و پلمپ',location:{latitude:35.712345,longitude:51.423456,visibility:'AREA',address:'Private building 27'}};
    const patch=async(version,data)=>{const response=await fetch(`${base}/mine/${draft.id}`,{method:'PATCH',headers:{authorization:owner,'Content-Type':'application/json'},body:JSON.stringify({version,details:data})});assert.equal(response.status,200);return response.json();};
    const saved=await patch(0,details);assert.equal(saved.details.location.latitude,details.location.latitude);
    await prisma.hallPhoto.create({data:{listingId:draft.id,storageKey:'fixture-'+randomUUID(),mimeType:'image/png'}});
    const proof=randomUUID();proofs.set(`hall:captcha:proof:${owner}:${draft.id}:${proof}`,'1');
    const published=await fetch(`${base}/mine/${draft.id}/publish`,{method:'POST',headers:{authorization:owner,'Content-Type':'application/json'},body:JSON.stringify({proof})});assert.equal(published.status,200);
    let publicAd=await (await fetch(`${base}/listings/${draft.id}`)).json();assert.equal(publicAd.gearboxType,'اتوماتیک');assert.equal(publicAd.fuelType,'بنزین');assert.equal(publicAd.location.radiusMeters,2000);assert.notEqual(publicAd.location.latitude,details.location.latitude);assert.ok(!JSON.stringify(publicAd).includes(details.location.address));
    await patch(saved.version,{...details,location:{...details.location,visibility:'EXACT'}});
    publicAd=await (await fetch(`${base}/listings/${draft.id}`)).json();assert.equal(publicAd.location.latitude,details.location.latitude);assert.equal(publicAd.location.radiusMeters,0);assert.equal(publicAd.location.address,details.location.address);
    assert.equal(errors.filter(e=>!e.status).length,1,'only the deliberately reproduced old schema fails');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(prisma)await prisma.$disconnect();
    await tcp.stop();await db.close();
  }
});
