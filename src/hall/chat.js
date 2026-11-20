const {z}=require('zod');
const {HttpError}=require('../domain');
const uuid=z.string().uuid();
const memberWhere=user=>({OR:[{buyerId:user.id},{sellerId:user.id}]});
async function member(prisma,user,id){
  const row=await prisma.hallConversation.findFirst({where:{id:uuid.parse(id),...memberWhere(user)},include:{listing:{select:{status:true,make:true,model:true}}}});
  if(!row)throw new HttpError(404,'گفتگو پیدا نشد.');return row;
}
function publish(io,row,event,data){io?.to(`user:${row.buyerId}`).to(`user:${row.sellerId}`).emit(event,data);}
function registerChat({app,prisma,auth,limit}){
  const root='/api/v1/hall/conversations';
  app.post(root,auth,limit('hall-chat-start',20,60),async(req,res)=>{
    const {listingId}=z.object({listingId:uuid}).strict().parse(req.body);
    const row=await prisma.hallListing.findFirst({where:{id:listingId,status:'PUBLISHED'}});
    if(!row||row.ownerId===req.user.id)throw new HttpError(400,'برای این آگهی نمی‌توانید گفتگوی جدید باز کنید.');
    res.json(await prisma.hallConversation.upsert({where:{listingId_buyerId:{listingId,buyerId:req.user.id}},create:{listingId,buyerId:req.user.id,sellerId:row.ownerId},update:{},include:{listing:{select:{make:true,model:true,status:true}}}}));
  });
  app.get(root,auth,async(req,res)=>{
    const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const rows=await prisma.hallConversation.findMany({where:memberWhere(req.user),orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:(page-1)*40,take:40,include:{listing:{select:{make:true,model:true,status:true}},buyer:{select:{fullName:true}},seller:{select:{fullName:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1}}});
    const counts=rows.length?await prisma.hallMessage.groupBy({by:['conversationId'],where:{senderId:{not:req.user.id},OR:rows.map(row=>({conversationId:row.id,createdAt:{gt:row.buyerId===req.user.id?row.buyerReadAt:row.sellerReadAt}}))},_count:{_all:true}}):[];
    const unread=new Map(counts.map(r=>[r.conversationId,r._count._all]));
    const items=rows.map(row=>({...row,unread:unread.get(row.id)||0}));
    res.set('Cache-Control','no-store').json({items,page});
  });
  app.get(root+'/:id/messages',auth,async(req,res)=>{
    const row=await member(prisma,req.user,req.params.id),before=req.query.before?uuid.parse(req.query.before):null;
    if(before&&!await prisma.hallMessage.findFirst({where:{id:before,conversationId:row.id}}))throw new HttpError(400,'نشانگر پیام معتبر نیست.');
    const items=await prisma.hallMessage.findMany({where:{conversationId:row.id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,...(before?{cursor:{id:before},skip:1}:{})});
    res.set('Cache-Control','no-store').json({items:items.reverse(),hasMore:items.length===50,conversation:row});
  });
}
function attachChat(socket,run,prisma,redis,io){
  socket.on('hall:send',run(async(user,payload)=>{
    const input=z.object({conversationId:uuid,clientId:uuid,body:z.string().trim().min(1).max(2000)}).strict().parse(payload);
    const row=await member(prisma,user,input.conversationId);
    if(row.listing.status!=='PUBLISHED')throw new HttpError(409,'این آگهی دیگر فعال نیست.');
    const count=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`hall:chat:send:${user.id}`);
    if(Number(count)>60)throw new HttpError(429,'تعداد پیام‌ها زیاد است؛ کمی صبر کنید.');
    const message=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "HallListing" WHERE id=${row.listingId} FOR UPDATE`;
      const listing=await tx.hallListing.findUnique({where:{id:row.listingId},select:{status:true}});
      if(listing?.status!=='PUBLISHED')throw new HttpError(409,'این آگهی دیگر فعال نیست.');
      const message=await tx.hallMessage.upsert({where:{conversationId_senderId_clientId:{conversationId:row.id,senderId:user.id,clientId:input.clientId}},create:{...input,senderId:user.id},update:{}});
      await tx.hallConversation.updateMany({where:{id:row.id,updatedAt:{lt:message.createdAt}},data:{updatedAt:message.createdAt}});return message;
    });
    publish(io,row,'hall:message',message);return message;
  }));
  socket.on('hall:read',run(async(user,payload)=>{
    const {conversationId,messageId}=z.object({conversationId:uuid,messageId:uuid}).strict().parse(payload),row=await member(prisma,user,conversationId);
    const message=await prisma.hallMessage.findFirst({where:{id:messageId,conversationId:row.id},select:{createdAt:true}});
    if(!message)throw new HttpError(404,'پیام پیدا نشد.');
    const field=row.buyerId===user.id?'buyerReadAt':'sellerReadAt',at=message.createdAt;
    await prisma.hallConversation.updateMany({where:{id:row.id,[field]:{lt:at}},data:{[field]:at}});
    publish(io,row,'hall:read',{conversationId:row.id,userId:user.id,at});return {at};
  }));
  let lastTyping=0;
  socket.on('hall:typing',run(async(user,payload)=>{
    if(Date.now()-lastTyping<1500)return {};lastTyping=Date.now();
    const {conversationId}=z.object({conversationId:uuid}).strict().parse(payload),row=await member(prisma,user,conversationId);
    io.to(`user:${row.buyerId===user.id?row.sellerId:row.buyerId}`).emit('hall:typing',{conversationId,userId:user.id});return {};
  }));
}
module.exports={registerChat,attachChat,member};
