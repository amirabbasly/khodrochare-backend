require('dotenv').config({quiet:true});
const{PrismaClient}=require('@prisma/client');const Redis=require('ioredis');
const config=require('../config');const{createNetwork}=require('./network');
const prisma=new PrismaClient(),redis=new Redis(config.REDIS_URL,{maxRetriesPerRequest:null});
const network=createNetwork(redis),log=(event,fields={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...fields}));
const torob=require('./torob/worker').startTorob({prisma,redis,network,config,log});
const sms=require('./torob/sms').createSms({prisma,redis,network,config});
let busy=false,closing=false;
async function schedule(){if(busy||closing)return;busy=true;try{await torob.schedule();await sms();await redis.set('market:worker-heartbeat',new Date().toISOString(),'EX',180);}catch(error){log('market_scheduler_error',{code:error.code||error.name,message:error.message});}finally{busy=false;}}
const timer=setInterval(()=>void schedule(),10000);
async function stop(){if(closing)return;closing=true;clearInterval(timer);await torob.close();await prisma.$disconnect();await redis.quit();}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());redis.on('error',e=>log('market_redis_error',{message:e.message}));
prisma.$connect().then(()=>schedule()).catch(e=>{log('market_start_failed',{message:e.message});process.exitCode=1;void stop();});
