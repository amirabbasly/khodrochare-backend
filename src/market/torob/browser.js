const {setTimeout:delay}=require('node:timers/promises');
const {existsSync}=require('node:fs');
const {destination}=require('../network');
const {torobUrl}=require('./urls');
const source={id:'torob-native',allowedHosts:['torob.com','api.torob.com','assets.torob.com','image.torob.com'],minDelayMs:5000};
function executablePath(config){
  const candidates=[config.TOROB_CHROME_PATH,process.env.CHROME_PATH,process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'];
  const found=candidates.find(p=>p&&existsSync(p));if(!found)throw new Error('TOROB_CHROME_NOT_FOUND');return found;
}
function challenge(html){return /widget\.arcaptcha|<title[^>]*>[^<]*(ربات|captcha)|class=["'][^"']*captcha/i.test(html.slice(0,20000));}
async function collectLinks({seed,config,network,onLinks,shouldStop=async()=>false,launch}){
  const target=torobUrl(seed.seedUrl,'browse');
  await network.checkRobots(target.url,source);
  const browser=await(launch||require('puppeteer-core').launch)({executablePath:executablePath(config),headless:true,defaultViewport:{width:1440,height:900},args:config.TOROB_BROWSER_NO_SANDBOX?['--no-sandbox','--disable-setuid-sandbox']:[]});
  const controller=new AbortController(),links=new Map();let scrolls=0,idle=0,complete=false,policyError=null;
  try{
    const page=await browser.newPage();await page.setUserAgent((await browser.userAgent())+' KhodrochareMarketBot/2.0');
    page.on('response',response=>{try{const url=new URL(response.url()),status=response.status(),dataPath=url.hostname==='torob.com'&&url.pathname.startsWith('/browse/'+target.id+'/')||url.hostname==='api.torob.com'&&/^\/v4\/base-product\/(search|details)/.test(url.pathname);if(['torob.com','api.torob.com'].includes(url.hostname)&&([429,490].includes(status)||dataPath&&[401,403].includes(status)))policyError=status===490?'SOURCE_CHALLENGE':status===429?'SOURCE_RATE_LIMITED':'SOURCE_ACCESS_DENIED';}catch{/* Ignore non-URL browser internals. */}});
    await page.setRequestInterception(true);
    page.on('request',request=>{void(async()=>{
      try{
        const url=new URL(request.url());
        if(url.protocol!=='https:'||!source.allowedHosts.includes(url.hostname)||['image','font','media','websocket'].includes(request.resourceType()))return await request.abort();
        await destination(url.href,source.allowedHosts);
        if(request.isNavigationRequest()||['xhr','fetch'].includes(request.resourceType())){
          const policy=await network.checkRobots(url.href,source);await network.rate(source,policy.delayMs,controller.signal);
        }
        if(!request.isInterceptResolutionHandled())await request.continue();
      }catch(error){if(error.message!=='ROBOTS_DISALLOWED'||request.isNavigationRequest())policyError=error.message;if(!request.isInterceptResolutionHandled())await request.abort();}
    })().catch(()=>{});});
    const response=await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:60000});
    if([401,403,429,490].includes(response?.status()))throw new Error(response.status()===490?'SOURCE_CHALLENGE':'SOURCE_ACCESS_DENIED');
    if(!response?.ok())throw new Error('TOROB_CATEGORY_UNAVAILABLE');
    if(challenge(await page.content()))throw new Error('SOURCE_CHALLENGE');
    try{await page.waitForSelector('[data-testid="product-card"], a[href^="/p/"]',{timeout:30000});}catch{if(challenge(await page.content()))throw new Error('SOURCE_CHALLENGE');throw new Error(policyError||'TOROB_PRODUCT_CARDS_NOT_FOUND');}
    const started=Date.now();
    for(;;){
      if(await shouldStop())throw new Error('TOROB_SCAN_CANCELLED');
      if(Date.now()-started>config.TOROB_SCAN_TIMEOUT_MS)break;
      if(policyError)throw new Error(policyError);
      if(challenge(await page.content()))throw new Error('SOURCE_CHALLENGE');
      const found=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href*="/p/"]')).map(a=>a.href));
      const added=[];
      for(const value of found){try{const item=torobUrl(value,'product');if(!links.has(item.id)&&links.size<seed.maxProducts){links.set(item.id,item.url);added.push({externalId:item.id,url:item.url});}}catch{/* Ignore unrelated cards/links. */}}
      if(added.length)await onLinks(added);
      if(links.size>=seed.maxProducts||scrolls>=seed.maxScrolls)break;
      const before=await page.evaluate(()=>({height:document.documentElement.scrollHeight}));
      await page.evaluate(()=>window.scrollBy(0,window.innerHeight*.85));scrolls++;await delay(seed.scrollWaitMs);
      const after=await page.evaluate(()=>({y:window.scrollY,height:document.documentElement.scrollHeight,viewport:window.innerHeight}));
      idle=!added.length&&after.y+after.viewport>=after.height-10&&after.height===before.height?idle+1:0;
      if(idle>=seed.idleRounds){complete=true;break;}
    }
    return{count:links.size,scrolls,complete,limitReached:!complete};
  }finally{controller.abort();await browser.close();}
}
module.exports={collectLinks,source,challenge,executablePath};
