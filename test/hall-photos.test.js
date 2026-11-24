const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const express=require('express');
const {prepareHallPhoto,MAX_PHOTO_BYTES}=require('../src/hall/photos');
const image=()=>sharp({create:{width:120,height:80,channels:4,background:{r:230,g:130,b:45,alpha:.7}}});

test('Hall decodes real JPEG/PNG/WebP/AVIF/GIF/TIFF files, keeps alpha and never enlarges small images',async()=>{
 for(const format of ['jpeg','png','webp','avif','gif','tiff']){
  const input=await image().toFormat(format,format==='tiff'?{compression:'deflate'}:{}).toBuffer(),photo=await prepareHallPhoto(input),metadata=await sharp(photo.buffer).metadata();
  assert.ok(['image/jpeg','image/png','image/webp','image/avif'].includes(photo.mimeType));
  assert.equal(metadata.width,120,format);assert.equal(metadata.height,80,format);assert.ok(photo.storedBytes<MAX_PHOTO_BYTES);
  if(['png','webp','avif','tiff'].includes(format))assert.equal(metadata.hasAlpha,true,format);
 }
});

test('Hall rejects 8 MiB exactly, oversized, empty, truncated, forged SVG/HTML and unsupported HEIC images',async()=>{
 for(const input of [Buffer.alloc(0),Buffer.alloc(MAX_PHOTO_BYTES),Buffer.alloc(MAX_PHOTO_BYTES+1),Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>'),Buffer.from('<html>not an image</html>'),Buffer.from('000000186674797068656963000000006d69663168656963','hex')]){
  await assert.rejects(prepareHallPhoto(input),{status:400});
 }
 // Verify the new 5-8 MiB window, not merely a changed error message.
 const png=await image().png().toBuffer(),belowLimit=Buffer.concat([png,Buffer.alloc(MAX_PHOTO_BYTES-1-png.length)]);
 const result=await prepareHallPhoto(belowLimit);assert.ok(result.storedBytes<belowLimit.length/100);
});

test('Hall auto-orients phone photos, strips metadata, downsizes large photos with the original aspect ratio and uses the first animation frame',async()=>{
 const phone=await image().jpeg().withMetadata({orientation:6}).toBuffer(),rotated=await prepareHallPhoto(phone),metadata=await sharp(rotated.buffer).metadata();
 assert.deepEqual([metadata.width,metadata.height],[80,120]);assert.equal(metadata.orientation,undefined);assert.equal(metadata.exif,undefined);assert.equal(metadata.xmp,undefined);
 const big=await sharp({create:{width:4000,height:2000,channels:3,background:'#aa5511'}}).jpeg().toBuffer(),resized=await prepareHallPhoto(big);
 assert.deepEqual([resized.width,resized.height],[2560,1280]);
 const raw=Buffer.alloc(16*32*3,140);raw.fill(230,16*16*3);const gif=await sharp(raw,{raw:{width:16,height:32,channels:3,pageHeight:16}}).gif({delay:[100,100],loop:0}).toBuffer();
 assert.equal((await sharp(gif).metadata()).pages,2);
 const frame=await prepareHallPhoto(gif);const frameMetadata=await sharp(frame.buffer).metadata();assert.equal(frameMetadata.pages||1,1);assert.equal(frameMetadata.height,16);
});

test('Hall compression significantly reduces a photographic gradient while preserving colour detail',async()=>{
 const width=1200,height=800,raw=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;raw[i]=Math.round(x/width*255);raw[i+1]=Math.round(y/height*255);raw[i+2]=Math.round((Math.sin(x/40)+1)*60+y/height*60);}
 const original=await sharp(raw,{raw:{width,height,channels:3}}).png().toBuffer(),result=await prepareHallPhoto(original),decoded=await sharp(result.buffer).removeAlpha().raw().toBuffer();
 assert.ok(result.storedBytes<original.length*.7,`${original.length} -> ${result.storedBytes}`);
 let difference=0;for(let i=0;i<raw.length;i++)difference+=Math.abs(raw[i]-decoded[i]);
 assert.ok(difference/raw.length<3,`Mean absolute colour error: ${difference/raw.length}`);
});

