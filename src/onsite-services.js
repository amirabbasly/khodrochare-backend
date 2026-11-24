const {z}=require('zod');
const {HttpError,repair}=require('./domain');
const SERVICES=['MOBILE_CARWASH','PERIODIC_SERVICE','INSPECTION'];
const schema=repair.omit({problem:true}).extend({problem:z.string().trim().max(2000).default(''),vehicleClass:z.enum(['HATCHBACK','SEDAN','SUV']).default('SEDAN'),options:z.array(z.string().min(1).max(40)).min(1).max(12),tariffVersion:z.string().max(100)}).strict();
const maintenance=[['ENGINE_OIL','روغن موتور'],['OIL_FILTER','فیلتر روغن'],['AIR_FILTER','فیلتر هوا'],['CABIN_FILTER','فیلتر کابین'],['FUEL_FILTER','فیلتر بنزین'],['GEAR_OIL','روغن گیربکس'],['BRAKE_FLUID','روغن ترمز'],['COOLANT','مایع خنک‌کننده'],['SPARK_PLUGS','شمع موتور'],['WIPERS','تیغه برف‌پاک‌کن']].map(([code,name])=>({code,name,priceToman:0,materialsOnly:true}));
// Source prices are a dated market reference, not a claim of an official tariff.
const defaults={version:'tehran-1405-09-02-v1',checkedAt:'2026-11-23',city:'تهران',discountPercent:30,sources:[{url:'https://homeservize.com/carwash',title:'کارواش سیار هوم‌سرویز'},{url:'https://homeservize.com/car-expert',title:'کارشناسی خودرو هوم‌سرویز'},{url:'https://homeservize.com/oil-filters-change',title:'تعویض روغن در محل هوم‌سرویز'}],services:{
 MOBILE_CARWASH:[{code:'FULL',name:'کارواش کامل؛ روشویی و نظافت داخل',prices:{HATCHBACK:650000,SEDAN:800000,SUV:1000000}},{code:'EXTERIOR',name:'فقط روشویی',prices:{HATCHBACK:400000,SEDAN:500000,SUV:650000},estimated:true},{code:'INTERIOR',name:'فقط توشویی و جارو',prices:{HATCHBACK:350000,SEDAN:450000,SUV:550000},estimated:true},{code:'WHEEL_CLEAN',name:'شست‌وشوی چهار رینگ',priceToman:180000},{code:'TIRE_WAX',name:'واکس چهار لاستیک',priceToman:180000},{code:'DOOR_WAX',name:'واکس رودری‌ها',priceToman:100000},{code:'LEATHER_WAX',name:'واکس صندلی چرم',priceToman:120000}],
 INSPECTION:[{code:'BODY',name:'کارشناسی رنگ و بدنه',prices:{HATCHBACK:1000000,SEDAN:1500000,SUV:2500000}},{code:'FULL_INSPECTION',name:'کارشناسی کامل بدنه و فنی',prices:{HATCHBACK:3000000,SEDAN:4000000,SUV:7000000}}],PERIODIC_SERVICE:maintenance}};
function catalog(config={}){
 const value=config.ON_SITE_TARIFFS_JSON?JSON.parse(config.ON_SITE_TARIFFS_JSON):structuredClone(defaults);
 if(!value.version||!value.checkedAt||!Number.isFinite(Date.parse(value.checkedAt))||Date.parse(value.checkedAt)>Date.now()+86400000||!value.services||value.discountPercent!==30)throw new HttpError(503,'تعرفه خدمات نیازمند بررسی است.');
 for(const service of SERVICES){if(!Array.isArray(value.services[service])||!value.services[service].length||new Set(value.services[service].map(p=>p.code)).size!==value.services[service].length)throw new HttpError(503,'تعرفه خدمت معتبر نیست.');for(const row of value.services[service]){if(typeof row.code!=='string'||typeof row.name!=='string'||![row.priceToman,...Object.values(row.prices||{})].filter(v=>v!==undefined).every(v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000))throw new HttpError(503,'تعرفه خدمت معتبر نیست.');}}
 return value;
}
function estimate(service,input,config={}){
 const c=catalog(config);if(!SERVICES.includes(service))throw new HttpError(400,'خدمت معتبر نیست.');
 if(input.tariffVersion!==c.version)throw new HttpError(409,'تعرفه تغییر کرده است؛ قیمت جدید را بررسی کنید.');
 const options=[...new Set(input.options)];if(options.length!==input.options.length)throw new HttpError(400,'خدمت تکراری است.');
 if(service==='INSPECTION'&&options.length!==1)throw new HttpError(400,'یک نوع کارشناسی انتخاب کنید.');
 if(service==='MOBILE_CARWASH'&&options.filter(code=>['FULL','EXTERIOR','INTERIOR'].includes(code)).length!==1)throw new HttpError(400,'یک بستهٔ اصلی کارواش انتخاب کنید.');
 const items=options.map(code=>{const row=c.services[service].find(p=>p.code===code);if(!row)throw new HttpError(400,'گزینه انتخاب‌شده معتبر یا فعال نیست.');const amount=service==='PERIODIC_SERVICE'?0:row.prices?.[input.vehicleClass]??row.priceToman;if(!Number.isSafeInteger(amount))throw new HttpError(503,'تعرفه این خودرو تنظیم نشده است.');return{code,name:row.name,originalPriceToman:amount,estimated:!!row.estimated};});
 const originalPriceToman=items.reduce((sum,row)=>sum+row.originalPriceToman,0),discountPercent=service==='PERIODIC_SERVICE'?0:30,priceToman=Math.round(originalPriceToman*(100-discountPercent)/100);
 if(priceToman>1000000000)throw new HttpError(400,'مبلغ خدمت معتبر نیست.');
 return{priceToman,pricingVersion:c.version,pricingBreakdown:{service,version:c.version,baseToman:originalPriceToman,originalPriceToman,discountPercent,totalToman:priceToman,requiresAgreement:false,partsPricing:service==='PERIODIC_SERVICE'?'AFTER_INSPECTION':undefined,laborToman:service==='PERIODIC_SERVICE'?0:undefined,vehicleClass:input.vehicleClass,items,checkedAt:c.checkedAt,city:c.city,sources:c.sources}};
}
module.exports={SERVICES,schema,estimateSchema:schema.pick({options:true,vehicleClass:true,tariffVersion:true}),catalog,estimate,defaults};
