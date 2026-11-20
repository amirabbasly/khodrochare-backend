// Synthetic CPU benchmark only: excludes real database/network latency.
const {performance}=require('node:perf_hooks');
const {createCatalog}=require('../src/catalog');
const {normalize}=require('../src/pricing');
const models=Array.from({length:3000},(_,i)=>({id:String(i),normalizedName:`vehicle ${i}`,aliases:[`car ${i}`,`auto ${i}`,`model ${i}`]}));
function previous(name){const text=normalize(name);const matches=models.flatMap(model=>[model.normalizedName,...model.aliases].map(alias=>({model,alias}))).filter(({alias})=>text.startsWith(alias)&&!(/\d$/.test(alias)&&/^\d/.test(text.slice(alias.length)))).sort((a,b)=>b.alias.length-a.alias.length);return matches[0]?.model||null;}
const current=createCatalog({vehicleModel:{findMany:async()=>models}});
(async()=>{const before=[],after=[];for(let sample=0;sample<9;sample++){for(const [target,run] of [[before,previous],[after,name=>current.resolve(name)]]){const start=performance.now();for(let i=0;i<300;i++)await run(`vehicle ${i%3000} premium`);target.push(performance.now()-start);}}const median=a=>[...a].sort((a,b)=>a-b)[4];console.log(JSON.stringify({models:3000,resolvesPerSample:300,beforeMs:before,afterMs:after,beforeMedianMs:median(before),afterMedianMs:median(after),reductionPercent:100*(1-median(after)/median(before))},null,2));})();
