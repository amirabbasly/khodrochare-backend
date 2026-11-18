function createSms({prisma,redis,network,config}){
async function sms(){
  if(!config.MARKET_SMS_URL||!config.MARKET_SMS_TOKEN)return;
  const pending=await prisma.marketNotification.findMany({where:{smsState:{in:['PENDING','FAILED']},smsAttempts:{lt:5},alert:{sms:true,active:true}},include:{alert:{include:{user:{select:{phone:true}}}}},take:20,orderBy:{createdAt:'asc'}});
  for(const n of pending){
    const locked=await redis.set(`market:sms:${n.id}`,'1','EX',120,'NX');if(!locked)continue;
    try{
      // Provider must honor this key; timeout retries must not send a second SMS.
      const source={id:'sms-provider',baseUrl:config.MARKET_SMS_URL,allowedHosts:[new URL(config.MARKET_SMS_URL).hostname],minDelayMs:1000};
      const response=await network.get(config.MARKET_SMS_URL,source,{method:'POST',body:JSON.stringify({to:n.alert.user.phone,text:n.body,idempotencyKey:n.id}),headers:{Authorization:`Bearer ${config.MARKET_SMS_TOKEN}`,'Content-Type':'application/json','Idempotency-Key':n.id}});
      if(JSON.parse(response.text).accepted!==true)throw new Error('SMS_NOT_ACCEPTED');
      await prisma.marketNotification.update({where:{id:n.id},data:{smsState:'SENT',smsAttempts:{increment:1}}});
    }catch{await prisma.marketNotification.update({where:{id:n.id},data:{smsState:'FAILED',smsAttempts:{increment:1}}});}
    finally{await redis.del(`market:sms:${n.id}`);}
  }
}

return sms;
}
module.exports={createSms};
