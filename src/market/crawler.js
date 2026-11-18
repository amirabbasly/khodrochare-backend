function createCrawler({prisma,service,network,adapters,isClosing=()=>false,log=()=>{}}){
async function run(job){
  const run=await prisma.marketCrawlRun.findUnique({where:{id:job.data.runId},include:{source:true}});
  if(!run||['CANCELLED','SUCCEEDED'].includes(run.status))return;
  const source=run.source;
  if(!source.active||!source.licenseUrl||!source.permissionExpiresAt||source.permissionExpiresAt<=new Date())throw new Error('SOURCE_PERMISSION_REQUIRED');
  const adapter=adapters[source.adapter];if(!adapter)throw new Error('UNKNOWN_ADAPTER');
  const secret=source.secretEnv?process.env[source.secretEnv]:undefined;
  if(source.secretEnv&&!secret)throw new Error('SOURCE_SECRET_MISSING');
  if(source.secretEnv&&process.env[source.secretEnv+'_HOST']!==new URL(source.baseUrl).hostname)throw new Error('SOURCE_SECRET_HOST_NOT_BOUND');
  await prisma.marketCrawlRun.update({where:{id:run.id},data:{status:'RUNNING',startedAt:run.startedAt||new Date(),heartbeatAt:new Date()}});
  let cursor=run.cursor,pages=run.pages;
  while(pages<source.maxPages){
    if(isClosing())throw new Error('WORKER_STOPPING');
    const current=await prisma.marketSource.findUnique({where:{id:source.id}}),state=await prisma.marketCrawlRun.findUnique({where:{id:run.id}});
    if(state.status==='CANCELLED')return;
    if(!current.active||!current.permissionExpiresAt||current.permissionExpiresAt<=new Date()||current.configVersion!==source.configVersion){
      await prisma.marketCrawlRun.update({where:{id:run.id},data:{status:'CANCELLED',finishedAt:new Date()}});return;
    }
    const previousCursor=cursor;
    const page=await adapter.page({source,cursor,network,secret});
    if(!Array.isArray(page.items)||page.items.length>500)throw new Error('INVALID_ADAPTER_RESULT');
    const affected=new Set();let errors=0;
    for(const item of page.items){
      try{for(const id of await service.ingest(source,run.id,item))affected.add(id);}
      catch(error){errors++;if(typeof item?.externalId==='string'&&item.externalId.length<=250)await prisma.marketOffer.updateMany({where:{listing:{sourceId:source.id,externalId:item.externalId}},data:{suspicious:true}});const code=error.name==='ZodError'?'INVALID_LISTING':'INGEST_REJECTED';await prisma.marketCrawlLog.create({data:{runId:run.id,level:'ERROR',code,message:error.name==='ZodError'?error.issues.map(i=>i.path.join('.')).join(',').slice(0,1000):String(error.message).slice(0,1000)}});}
    }
    cursor=page.next;pages++;
    if(cursor===previousCursor&&cursor)throw new Error('CURSOR_DID_NOT_ADVANCE');
    await prisma.marketCrawlRun.update({where:{id:run.id},data:{cursor,pages,processed:{increment:page.items.length-errors},errors:{increment:errors},heartbeatAt:new Date()}});
    for(const id of affected)await service.refreshProduct(id);
    if(!cursor)break;
  }
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "MarketSource" WHERE id=${source.id} FOR UPDATE`;
    const current=await tx.marketSource.findUnique({where:{id:source.id}}),state=await tx.marketCrawlRun.findUnique({where:{id:run.id}});
    if(state.status==='CANCELLED')return;
    if(!current.active||current.configVersion!==source.configVersion){await tx.marketCrawlRun.update({where:{id:run.id},data:{status:'CANCELLED',finishedAt:new Date()}});return;}
    await tx.marketCrawlRun.update({where:{id:run.id},data:{status:'SUCCEEDED',finishedAt:new Date()}});
    await tx.marketSource.update({where:{id:source.id},data:{lastCheckedAt:new Date(),nextCursor:cursor}});
  });
  log('crawl_completed',{runId:run.id,pages});
}
return run;
}
module.exports={createCrawler};
