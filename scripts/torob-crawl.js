require('dotenv').config({quiet:true});
const fs=require('node:fs/promises');const{parseArgs}=require('node:util');
const{createNetwork}=require('../src/market/network');
const{collectLinks,source}=require('../src/market/torob/browser');
const{parseProduct}=require('../src/market/torob/parser');
const{torobUrl}=require('../src/market/torob/urls');
function memoryRedis(){const values=new Map();return{get:async key=>{const v=values.get(key);return v&&v.until>Date.now()?v.value:null;},pttl:async key=>Math.max(-2,(values.get(key)?.until||0)-Date.now()),set:async(key,value,unit,ttl)=>{values.set(key,{value,until:Date.now()+(unit==='EX'?ttl*1000:ttl)});return'OK';},eval:async(_script,_n,key,ttl)=>{const wait=(values.get(key)?.until||0)-Date.now();if(wait>0)return wait;values.set(key,{value:'1',until:Date.now()+Number(ttl)});return 0;}};}
async function main(){
  const{values,positionals}=parseArgs({allowPositionals:true,options:{'max-scrolls':{type:'string',default:'1000'},'max-products':{type:'string',default:'10000'},output:{type:'string'},standalone:{type:'boolean',default:false}}});
  const[mode,url]=positionals;if(!['collect','product'].includes(mode)||!url)throw new Error('Usage: node scripts/torob-crawl.js collect|product URL [--max-scrolls=1000 --max-products=10000 --output=file.json --standalone]');
  const redis=values.standalone||!process.env.REDIS_URL?memoryRedis():new(require('ioredis'))(process.env.REDIS_URL);
  try{
    const network=createNetwork(redis);let result;
    if(mode==='product'){const target=torobUrl(url,'product');const response=await network.html(target.url,source);if(response.status!==200)throw new Error('TOROB_PRODUCT_UNAVAILABLE');result=parseProduct(response.text,target.url);}
    else{
      const maxScrolls=Number(values['max-scrolls']),maxProducts=Number(values['max-products']);if(!Number.isInteger(maxScrolls)||maxScrolls<1||maxScrolls>10000||!Number.isInteger(maxProducts)||maxProducts<1||maxProducts>100000)throw new Error('Invalid scan limits');
      const links=[];const summary=await collectLinks({seed:{seedUrl:url,maxScrolls,maxProducts,scrollWaitMs:2000,idleRounds:8},config:{TOROB_CHROME_PATH:process.env.TOROB_CHROME_PATH,TOROB_BROWSER_NO_SANDBOX:process.env.TOROB_BROWSER_NO_SANDBOX==='true',TOROB_SCAN_TIMEOUT_MS:1800000},network,onLinks:async batch=>links.push(...batch)});result={...summary,links};
    }
    const output=JSON.stringify(result,null,2);if(values.output)await fs.writeFile(values.output,output,{encoding:'utf8',flag:'wx'});else console.log(output);
  }finally{if(redis.quit)await redis.quit();}
}
main().catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
