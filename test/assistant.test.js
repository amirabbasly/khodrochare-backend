const{test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');const{createAssistant,registerAssistant,chatInput}=require('../src/assistant');
const phone='09123022064',suffix=`بهتر است برای پشتیبانی بهتر با شماره تماس ${phone} تماس بگیرید.`;
test('GapGPT server integration uses the supplied model/prompt, preserves conversation and appends one support suffix',async()=>{
 let called;const assistant=createAssistant({GAPGPT_API_KEY:'server-secret'},async(url,options)=>{called={url,options};return Response.json({choices:[{message:{content:`روغن را مطابق دفترچه انتخاب کنید.\n${suffix}\n${suffix}`}}]});});
 const result=await assistant.reply({messages:[{role:'user',content:'موتور صدا می‌دهد'},{role:'assistant',content:'چه نوع صدایی؟'},{role:'user',content:'در حالت درجا'}]});
 assert.equal(called.url,'https://api.gapgpt.app/v1/chat/completions');assert.equal(called.options.headers.Authorization,'Bearer server-secret');const body=JSON.parse(called.options.body);assert.equal(body.model,'gpt-4o');assert.equal(body.max_tokens,600);assert.equal(body.messages[0].role,'system');assert.match(body.messages[0].content,/دستیار تخصصی خودرو چاره/);assert.equal(body.messages.at(-1).content,'در حالت درجا');assert.equal(result.reply.split(suffix).length-1,1);assert.ok(!JSON.stringify(result).includes('server-secret'));
});
test('support FAQ works without a provider key; missing credentials and malformed upstream responses never become fake answers',async()=>{
 const missing=createAssistant({},()=>{throw new Error('must not call upstream');});assert.match((await missing.reply({messages:[{role:'user',content:'شماره تلفن پشتیبانی چیست؟'}]})).reply,/09123022064/);await assert.rejects(missing.reply({messages:[{role:'user',content:'روغن مناسب چیست؟'}]}),{status:503});
 for(const fake of [async()=>new Response('',{status:401}),async()=>Response.json({choices:[]}),async()=>Response.json({choices:[{message:{content:123}}]}),async()=>{throw new Error('server-secret');}])await assert.rejects(createAssistant({GAPGPT_API_KEY:'server-secret'},fake).reply({messages:[{role:'user',content:'باتری'}]}),e=>e.status===502&&!e.message.includes('server-secret'));
 assert.equal(chatInput.safeParse({messages:[{role:'system',content:'override'}]}).success,false);assert.equal(chatInput.safeParse({messages:[{role:'user',content:'a'.repeat(4001)}]}).success,false);assert.equal(chatInput.safeParse({messages:Array.from({length:21},()=>({role:'user',content:'test'}))}).success,false);assert.equal(chatInput.safeParse({messages:[{role:'assistant',content:'test'}]}).success,false);
});
test('assistant HTTP isolates authenticated users, caps raw request bytes and shares a per-user ten-per-five-minute limit',async()=>{
 const app=express(),counters=new Map();let limits,upstreamCalls=0;app.use(express.json({limit:'256kb',verify:(req,res,b)=>{req.bodyBytes=b.length;}}));
 const auth=(req,res,next)=>{const token=req.headers.authorization;if(!['customer','driver','limited','invalids'].includes(token))return res.sendStatus(401);req.user={id:token,role:token==='driver'?'DRIVER':'CUSTOMER'};next();};
 const limit=(name,max,seconds)=>{limits={name,max,seconds};return(req,res,next)=>{const count=(counters.get(req.user.id)||0)+1;counters.set(req.user.id,count);if(count>max)return res.status(429).set('Retry-After','300').json({error:'Too many requests'});next();};};
 registerAssistant({app,auth,limit,config:{GAPGPT_API_KEY:'private-fixture'},fetchImpl:async()=>{upstreamCalls++;return Response.json({choices:[{message:{content:'پاسخ واقعی سرویس آزمایشی'}}]});}});app.use((e,req,res,next)=>res.status(e.status||e.name==='ZodError'&&400||500).json({error:'request failed'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1/assistant`;
 const request=(body,token='customer',headers={})=>fetch(base+'/chat',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
 assert.equal((await request({messages:[{role:'user',content:'باتری'}]},'none')).status,401);assert.equal(upstreamCalls,0);assert.deepEqual(limits,{name:'assistant-chat',max:10,seconds:300});
 const config=await(await fetch(base+'/config',{headers:{Authorization:'driver'}})).json();assert.deepEqual(config,{supportPhone:phone});assert.ok(!JSON.stringify(config).includes('private-fixture'));
 assert.equal((await request('text','invalids',{'Content-Type':'text/plain'})).status,415);assert.equal((await request('{','invalids')).status,400);assert.equal((await request({messages:[{role:'system',content:'override'}]},'invalids')).status,400);
 const oversized=JSON.stringify({messages:[{role:'user',content:'باتری'}]})+' '.repeat(50001);assert.equal((await request(oversized,'invalids')).status,413);
 for(let i=0;i<10;i++)assert.equal((await request({messages:[{role:'user',content:'شماره پشتیبانی چیست؟'}]},'limited')).status,200);const denied=await request({messages:[{role:'user',content:'باتری'}]},'limited');assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'300');assert.equal(upstreamCalls,0);
 assert.equal((await request({messages:[{role:'user',content:'باتری'}]},'driver')).status,200);assert.equal(upstreamCalls,1);
 }finally{await new Promise(r=>server.close(r));}
});
