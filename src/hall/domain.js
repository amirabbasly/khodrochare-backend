const {z}=require('zod');
const {normalize}=require('../market/domain');
const phone=z.string().regex(/^09\d{9}$/);
const text=z.string().trim().max(120);
const location=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),visibility:z.enum(['EXACT','AREA']),address:z.string().trim().max(500).optional()}).strict();
const details=z.object({
  make:text.min(1),model:text.min(1),trim:text.min(1),
  year:z.number().int().min(1300).max(2100),mileage:z.number().int().min(0).max(2000000),
  color:text.min(1),bodyCondition:z.enum(['سالم','رنگ‌شدگی جزئی','چند لکه رنگ','تمام‌رنگ','تصادفی']),
  technicalCondition:z.enum(['سالم','نیازمند سرویس','نیازمند تعمیر']),city:text.min(2),
  description:z.string().trim().min(20).max(6000),contactPhone:phone,
  priceToman:z.number().int().min(1000000).max(1000000000000).optional(),
  fuelType:z.enum(['بنزین','دیزل','دوگانه‌سوز','هیبریدی','برقی','گازسوز']).optional(),
  gearboxType:z.enum(['دستی','اتوماتیک','نیمه‌اتوماتیک']).optional(),
  chassisCondition:z.enum(['سالم و پلمپ','ضربه‌خورده','تعویض‌شده']).optional(),
  gearboxCondition:z.enum(['سالم','سالم و پلمپ','نیازمند سرویس','نیازمند تعمیر','تعویض‌شده']).optional(),
  location:location.optional(),
}).strict();
const draftSchema=details.partial().extend({make:text.optional(),model:text.optional(),trim:text.optional(),city:text.optional(),color:text.optional(),description:z.string().max(6000).optional(),contactPhone:z.string().regex(/^\d{0,11}$/).optional()});
const priceInput=details.pick({make:true,model:true,trim:true,year:true,mileage:true,bodyCondition:true,technicalCondition:true,city:true});
const publicationDetails=details.required({priceToman:true,fuelType:true,gearboxType:true,location:true});
const planSchema=z.object({
  code:z.enum(['MANAGED','REPAIR_SELL','EXPRESS48','FREE','LADDER','URGENT','FEATURED']),
  name:text.min(2),kind:z.enum(['PLAN','BOOST']),description:z.string().min(5).max(1000),
  priceToman:z.number().int().min(0).max(100000000),originalPriceToman:z.number().int().min(0).max(100000000).nullable().optional(),services:z.array(z.string().max(200)).max(15),
  terms:z.string().min(5).max(2000),active:z.boolean(),durationHours:z.number().int().min(1).max(8760),sortOrder:z.number().int().min(0).max(100),
}).strict().superRefine((p,ctx)=>{
  if((['LADDER','URGENT','FEATURED'].includes(p.code))!==(p.kind==='BOOST')||p.code==='FREE'&&(p.priceToman!==0||!p.active)||p.code!=='FREE'&&p.priceToman===0)ctx.addIssue({code:'custom',message:'نوع و تعرفه طرح معتبر نیست؛ طرح رایگان باید فعال و بدون هزینه بماند.'});
});
const url=z.string().max(2000).refine(v=>/^\/(?!\/)/.test(v)||/^https:\/\/[^\s]+$/i.test(v),'نشانی HTTPS یا مسیر داخلی وارد کنید.');
const bannerSchema=z.object({title:text.min(2),subtitle:z.string().max(300).default(''),imageUrl:url,linkUrl:url,active:z.boolean(),sortOrder:z.number().int().min(0).max(1000)}).strict();
const standardTerms='کارشناسی اولیه رایگان است؛ هزینه‌های حمل، تعمیر، قطعات و کمیسیون فروش فقط با اعلام مبلغ و تأیید جداگانه مالک انجام می‌شوند. پرداخت این تعرفه به معنی پرداخت هزینه تعمیر یا تضمین فروش نیست.';
const defaultPlans=[
  {code:'MANAGED',name:'فروش با مدیریت خودرو چاره',kind:'PLAN',description:'از کارشناسی تا مذاکره، یک همراه برای فروش خودروی شما.',priceToman:1500000,services:['کارشناسی اولیه رایگان','هماهنگی بازدید و مذاکره','هدف فروش در کمتر از ۴ روز'],terms:standardTerms+' زمان فروش هدف خدمات است و تضمین نیست.',durationHours:168,sortOrder:0,active:true},
  {code:'REPAIR_SELL',name:'تعمیر و فروش',kind:'PLAN',description:'اول آماده فروش، بعد آماده یک معامله بهتر.',priceToman:2000000,services:['کارشناسی اولیه رایگان','هماهنگی حمل در صورت نیاز','تعمیر فقط با تأیید مالک','مدیریت فروش پس از آماده‌سازی'],terms:standardTerms,durationHours:168,sortOrder:1,active:true},
  {code:'EXPRESS48',name:'فروش ویژه ۴۸ ساعته',kind:'PLAN',description:'اولویت پیگیری برای خودروی سالم و واجد شرایط.',priceToman:2500000,services:['اولویت بررسی و پیگیری','نمایش ویژه تا ۴۸ ساعت','هماهنگی سریع بازدید'],terms:'هدف پیگیری سریع است و فروش در ۴۸ ساعت تضمین نمی‌شود. ویژه خودرو با بدنه و فنی سالم، کارکرد حداکثر ۱۵۰ هزار و حداکثر ۸ سال عمر. '+standardTerms,durationHours:48,sortOrder:2,active:true},
  {code:'FREE',name:'آگهی رایگان',kind:'PLAN',description:'خودتان بفروشید؛ بدون پرداخت هزینه انتشار.',priceToman:0,services:['انتشار مستقیم آگهی','دریافت درخواست خرید','دسترسی به آمار آگهی'],terms:'خرید خدمت پولی اجباری نیست. مسئولیت صحت اطلاعات آگهی با مالک است.',durationHours:168,sortOrder:3,active:true},
  ...[['LADDER','نردبان',99000,320000],['URGENT','فوری',149000,700000],['FEATURED','ویژه',199000,720000]].map(([code,name,priceToman,originalPriceToman],i)=>({code,name,kind:'BOOST',description:'افزایش دیده‌شدن آگهی منتشرشده در تالار.',priceToman,originalPriceToman,services:[code==='LADDER'?'به‌روزرسانی جایگاه آگهی و نمایش در پیشنهادها':'نمایش نشان و حضور در پیشنهادهای ویژه'],terms:'نمایش بیشتر به معنی تضمین فروش نیست. مدت خدمت از تأیید پرداخت محاسبه می‌شود.',durationHours:48,sortOrder:4+i,active:true})),
];
function expressEligible(data,now=new Date()){
  const current=data.year<1800?Number(new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric'}).formatToParts(now).find(p=>p.type==='year')?.value):now.getUTCFullYear();
  return data.bodyCondition==='سالم'&&data.technicalCondition==='سالم'&&data.mileage<=150000&&data.year<=current+1&&current-data.year<=8;
}
function indexFields(d){return{make:d.make||'',model:d.model||'',trim:d.trim||'',makeKey:normalize(d.make||''),modelKey:normalize(d.model||''),trimKey:normalize(d.trim||''),searchText:normalize([d.make,d.model,d.trim,d.city].filter(Boolean).join(' ')),year:d.year??null,mileage:d.mileage??null,city:d.city||'',bodyCondition:d.bodyCondition||'',technicalCondition:d.technicalCondition||'',priceToman:d.priceToman==null?null:BigInt(d.priceToman)};}
function analyzePrices(rows,now=new Date()){
  // One most recent asking price per owner; extreme outliers removed only with enough observations.
  const owners=new Set(),unique=rows.filter(r=>!owners.has(r.ownerId)&&owners.add(r.ownerId));
  let values=unique.map(r=>Number(r.priceToman)).filter(v=>Number.isSafeInteger(v)&&v>0).sort((a,b)=>a-b);
  if(values.length>=8){const q1=values[Math.floor((values.length-1)*.25)],q3=values[Math.floor((values.length-1)*.75)],iqr=q3-q1;values=values.filter(v=>v>=q1-1.5*iqr&&v<=q3+1.5*iqr);}
  if(!values.length)return{sampleCount:0,isEstimate:true,min:null,max:null,average:null,median:null,suggested:null,checkedAt:now,source:'آگهی‌های فعال ۳۰ روز اخیر تالار خودرو چاره',notice:'برای این مشخصات هنوز داده کافی نداریم. قیمت پیشنهادی ساخته نمی‌شود.'};
  const n=values.length,median=n%2?values[Math.floor(n/2)]:(values[n/2-1]+values[n/2])/2;
  return{sampleCount:n,isEstimate:n<5,min:values[0],max:values[n-1],average:Math.round(values.reduce((a,b)=>a+b,0)/n),median:Math.round(median),suggested:Math.round(median*.98/1000000)*1000000,checkedAt:now,source:'قیمت درخواستی آگهی‌های فعال ۳۰ روز اخیر تالار خودرو چاره',notice:n<5?'تخمین با نمونه محدود؛ قیمت معامله قطعی نیست.':'پیشنهاد فروش سریع‌تر: ۲٪ زیر میانه قیمت درخواستی موارد مشابه؛ تضمین فروش نیست.'};
}
module.exports={publicationDetails,location,details,draftSchema,priceInput,planSchema,bannerSchema,defaultPlans,expressEligible,indexFields,analyzePrices,phone,normalize};
