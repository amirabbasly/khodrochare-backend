const dns = require('node:dns/promises');
const https = require('node:https');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const { safeUrl } = require('./domain');
const { hash, HttpError } = require('../domain');
function publicIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0||(b===88&&c===99))) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0&&c===113));
  }
  if (net.isIP(ip) === 6) {const[a,b]=ip.split(':').map(v=>parseInt(v||'0',16));return a>=0x2000&&a<=0x3fff&&a!==0x2002&&!(a===0x2001&&[0xdb8,0,0x10,0x20,2].includes(b));}
  return false;
}
async function destination(url, hosts, lookup = dns.lookup) {
  const u = new URL(safeUrl(url));
  if (!hosts.includes(u.hostname)) throw new HttpError(400, 'Crawler host not allowlisted');
  const addresses = await lookup(u.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !publicIp(a.address))) throw new HttpError(400, 'Crawler destination is not public');
  return { url: u, ip: addresses.find(a => a.family===4) || addresses[0] };
}
function robotsAllowed(text, path, agent = 'khodrocharemarketbot') {
  try{path=decodeURI(path);}catch{throw new Error('INVALID_ROBOTS_PATH');}
  const groups = []; let group = { agents: [], rules: [], delay: 0 }, rulesStarted = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0,colon).toLowerCase(), value = line.slice(colon+1).trim();
    if (key === 'user-agent') { if (rulesStarted) { groups.push(group); group = { agents: [], rules: [], delay: 0 }; rulesStarted=false; } group.agents.push(value.toLowerCase()); }
    else if (['allow','disallow'].includes(key)) { rulesStarted=true; if (value) group.rules.push({ allow: key==='allow', value }); }
    else if (key==='crawl-delay' && /^\d+(\.\d+)?$/.test(value)) { rulesStarted=true; group.delay=Math.ceil(Number(value)*1000); }
  }
  groups.push(group);
  const scores=groups.map(g=>({g,score:Math.max(0,...g.agents.filter(a=>a!=='*'&&agent.includes(a)).map(a=>a.length))}));
  const best=Math.max(0,...scores.map(s=>s.score));
  const applicable=best?scores.filter(s=>s.score===best).map(s=>s.g):groups.filter(g=>g.agents.includes('*'));
  const rules = applicable.flatMap(g => g.rules).filter(r => {
    const regex = r.value.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    return new RegExp('^'+regex).test(path);
  }).sort((a,b) => b.value.length-a.value.length || Number(b.allow)-Number(a.allow));
  return { allowed: !rules.length || rules[0].allow, delayMs: Math.max(0,...applicable.map(g=>g.delay)) };
}
function createNetwork(redis,transport={}) {
  async function rate(source, extraDelay = 0, signal) {
    if(await redis.pttl(`market:backoff:${source.id}`)>0)throw new Error('SOURCE_BACKOFF_ACTIVE');
    const key = `market:rate:${source.id}`;
    const ms = Math.max(source.minDelayMs, extraDelay);
    if (ms > 60000) throw new Error('ROBOTS_DELAY_EXCEEDS_CONFIG');
    for (;;) {
      if(signal?.aborted)throw new Error('CRAWL_CANCELLED');
      const wait = await redis.eval("local ttl=redis.call('PTTL',KEYS[1]); if ttl>0 then return ttl end; redis.call('PSETEX',KEYS[1],ARGV[1],'1'); return 0",1,key,ms);
      if (!wait) return;
      await delay(Math.min(ms,wait)+10,undefined,{signal});
    }
  }
  async function get(url, source, { headers = {}, redirects = 0, delayMs = 0, method = 'GET', body } = {}) {
    const target = await destination(url, source.allowedHosts,transport.lookup||dns.lookup);
    await rate(source, delayMs);
    return new Promise((resolve,reject) => {
      const request = (transport.request||https.request)(target.url, { method, family:target.ip.family,autoSelectFamily:false,headers: { 'User-Agent': 'KhodrochareMarketBot/1.0', 'Accept-Encoding': 'identity', ...headers }, lookup: (_host,_options,cb) => cb(null,target.ip.address,target.ip.family), timeout: 12000 }, response => {
        if ([301,302,303,307,308].includes(response.statusCode)) {
          response.resume();
          if(method!=='GET')return reject(new Error('POST_REDIRECT_DENIED'));
          if (redirects>=3 || !response.headers.location) return reject(new Error('REDIRECT_LIMIT'));
          const next = new URL(response.headers.location,target.url);
          if (next.origin!==target.url.origin) return reject(new Error('CROSS_ORIGIN_REDIRECT_DENIED'));
          get(next.href,source,{headers,redirects:redirects+1,delayMs,method,body}).then(resolve,reject); return;
        }
        if([401,403,429,490].includes(response.statusCode)){
          response.resume();
          const retry=response.headers['retry-after'];
          const seconds=Number(retry)||Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000))||0;
          const wait=Math.min(86400,Math.max(seconds,response.statusCode===490?21600:response.statusCode===429?900:3600));
          const code=response.statusCode===490?'SOURCE_CHALLENGE':response.statusCode===429?'SOURCE_RATE_LIMITED':'SOURCE_ACCESS_DENIED';
          const error=Object.assign(new Error(code),{httpStatus:response.statusCode,url:target.url.origin+target.url.pathname,stage:'http'});
          redis.set(`market:backoff:${source.id}`,'1','EX',wait).then(()=>reject(error),reject);return;
        }
        if (response.statusCode===404) { response.resume(); resolve({status:404,text:'',headers:response.headers}); return; }
        if (!(response.statusCode===200 || (method==='POST'&&[201,202].includes(response.statusCode)))) { response.resume(); const e=new Error(`HTTP_${response.statusCode}`); const retry=response.headers['retry-after']; e.retryAfter=Math.min(3600,Number(retry)||Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000))||0); if(e.retryAfter>0)redis.set(`market:backoff:${source.id}`,'1','EX',e.retryAfter).then(()=>reject(e),reject);else reject(e); return; }
        if (response.headers['content-encoding'] && response.headers['content-encoding']!=='identity') { response.destroy(); reject(new Error('UNSUPPORTED_ENCODING')); return; }
        let length=0; const chunks=[];
        response.on('data',chunk=>{length+=chunk.length;if(length>2097152){response.destroy();reject(new Error('RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});
        response.on('error',reject); response.on('end',()=>resolve({status:200,text:Buffer.concat(chunks).toString('utf8'),headers:response.headers}));
      });
      request.on('timeout',()=>request.destroy(new Error('FETCH_TIMEOUT'))); request.on('error',reject); request.end(body);
    });
  }
  async function checkRobots(url,source) {
    const u = new URL(safeUrl(url)); const key=`market:robots:${source.id}:${hash(u.origin)}`;
    let robots=await redis.get(key);
    if (robots==null) { const response=await get(new URL('/robots.txt',u).href,source); robots=response.text; await redis.set(key,robots,'EX',3600); }
    const policy=robotsAllowed(robots,u.pathname+u.search);
    if (!policy.allowed) throw new Error('ROBOTS_DISALLOWED');
    return policy;
  }
  async function html(url,source){const policy=await checkRobots(url,source);return get(url,source,{delayMs:policy.delayMs});}
  return { get, html, checkRobots, rate };
}
module.exports = { publicIp, destination, robotsAllowed, createNetwork };
