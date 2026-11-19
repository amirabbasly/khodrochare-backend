const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const http=require('node:http');
const express=require('express');
const {Server}=require('socket.io');
const {io:client}=require('socket.io-client');
const {attachRealtime}=require('../src/realtime');
const {registerChat}=require('../src/hall/chat');
const {createCaptcha}=require('../src/hall/captcha');

test('Hall HTTP rejects a sixth photo, restricts deletion to the owner, blocks unfinished plans and requires publication proof',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'khodrochare-hall-test-'));
  const id=randomUUID(),owner=randomUUID(),row={id,ownerId:owner,status:'PUBLISHED',version:1,draft:{contactPhone:'09901234567'},photos:Array.from({length:5},()=>({id:randomUUID()})),orders:[]};
  const prisma={
    $queryRaw:async()=>[],
    hallListing:{findFirst:async({where})=>Object.entries(where).every(([k,v])=>row[k]===v)?{...row}:null,update:async({data})=>Object.assign(row,data)},
    hallOrder:{updateMany:async()=>({count:0}),findFirst:async()=>null},
  };prisma.$transaction=fn=>fn(prisma);
  const app=express();app.use(express.json());
  require('../src/hall/routes').registerHall({app,prisma,redis:{getdel:async()=>null},config:{UPLOAD_DIR:folder},auth:(req,_res,next)=>{req.user={id:req.headers.authorization};next();},admin:(_req,res)=>res.sendStatus(401),limit:()=>((_req,_res,next)=>next())});
  app.use((error,_req,res,_next)=>res.status(error.status||(error.name==='ZodError'?400:500)).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1/hall`;
  const request=(url,method,body,user=owner)=>fetch(base+url,{method,headers:{authorization:user,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
  try{
    const form=new FormData();form.append('file',new Blob([Buffer.from([137,80,78,71,13,10,26,10])],{type:'image/png'}),'sixth.png');
    assert.equal((await request(`/mine/${id}/photos`,'POST',form)).status,400);assert.deepEqual(await fs.readdir(folder),[]);
    assert.equal((await request(`/mine/${id}/checkout`,'POST',{planCode:'MANAGED',idempotencyKey:randomUUID()})).status,409);
    assert.equal((await request(`/mine/${id}/publish`,'POST',{})).status,400);
    assert.equal((await request(`/mine/${id}/publish`,'POST',{proof:randomUUID()})).status,400);
    assert.equal((await request(`/mine/${id}`,'DELETE',undefined,randomUUID())).status,404);assert.equal(row.status,'PUBLISHED');
    assert.equal((await request(`/mine/${id}`,'DELETE')).status,204);assert.equal(row.status,'DELETED');
    assert.equal((await fetch(base+`/listings/${id}`)).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
});

test('puzzle tolerates a near placement, expires, binds proof to owner and listing, and cannot replay a solution',async()=>{
  const values=new Map(),redis={set:async(k,v)=>values.set(k,v),getdel:async k=>{const v=values.get(k);values.delete(k);return v;}};
  const captcha=createCaptcha(redis),user=randomUUID(),listing=randomUUID();
  const issue=async()=>{const c=await captcha.issue(user,listing);const key=[...values.keys()].find(k=>k.endsWith(c.id)),v=JSON.parse(values.get(key));v.at-=1000;values.set(key,JSON.stringify(v));return {...c,x:v.x};};
  const wrong=await issue();await assert.rejects(captcha.solve(user,listing,{id:wrong.id,x:wrong.x-40}),{status:400});
  await assert.rejects(captcha.solve(user,listing,{id:wrong.id,x:wrong.x}),{status:400});
  const fresh=await issue();await assert.rejects(captcha.solve('stranger',listing,{id:fresh.id,x:fresh.x}),{status:400});
  const {proof}=await captcha.solve(user,listing,{id:fresh.id,x:fresh.x+11});
  await assert.rejects(captcha.consume(user,randomUUID(),proof),{status:400});await captcha.consume(user,listing,proof);await assert.rejects(captcha.consume(user,listing,proof),{status:400});
  await assert.rejects(captcha.solve(user,listing,{id:randomUUID(),x:100}),{status:400});
});

test('real WebSocket chat isolates participants, persists retries once, restores HTTP history and rejects inactive ads and floods',{timeout:15000},async()=>{
  const buyer=randomUUID(),seller=randomUUID(),stranger=randomUUID(),conversationId=randomUUID(),listingId=randomUUID();
  let status='PUBLISHED',count=0;const messages=[];
  const row={id:conversationId,listingId,buyerId:buyer,sellerId:seller,updatedAt:new Date(0),buyerReadAt:new Date(0),sellerReadAt:new Date(0)};
  const prisma={
    $queryRaw:async()=>[],
    hallListing:{findUnique:async()=>({status})},
    hallConversation:{findFirst:async({where})=>where.id===conversationId&&where.OR.some(w=>w.buyerId===buyer||w.sellerId===seller)?{...row,listing:{status,make:'test',model:'car'}}:null,updateMany:async()=>({count:1}),update:async({data})=>Object.assign(row,data)},
    hallMessage:{upsert:async({create})=>{let message=messages.find(m=>m.clientId===create.clientId&&m.senderId===create.senderId);if(!message){message={id:randomUUID(),createdAt:new Date(),...create};messages.push(message);}return message;},findFirst:async({where})=>messages.find(m=>m.id===where.id&&m.conversationId===where.conversationId),findMany:async()=>[...messages].reverse()},
  };prisma.$transaction=fn=>fn(prisma);
  const app=express(),server=http.createServer(app),io=new Server(server),redis={eval:async()=>++count};
  const authenticate=async token=>{if(![buyer,seller,stranger].includes(token))throw new Error('unauthorized');return {id:token,role:'CUSTOMER'};};
  attachRealtime(io,{authenticate},redis,prisma);
  registerChat({app,prisma,redis,io,auth:async(req,res,next)=>{req.user=await authenticate(req.headers.authorization);next();},limit:()=>((_req,_res,next)=>next())});
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,sockets=[];
  const connect=token=>new Promise((resolve,reject)=>{const s=client(base,{auth:{token},transports:['websocket'],reconnection:false});sockets.push(s);s.once('connect',()=>resolve(s));s.once('connect_error',reject);});
  const emit=(socket,event,payload)=>socket.timeout(3000).emitWithAck(event,payload);
  try{
    const a=await connect(buyer),b=await connect(seller),c=await connect(stranger);let leaked=false;c.on('hall:message',()=>{leaked=true;});
    const input={conversationId,clientId:randomUUID(),body:'hello seller'},received=new Promise(resolve=>b.once('hall:message',resolve));
    assert.equal((await emit(c,'hall:send',input)).ok,false);assert.equal((await emit(c,'hall:read',{conversationId})).ok,false);
    assert.equal((await emit(a,'hall:send',input)).ok,true);assert.equal((await received).body,input.body);assert.equal(leaked,false);
    assert.equal((await emit(a,'hall:send',input)).ok,true);assert.equal(messages.length,1);
    const read=new Promise(resolve=>a.once('hall:read',resolve));assert.equal((await emit(b,'hall:read',{conversationId,messageId:messages[0].id})).ok,true);assert.equal((await read).userId,seller);
    const history=await fetch(`${base}/api/v1/hall/conversations/${conversationId}/messages`,{headers:{authorization:seller}});assert.equal(history.status,200);assert.equal((await history.json()).items.length,1);
    assert.equal((await fetch(`${base}/api/v1/hall/conversations/${conversationId}/messages`,{headers:{authorization:stranger}})).status,404);
    status='DELETED';assert.equal((await emit(a,'hall:send',{...input,clientId:randomUUID()})).ok,false);status='PUBLISHED';
    count=60;assert.equal((await emit(a,'hall:send',{...input,clientId:randomUUID()})).ok,false);assert.equal(messages.length,1);
  }finally{sockets.forEach(s=>s.disconnect());await new Promise(resolve=>io.close(resolve));}
});
