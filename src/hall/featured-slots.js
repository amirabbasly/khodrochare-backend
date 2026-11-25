const {HttpError}=require('../domain');
const HOURS=6;
async function reserveFeatured(tx,listingId,orderId,minutes=HOURS*60){
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('hall-featured-slots'))::text AS locked`;
 const now=new Date();
 const own=await tx.featuredSlot.findFirst({where:{listingId}});
 const slot=own||await tx.featuredSlot.findFirst({where:{OR:[{reservedUntil:null},{reservedUntil:{lte:now}}]},orderBy:{id:'asc'}});
 if(!slot){const next=await tx.featuredSlot.findFirst({orderBy:{reservedUntil:'asc'}});throw new HttpError(409,`ظرفیت شش آگهی ویژه تکمیل است؛ زمان بعدی: ${next?.reservedUntil?.toISOString()||'پس از آزادشدن جایگاه'}`);}
 return tx.featuredSlot.update({where:{id:slot.id},data:{listingId,orderId,reservedUntil:new Date(now.getTime()+minutes*60000)}});
}
async function featuredAvailability(db){
 const rows=await db.featuredSlot.findMany({where:{reservedUntil:{gt:new Date()}},orderBy:{reservedUntil:'asc'}});
 return {available:6-rows.length,nextAvailableAt:rows.length===6?rows[0].reservedUntil:null,durationHours:HOURS};
}
module.exports={reserveFeatured,featuredAvailability,HOURS};
