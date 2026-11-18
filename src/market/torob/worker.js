const {Queue,Worker}=require('bullmq');
const {collectLinks,source}=require('./browser');
const {parseProduct}=require('./parser');
const {createTorobService}=require('./service');
const {createMarketService}=require('../service');
function startTorob({prisma,redis,network,config,log}){
  const service=createTorobService(prisma,config),alerts=createMarketService(prisma);
  const scans=new Queue('torob-browse-v2',{connection:redis}),products=new Queue('torob-product-v2',{connection:redis});
  let closing=false,bootstrapped=false;
  async function failed(seed,error){
    const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'TOROB_CRAWL_FAILED';
    const terminal=['SOURCE_CHALLENGE','SOURCE_ACCESS_DENIED','ROBOTS_DISALLOWED','SOURCE_BACKOFF_ACTIVE','SOURCE_RATE_LIMITED'].includes(code);
    const ttl=await redis.pttl('market:backoff:torob-native');
    const wait=Math.max(terminal?21600000:900000,ttl);
    if(terminal)await redis.set('market:backoff:torob-native','1','PX',wait);
    await prisma.marketDiscoveryQuery.updateMany({where:{id:seed.id,active:true,generation:seed.generation},data:{status:terminal?'BLOCKED':'FAILED',lastError:code,nextRunAt:new Date(Date.now()+wait)}});
    log('torob_failure',{seedId:seed.id,code});return code;
  }
  const scanWorker=new Worker('torob-browse-v2',async job=>{
    const current=await prisma.marketDiscoveryQuery.findUnique({where:{id:job.data.id}});
    if(!current?.active||!current.seedUrl||current.nextRunAt.toISOString()!==job.data.scheduledAt)return;
    const token=String(job.id),lease='market:torob:browser-lease';if(!await redis.set(lease,token,'EX',120,'NX')){await prisma.marketDiscoveryQuery.update({where:{id:current.id},data:{nextRunAt:new Date(Date.now()+30000)}});return;}
    let seed;
    try{
      seed=await prisma.marketDiscoveryQuery.update({where:{id:current.id},data:{status:'RUNNING',generation:{increment:1},lastError:null,limitReached:false}});
      const result=await collectLinks({seed,config,network,
        shouldStop:async()=>{
          if(closing)return true;
          const renewed=await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],120000) end; return 0",1,lease,token);if(!renewed)return true;
          const fresh=await prisma.marketDiscoveryQuery.findUnique({where:{id:seed.id}});
          if(!fresh?.active||fresh.generation!==seed.generation)return true;
          await prisma.marketDiscoveryQuery.updateMany({where:{id:seed.id,generation:seed.generation,active:true},data:{lastError:null}});return false;
        },
        onLinks:async links=>{
          await prisma.$transaction(async tx=>{for(const link of links)await tx.torobCrawlLink.upsert({where:{queryId_externalId:{queryId:seed.id,externalId:link.externalId}},create:{queryId:seed.id,...link,generation:seed.generation},update:{url:link.url,generation:seed.generation,status:'PENDING',attempts:0,lastError:null}});},{timeout:30000});
        }});
      await prisma.marketDiscoveryQuery.updateMany({where:{id:seed.id,active:true,generation:seed.generation},data:{status:'FETCHING',limitReached:result.limitReached,nextRunAt:new Date(Date.now()+seed.intervalMinutes*60000)}});
      log('torob_links_collected',{seedId:seed.id,...result});
    }catch(error){if(seed)await failed(seed,error);throw new Error(/^[A-Z0-9_]+$/.test(error.message)?error.message:'TOROB_SCAN_FAILED');}
    finally{await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",1,lease,token);}
  },{connection:redis,concurrency:1});
  const productWorker=new Worker('torob-product-v2',async job=>{
    const link=await prisma.torobCrawlLink.findUnique({where:{id:job.data.id},include:{query:true}});
    if(!link||!link.query.active||link.query.status!=='FETCHING'||link.generation!==job.data.generation||link.query.generation!==link.generation||link.status!=='PENDING')return;
    const claimed=await prisma.torobCrawlLink.updateMany({where:{id:link.id,status:'PENDING',generation:link.generation},data:{status:'FETCHING',attempts:{increment:1}}});if(!claimed.count)return;
    try{
      const response=await network.html(link.url,source);if(response.status!==200)throw new Error('TOROB_PRODUCT_UNAVAILABLE');
      const parsed=parseProduct(response.text,link.url);
      const fresh=await prisma.marketDiscoveryQuery.findUnique({where:{id:link.queryId}});if(!fresh?.active||fresh.generation!==link.generation)return;
      const result=await service.ingest(fresh,parsed,`${link.queryId}-${link.generation}`);
      await prisma.torobCrawlLink.update({where:{id:link.id},data:{status:'FETCHED',lastError:null,fetchedAt:new Date()}});
      await alerts.evaluateAlerts(result.productId,result.priceToman);
    }catch(error){
      const terminal=['SOURCE_CHALLENGE','SOURCE_ACCESS_DENIED','ROBOTS_DISALLOWED','SOURCE_BACKOFF_ACTIVE','SOURCE_RATE_LIMITED'].includes(error.message);
      const code=terminal?await failed(link.query,error):/^[A-Z0-9_]+$/.test(error.message)?error.message:'TOROB_PRODUCT_FAILED';
      await prisma.torobCrawlLink.update({where:{id:link.id},data:{status:'FAILED',lastError:code}});throw new Error(code);
    }
  },{connection:redis,concurrency:2});
  for(const worker of[scanWorker,productWorker]){worker.on('error',e=>log('torob_queue_error',{code:e.code||e.name}));worker.on('failed',(job,e)=>log('torob_job_failed',{jobId:job?.id,code:e.message}));}
  async function schedule(){
    if(!bootstrapped){await service.bootstrap();bootstrapped=true;}
    await prisma.marketDiscoveryQuery.updateMany({where:{active:true,status:'RUNNING',updatedAt:{lt:new Date(Date.now()-180000)}},data:{status:'QUEUED',nextRunAt:new Date()}});
    await prisma.torobCrawlLink.updateMany({where:{status:'FETCHING',updatedAt:{lt:new Date(Date.now()-180000)}},data:{status:'PENDING'}});
    if(await redis.pttl('market:backoff:torob-native')>0)return;
    const interrupted=await prisma.marketDiscoveryQuery.findMany({where:{active:true,status:'BLOCKED',nextRunAt:{lte:new Date()}},take:20});
    for(const seed of interrupted){
      const remaining=await prisma.torobCrawlLink.count({where:{queryId:seed.id,generation:seed.generation,status:{in:['PENDING','FAILED']}}});
      if(remaining){
        await prisma.torobCrawlLink.updateMany({where:{queryId:seed.id,generation:seed.generation,status:'FAILED',lastError:{in:['SOURCE_CHALLENGE','SOURCE_ACCESS_DENIED','SOURCE_BACKOFF_ACTIVE','SOURCE_RATE_LIMITED','ROBOTS_DISALLOWED']}},data:{status:'PENDING'}});
        await prisma.marketDiscoveryQuery.update({where:{id:seed.id},data:{status:'FETCHING',limitReached:true,nextRunAt:new Date(Date.now()+seed.intervalMinutes*60000)}});
      }
    }
    const due=await prisma.marketDiscoveryQuery.findMany({where:{active:true,seedUrl:{not:null},status:{notIn:['RUNNING','FETCHING']},nextRunAt:{lte:new Date()}},take:20,orderBy:{nextRunAt:'asc'}});
    for(const seed of due)await scans.add('browse',{id:seed.id,scheduledAt:seed.nextRunAt.toISOString()},{jobId:seed.id+'-'+seed.nextRunAt.getTime(),attempts:1,removeOnComplete:{age:86400},removeOnFail:{age:604800}});
    const fetching=await prisma.marketDiscoveryQuery.findMany({where:{active:true,status:'FETCHING'},take:100});
    for(const seed of fetching){
      const pending=await prisma.torobCrawlLink.findMany({where:{queryId:seed.id,generation:seed.generation,status:'PENDING'},take:100});
      for(const link of pending)await products.add('product',{id:link.id,generation:link.generation},{jobId:link.id+'-'+link.generation+'-'+link.attempts,attempts:1,removeOnComplete:{age:86400},removeOnFail:{age:604800}});
      const remaining=await prisma.torobCrawlLink.count({where:{queryId:seed.id,generation:seed.generation,status:{in:['PENDING','FETCHING']}}});
      if(!remaining){const errors=await prisma.torobCrawlLink.count({where:{queryId:seed.id,generation:seed.generation,status:'FAILED'}});await prisma.marketDiscoveryQuery.update({where:{id:seed.id},data:{status:seed.limitReached||errors?'PARTIAL':'READY',fetchedAt:new Date(),lastError:errors?'SOME_PRODUCTS_FAILED':seed.limitReached?'SCAN_LIMIT_REACHED':null}});}
    }
    await prisma.marketReferenceSnapshot.deleteMany({where:{checkedAt:{lt:new Date(Date.now()-config.MARKET_RAW_RETENTION_DAYS*86400000)}}});
  }
  return{schedule,close:async()=>{closing=true;await scanWorker.close();await productWorker.close();await scans.close();await products.close();}};
}
module.exports={startTorob};
