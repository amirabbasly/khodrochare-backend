const {z}=require('zod');
const {HttpError}=require('./domain');
const departments={TECHNICAL:'فنی و نگهداری',ROADSIDE:'امداد و حمل خودرو',HALL:'تالار خودرو',MARKET:'جمعه‌بازار',PAYMENTS:'مالی و پرداخت',GENERAL:'پشتیبانی عمومی'};
const services=[['ENGINE_OIL','روغن موتور','روغن و مایعات'],['OIL_FILTER','فیلتر روغن','فیلترها'],['AIR_FILTER','فیلتر هوا','فیلترها'],['CABIN_FILTER','فیلتر کابین','فیلترها'],['FUEL_FILTER','فیلتر سوخت','فیلترها'],['BRAKE_FLUID','روغن ترمز','روغن و مایعات'],['GEAR_OIL','روغن گیربکس','روغن و مایعات'],['COOLANT','مایع خنک‌کننده','روغن و مایعات'],['TIMING_BELT','تسمه تایم','تسمه و جرقه'],['DRIVE_BELT','تسمه دینام','تسمه و جرقه'],['SPARK_PLUG','شمع موتور','تسمه و جرقه'],['BRAKES','بازدید لنت و سیستم ترمز','بازدید و ایمنی'],['TIRES','بازدید تایر و فشار باد','بازدید و ایمنی'],['BATTERY','بازدید باتری','بازدید و ایمنی'],['WIPERS','بازدید برف‌پاک‌کن','بازدید و ایمنی']];
const source='https://padidehkhodro.com/wp-content/uploads/2024/04/Peugeot-207i-car-manual.pdf#page=155';
// Only explicit, verified intervals. Unverified models require owner/manual intervals.
function intervalFor(car,code){
 if(car?.maker==='پژو'&&car.model==='207'){
  const values={ENGINE_OIL:[10000,12],OIL_FILTER:[10000,12],BRAKE_FLUID:[40000,24],TIMING_BELT:[80000,36],DRIVE_BELT:[80000,36],BRAKES:[10000,12],TIRES:[10000,12]};
  if(values[code])return {km:values[code][0],months:values[code][1],sourceUrl:source,sourceLabel:'دفترچه پژو ۲۰۷؛ شرایط عادی، نیازمند تطبیق با سال و موتور'};
 }
 return {km:null,months:null,sourceUrl:null,sourceLabel:'بازه اختصاصی این مدل تأیید نشده؛ از دفترچه یا کارشناس وارد کنید'};
}
function addMonths(date,n){const d=new Date(date),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d;}
function schedule(vehicle,car,records,now=new Date()){
 return services.map(([code,name,category])=>{
 const last=records.filter(r=>r.serviceCode===code).sort((a,b)=>b.mileage-a.mileage||new Date(b.performedAt)-new Date(a.performedAt))[0];
 const base=intervalFor(car,code),km=last?.intervalKm??base.km,months=last?.intervalMonths??base.months;
 const nextMileage=last&&km?last.mileage+km:null,nextDate=last&&months?addMonths(last.performedAt,months):null;
 const remainingKm=nextMileage==null?null:nextMileage-vehicle.mileage;
 const days=nextDate?Math.ceil((nextDate-now)/86400000):null;
 const status=!last?'NO_HISTORY':!km&&!months?'NEEDS_INTERVAL':remainingKm!==null&&remainingKm<=0||days!==null&&days<=0?'OVERDUE':remainingKm!==null&&remainingKm<=1000||days!==null&&days<=30?'DUE_SOON':'OK';
 return {code,name,category,last:last||null,intervalKm:km,intervalMonths:months,nextMileage,nextDate,remainingKm,days,status,sourceUrl:last?.intervalKm||last?.intervalMonths?null:base.sourceUrl,sourceLabel:last?.intervalKm||last?.intervalMonths?'بازه واردشده توسط مالک':base.sourceLabel};
 }).sort((a,b)=>({OVERDUE:0,DUE_SOON:1,NO_HISTORY:2,NEEDS_INTERVAL:2,OK:3}[a.status]-{OVERDUE:0,DUE_SOON:1,NO_HISTORY:2,NEEDS_INTERVAL:2,OK:3}[b.status])||(a.remainingKm??Infinity)-(b.remainingKm??Infinity));
}
const mileage=z.number().int().min(0).max(2000000);
const garageInput=z.object({catalogCarId:z.string().min(1).max(100),productionYear:z.number().int().min(1300).max(2100),plate:z.string().trim().min(4).max(30),mileage}).strict();
const recordInput=z.object({serviceCode:z.enum(services.map(r=>r[0])),mileage,performedAt:z.iso.datetime().transform(v=>new Date(v)).refine(v=>v<=new Date(),'تاریخ سرویس نمی‌تواند در آینده باشد.'),intervalKm:z.number().int().min(100).max(200000).optional(),intervalMonths:z.number().int().min(1).max(120).optional(),note:z.string().trim().max(1000).default('')}).strict();
const message=z.string().trim().min(2).max(4000);
function registerCustomerCare({app,prisma,auth,admin,limit}){
 const root='/api/v1',uid=req=>req.user.id;
 app.get(root+'/garage',auth,async(req,res)=>res.json(await prisma.vehicle.findMany({where:{userId:uid(req)},orderBy:{id:'asc'}})));
 app.post(root+'/garage',auth,limit('garage-create',20,3600),async(req,res)=>{
  const data=garageInput.parse(req.body),car=await prisma.marketCar.findUnique({where:{id:data.catalogCarId}});if(!car)throw new HttpError(400,'خودرو را از نتایج جستجو انتخاب کنید.');
  if(await prisma.vehicle.count({where:{userId:uid(req)}})>=20)throw new HttpError(409,'حداکثر ۲۰ خودرو قابل ثبت است.');
  res.status(201).json(await prisma.vehicle.create({data:{...data,userId:uid(req),name:[car.maker,car.model,car.trim==='نامشخص'?'':car.trim].filter(Boolean).join(' ')}}));
 });
 async function owned(tx,req){const car=await tx.vehicle.findFirst({where:{id:req.params.id,userId:uid(req)}});if(!car)throw new HttpError(404,'خودرو پیدا نشد.');return car;}
 app.patch(root+'/garage/:id',auth,async(req,res)=>{const data=z.object({mileage:mileage.optional(),catalogCarId:z.string().min(1).max(100).optional(),productionYear:z.number().int().min(1300).max(2100).optional()}).strict().parse(req.body);res.json(await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${req.params.id} FOR UPDATE`;const old=await owned(tx,req);if(data.mileage!=null&&data.mileage<old.mileage)throw new HttpError(409,'کیلومتر جدید نباید از کیلومتر فعلی کمتر باشد.');if(data.catalogCarId&&!await tx.marketCar.findUnique({where:{id:data.catalogCarId}}))throw new HttpError(400,'مدل خودرو معتبر نیست.');return tx.vehicle.update({where:{id:old.id},data});}));});
 app.get(root+'/garage/:id/services',auth,async(req,res)=>{const vehicle=await owned(prisma,req);const [car,records]=await Promise.all([vehicle.catalogCarId?prisma.marketCar.findUnique({where:{id:vehicle.catalogCarId}}):Promise.resolve(null),prisma.maintenanceRecord.findMany({where:{vehicleId:vehicle.id},orderBy:[{mileage:'desc'},{performedAt:'desc'}],distinct:['serviceCode']})]);res.json({vehicle,items:schedule(vehicle,car,records)});});
 app.post(root+'/garage/:id/services',auth,limit('service-record',60,3600),async(req,res)=>{const data=recordInput.parse(req.body);res.status(201).json(await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${req.params.id} FOR UPDATE`;const car=await owned(tx,req);if(data.mileage>car.mileage)throw new HttpError(400,'کیلومتر سرویس نباید از کیلومتر فعلی بیشتر باشد.');const model=car.catalogCarId?await tx.marketCar.findUnique({where:{id:car.catalogCarId}}):null;const base=intervalFor(model,data.serviceCode);if(!data.intervalKm&&!data.intervalMonths&&!base.km&&!base.months)throw new HttpError(400,'فاصله سرویس را مطابق دفترچه خودرو وارد کنید.');return tx.maintenanceRecord.create({data:{...data,vehicleId:car.id}});}));});
 app.get(root+'/support/departments',auth,(req,res)=>res.json(departments));
 app.get(root+'/support/tickets',auth,async(req,res)=>res.json(await prisma.supportTicket.findMany({where:{userId:uid(req)},orderBy:{updatedAt:'desc'},take:100})));
 app.post(root+'/support/tickets',auth,limit('ticket-create',10,3600),async(req,res)=>{const data=z.object({department:z.enum(Object.keys(departments)),subject:z.string().trim().min(3).max(150),body:message}).strict().parse(req.body);res.status(201).json(await prisma.supportTicket.create({data:{userId:uid(req),department:data.department,subject:data.subject,messages:{create:{sender:'CUSTOMER',body:data.body}}}}));});
 async function ticket(req,staff){const row=await prisma.supportTicket.findFirst({where:{id:req.params.id,...(!staff?{userId:uid(req)}:{})}});if(!row)throw new HttpError(404,'تیکت پیدا نشد.');return row;}
 function routes(prefix,middleware,staff){
 app.get(prefix+'/:id',middleware,async(req,res)=>{const row=await ticket(req,staff);const query=z.object({before:z.string().uuid().optional()}).parse(req.query);if(query.before&&!await prisma.supportMessage.findFirst({where:{id:query.before,ticketId:row.id}}))throw new HttpError(400,'نشانگر پیام معتبر نیست.');const messages=await prisma.supportMessage.findMany({where:{ticketId:row.id},...(query.before?{cursor:{id:query.before},skip:1}:{}),orderBy:[{createdAt:'desc'},{id:'desc'}],take:100});res.json({...row,messages:messages.reverse(),hasMore:messages.length===100});});
 app.post(prefix+'/:id/messages',middleware,limit(staff?'expert-reply':'ticket-message',60,3600),async(req,res)=>{const data=z.object({body:message}).strict().parse(req.body);await ticket(req,staff);res.status(201).json(await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "SupportTicket" WHERE id=${req.params.id} FOR UPDATE`;const row=await tx.supportTicket.findUnique({where:{id:req.params.id}});if(row.status==='CLOSED')throw new HttpError(409,'تیکت بسته است؛ ابتدا آن را باز کنید.');const result=await tx.supportMessage.create({data:{ticketId:row.id,sender:staff?'EXPERT':'CUSTOMER',body:data.body}});await tx.supportTicket.update({where:{id:row.id},data:{status:staff?'WAITING_CUSTOMER':'OPEN',updatedAt:new Date()}});return result;}));});
 app.patch(prefix+'/:id',middleware,async(req,res)=>{const data=z.object({status:z.enum(staff?['OPEN','WAITING_CUSTOMER','CLOSED']:['OPEN','CLOSED'])}).strict().parse(req.body);await ticket(req,staff);res.json(await prisma.supportTicket.update({where:{id:req.params.id},data}));});
 }
 routes(root+'/support/tickets',auth,false);routes(root+'/admin/support/tickets',admin,true);
 app.get(root+'/admin/support/tickets',admin,async(req,res)=>{const q=z.object({department:z.enum(Object.keys(departments)).optional(),status:z.enum(['OPEN','WAITING_CUSTOMER','CLOSED']).optional()}).parse(req.query);res.json(await prisma.supportTicket.findMany({where:q,orderBy:{updatedAt:'desc'},take:100}));});
}
module.exports={registerCustomerCare,schedule,intervalFor,departments,garageInput,recordInput,addMonths};
