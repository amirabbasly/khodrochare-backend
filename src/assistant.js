const {z}=require('zod');
const {HttpError}=require('./domain');
const ENDPOINT='https://api.gapgpt.app/v1/chat/completions';
const message=z.object({role:z.enum(['user','assistant']),content:z.string().trim().min(1).max(4000)}).strict();
const chatInput=z.object({messages:z.array(message).min(1).max(20)}).strict().refine(v=>v.messages.at(-1)?.role==='user','آخرین پیام باید پرسش کاربر باشد.').refine(v=>v.messages.reduce((n,m)=>n+m.content.length,0)<=20000,'حجم گفتگو بیش از حد مجاز است.');
function createAssistant(config,fetchImpl=globalThis.fetch){
 const phone=config.ASSISTANT_SUPPORT_PHONE||'09123022064';
 const suffix=`بهتر است برای پشتیبانی بهتر با شماره تماس ${phone} تماس بگیرید.`;
 const prompt=`شما دستیار تخصصی خودرو چاره هستید و فقط درباره عیب‌یابی و نگهداری خودرو، خدمات مکانیکی، برق و باتری، کارواش سیار، امداد جاده‌ای و اپلیکیشن خودرو چاره پاسخ می‌دهید. اگر درباره هویت شما پرسیده شد، بگویید «من دستیار تخصصی خودرو چاره هستم». پاسخ‌ها کوتاه، مودب، ایمن و کاربردی باشند. برای تعمیرات پرخطر یا مواردی که نیاز به بررسی حضوری دارند، کاربر را از اقدام شخصی منع کنید. اگر سؤال خارج از حوزه بود، شفاف اعلام کنید که فقط درباره خودرو و اپلیکیشن خودرو چاره پاسخ می‌دهید. در انتهای تمام پاسخ‌ها دقیقاً این جمله را اضافه کنید: «${suffix}»`;
 async function reply(input,signal){
  const {messages}=chatInput.parse(input),last=messages.at(-1).content;
  if(/پشتیبانی/.test(last)&&/(شماره|تلفن|تماس)/.test(last))return {reply:`شماره تلفن پشتیبانی ${phone} است. ${suffix}`};
  if(!config.GAPGPT_API_KEY)throw new HttpError(503,'دستیار هوشمند موقتاً در دسترس نیست؛ از گزینه تماس با پشتیبانی استفاده کنید.');
  try{
   const timeout=AbortSignal.timeout(30000);
   const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.GAPGPT_API_KEY}`},body:JSON.stringify({model:config.GAPGPT_MODEL||'gpt-4o',messages:[{role:'system',content:prompt},...messages],max_tokens:600,temperature:0.3}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
   if(!response.ok)throw new Error('Upstream unavailable');
   const data=await response.json();let text=data?.choices?.[0]?.message?.content;
   if(typeof text!=='string'||!text.trim()||text.length>16000)throw new Error('Invalid completion');
   text=text.trim();while(text.endsWith(suffix))text=text.slice(0,-suffix.length).trim();
   return {reply:`${text}${text?'\n\n':''}${suffix}`};
  }catch{throw new HttpError(502,'ارتباط با دستیار هوشمند برقرار نشد؛ دوباره تلاش کنید.');}
 }
 return{reply,phone};
}
function registerAssistant({app,auth,limit,config,fetchImpl}){
 const assistant=createAssistant(config,fetchImpl);
 app.get('/api/v1/assistant/config',auth,(_req,res)=>res.json({supportPhone:assistant.phone}));
 app.post('/api/v1/assistant/chat',auth,limit('assistant-chat',10,300),async(req,res)=>{
  if(!req.is('application/json'))throw new HttpError(415,'نوع محتوا باید JSON باشد.');
  if((req.bodyBytes??Buffer.byteLength(JSON.stringify(req.body||{}),'utf8'))>50000)throw new HttpError(413,'حجم درخواست بیش از حد مجاز است.');
  const controller=new AbortController();
  const aborted=()=>controller.abort();const closed=()=>{if(!res.writableEnded)controller.abort();};
  req.on('aborted',aborted);res.on('close',closed);
  try{res.set('Cache-Control','no-store').json(await assistant.reply(req.body,controller.signal));}
  finally{req.off('aborted',aborted);res.off('close',closed);}
 });
}
module.exports={createAssistant,registerAssistant,chatInput};