test('Hall multipart upload accepts real formats, stores readable optimized files, isolates owners, enforces size and five-photo limit, and cleans failures',async()=>{
 const folder=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'hall-photo-upload-'));
 const owner=randomUUID(),listingId=randomUUID(),photos=[],row={id:listingId,ownerId:owner,status:'DRAFT',version:0,photos,orders:[]};
 let fail=false;
 const prisma={$queryRaw:async()=>[],hallListing:{findFirst:async({where})=>where.id===row.id&&where.ownerId===owner?{...row,photos:[...photos]}:null,update:async()=>{row.version++;return row;}},hallOrder:{updateMany:async()=>({count:0}),findFirst:async()=>null},hallPhoto:{create:async({data})=>{if(fail)throw new Error('Simulated storage transaction failure');const photo={id:randomUUID(),readToken:randomUUID(),...data};photos.push(photo);return photo;},findUnique:async({where})=>{const photo=photos.find(p=>p.id===where.id);return photo?{...photo,listing:{status:row.status}}:null;}}};prisma.$transaction=fn=>fn(prisma);
 const app=express();app.use(express.json());
 require('../src/hall/routes').registerHall({app,prisma,redis:{},config:{UPLOAD_DIR:folder},auth:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.user={id:req.headers.authorization};next();},admin:(_req,res)=>res.sendStatus(401),limit:()=>((_req,_res,next)=>next())});
 app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1/hall`;
 async function upload(buffer,name='car.jpg',mime='image/jpeg',user=owner){const form=new FormData();form.set('file',new Blob([buffer],{type:mime}),name);const response=await fetch(base+`/mine/${listingId}/photos`,{method:'POST',headers:{Authorization:user},body:form});return {status:response.status,data:await response.json()};}
 try{
  const png=await image().png().toBuffer();
  assert.equal((await upload(png,'car.png','image/png','stranger')).status,404);assert.deepEqual(await fs.readdir(folder),[]);
  assert.equal((await upload(Buffer.alloc(MAX_PHOTO_BYTES),'car.png','image/png')).status,400);
  assert.equal((await upload(Buffer.alloc(MAX_PHOTO_BYTES+1),'car.png','image/png')).status,400);
  assert.equal((await upload(Buffer.from('<html>fake</html>'),'car.jpg','image/jpeg')).status,400);
  fail=true;assert.equal((await upload(png,'car.png','image/png')).status,500);assert.deepEqual(await fs.readdir(folder),[]);fail=false;
  const gapUpload=await upload(Buffer.concat([png,Buffer.alloc(6*1024*1024-png.length)]),'large.png','image/png');assert.equal(gapUpload.status,201,JSON.stringify(gapUpload));
  const gapPhoto=photos.pop();assert.ok((await fs.stat(path.join(folder,gapPhoto.storageKey))).size<1024);await fs.unlink(path.join(folder,gapPhoto.storageKey));
  for(const format of ['jpeg','png','webp','avif','tiff']){
   const uploaded=await upload(await image().toFormat(format).toBuffer(),`car.${format}`,`image/${format}`);assert.equal(uploaded.status,201,JSON.stringify(uploaded));
   const saved=photos.at(-1),buffer=await fs.readFile(path.join(folder,saved.storageKey));assert.ok(buffer.length<MAX_PHOTO_BYTES);await sharp(buffer).metadata();
   assert.equal((await fetch(base+`/photos/${saved.id}`)).status,404);
   const privateRead=await fetch(base+`/photos/${saved.id}?token=${saved.readToken}`);assert.equal(privateRead.status,200);assert.equal(privateRead.headers.get('content-type'),saved.mimeType);assert.deepEqual(Buffer.from(await privateRead.arrayBuffer()),buffer);
  }
  assert.equal((await upload(png,'sixth.png','image/png')).status,400);assert.equal((await fs.readdir(folder)).length,5);
 }finally{await new Promise(r=>server.close(r));for(const file of await fs.readdir(folder))await fs.unlink(path.join(folder,file));await fs.rmdir(folder);}
});
