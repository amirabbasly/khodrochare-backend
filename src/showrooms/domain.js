const {z}=require('zod');
const {phone}=require('../domain');
const provinces=['آذربایجان شرقی','آذربایجان غربی','اردبیل','اصفهان','البرز','ایلام','بوشهر','تهران','چهارمحال و بختیاری','خراسان جنوبی','خراسان رضوی','خراسان شمالی','خوزستان','زنجان','سمنان','سیستان و بلوچستان','فارس','قزوین','قم','کردستان','کرمان','کرمانشاه','کهگیلویه و بویراحمد','گلستان','گیلان','لرستان','مازندران','مرکزی','هرمزگان','همدان','یزد'];
const text=(max,min=2)=>z.string().trim().min(min).max(max);
const accountSchema=z.object({name:text(150),ownerName:text(120),activityType:z.enum(['نمایندگی','مؤسسه','شرکت','مرکز','نمایشگاه','کاسب فعال']),province:z.enum(provinces),city:text(100),district:text(100),landline:z.string().regex(/^0\d{10}$/),address:text(1000,10)}).strict();
const person=z.object({name:text(120),bio:z.string().trim().max(3000).default(''),phone,photoId:z.string().uuid().optional(),position:z.string().trim().max(120).default('')}).strict();
const draftSchema=z.object({location:accountSchema.pick({province:true,city:true,district:true,landline:true,address:true}).optional(),name:text(150),slogan:z.string().trim().max(200).default(''),biography:z.string().trim().max(5000).default(''),manager:person,staff:z.array(person).max(30).default([])}).strict();
function validateSubmission(row){
 const draft=draftSchema.parse(row.draft),photos=new Map(row.photos.map(p=>[p.id,p]));
 if(!row.photos.some(p=>p.kind==='SHOP')||!draft.manager.photoId||photos.get(draft.manager.photoId)?.kind!=='PERSON'||draft.staff.some(p=>!p.photoId||photos.get(p.photoId)?.kind!=='PERSON'))throw Object.assign(new Error('تصاویر نمایشگاه، مدیر و مشاورین را کامل بارگذاری کنید.'),{status:400});
 return draft;
}
const publicWhere={status:'PUBLISHED',isActive:true,owner:{isActive:true,user:{isActive:true,deletedAt:null}}};
const include={photos:{orderBy:{createdAt:'asc'}},owner:{include:{user:{select:{isActive:true,deletedAt:true,phone:true}}}},campaign:true};
function showroomDto(row,owned=false){
 const {owner,photos,campaign,...base}=row;
 return {...base,location:row.draft.location||{province:owner.province,city:owner.city,district:owner.district,address:owner.address,landline:owner.landline},photos:photos.map(p=>({id:p.id,kind:p.kind,url:`/showrooms/photos/${p.id}`+(owned?`?token=${p.readToken}`:'')})),...(owned?{account:owner,campaign}:{} )};
}
module.exports={provinces,accountSchema,draftSchema,validateSubmission,publicWhere,include,showroomDto};
