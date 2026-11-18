const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {torobUrl,sellerUrl}=require('../src/market/torob/urls');
const {parseProduct}=require('../src/market/torob/parser');
const {batterySpecs,ruleMatches,carMentions}=require('../src/market/torob/compatibility');
const {collectLinks}=require('../src/market/torob/browser');
const fixture=fs.readFileSync(require.resolve('./fixtures/market/torob-product.html'),'utf8');
const productUrl='https://torob.com/p/c2a29e6f-b706-4695-ba9c-13767a09e807/battery/';
const {readSettings,syncSettings}=require('../src/market/torob/env-settings');

test('pending links can resume after a skipped BullMQ job without duplicating active jobs',async()=>{
  const{enqueuePending}=require('../src/market/torob/queue');let added=0,removed=0,state='completed';
  const queue={getJob:async()=>({getState:async()=>state,remove:async()=>removed++}),add:async()=>added++};
  await enqueuePending(queue,'product',{}, {jobId:'pending'});assert.equal(removed,1);assert.equal(added,1);
  state='active';await enqueuePending(queue,'product',{}, {jobId:'pending'});assert.equal(removed,1);assert.equal(added,1);
  state='failed';await enqueuePending(queue,'product',{}, {jobId:'pending'});assert.equal(removed,2);assert.equal(added,2);
});

test('env config supports legacy URL, multiple sources, global defaults and explicit overrides',()=>{
  assert.equal(readSettings({}).sources[0].seedUrl,'https://torob.com/browse/541/');
  const result=readSettings({TOROB_MAX_PRODUCTS:30,TOROB_SOURCES_JSON:JSON.stringify([
    {name:'Battery',url:'https://torob.com/browse/541/',category:'batteries'},
    {name:'Electrical',url:'https://torob.com/browse/3298/',maxProducts:5,active:false},
  ])});
  assert.equal(result.sources.length,2);assert.equal(result.sources[0].maxProducts,30);
  assert.equal(result.sources[1].maxProducts,5);assert.equal(result.sources[1].active,false);
  assert.equal(readSettings({TOROB_ENABLED:false}).sources[0].active,false);
  assert.deepEqual(readSettings({TOROB_SOURCES_JSON:'[]'}).sources,[]);
});

test('invalid env sources and unsafe or incomplete compatibility rules fail before syncing',()=>{
  for(const value of ['not json','{}','[{"name":"Bad","url":"https://other.ir/browse/541/"}]','[{"name":"Bad","url":"https://torob.com/browse/541/","maxProducts":0}]'])assert.throws(()=>readSettings({TOROB_SOURCES_JSON:value}));
  const rule={name:'Battery rule',category:'batteries',carKeys:['car'],requirements:{capacityAh:60},evidenceUrl:'https://manufacturer.ir/spec',verified:true,checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  assert.throws(()=>readSettings({TOROB_COMPATIBILITY_RULES_JSON:JSON.stringify([rule])}),/INCOMPLETE_BATTERY/);
  assert.throws(()=>readSettings({TOROB_COMPATIBILITY_RULES_JSON:JSON.stringify([{...rule,verified:false,evidenceUrl:'http://manufacturer.ir/spec'}])}),/INVALID_EVIDENCE/);
});

test('env sync preserves unchanged cooldowns, applies edits, retires omitted sources without deleting data',async()=>{
  const calls=[];let previous;
  const tx={$queryRaw:async()=>[],marketCategory:{findUnique:async()=>({id:'category'})},marketDiscoveryQuery:{
    findUnique:async()=>previous,
    updateMany:async input=>{calls.push(['retire',input]);return{count:0};},
    upsert:async input=>{calls.push(['upsert',input]);return input.create;},
  }};
  const prisma={$transaction:fn=>fn(tx)},settings=readSettings({});
  previous={...settings.sources[0],status:'BLOCKED',generation:9,nextRunAt:new Date(Date.now()+21600000)};
  await syncSettings(prisma,settings);assert.deepEqual(calls.at(-1)[1].update,{});
  settings.sources[0].maxProducts=25;await syncSettings(prisma,settings);
  assert.equal(calls.at(-1)[1].update.generation.increment,1);assert.equal(calls.at(-1)[1].update.status,'QUEUED');
  await syncSettings(prisma,{sources:[],rules:null});
  assert.equal(calls.at(-1)[1].data.active,false);assert.equal(calls.at(-1)[1].data.status,'CANCELLED');
});

test('unknown env categories are rejected before existing source state is changed',async()=>{
  const tx={$queryRaw:async()=>[],marketCategory:{findUnique:async()=>null},marketDiscoveryQuery:{updateMany:async()=>assert.fail('must not mutate sources')}};
  await assert.rejects(syncSettings({$transaction:fn=>fn(tx)},readSettings({})),/UNKNOWN_CATEGORY/);
});
test('provided Torob HTML yields real structured prices, brand, image and individual offers in toman',()=>{
  const result=parseProduct(fixture,productUrl);assert.equal(result.name,'باتری اتمی صبا ۵۰ آمپر قالب L1 قطب چپ');assert.equal(result.brand,'صبا');assert.equal(result.minPriceToman,4100000);assert.equal(result.maxPriceToman,7565800);assert.equal(result.offers.length,6);assert.equal(result.offers[1].priceToman,4100000);assert.equal(result.offers[1].available,true);assert.equal(result.images.length,1);assert.ok(result.categories.some(c=>c.torobId==='541'));
  assert.equal(new URL(result.offers[0].url).searchParams.has('session_id'),false);
  assert.equal(result.specifications['قالب'],'L1');assert.ok(result.specifications['مناسب خودروهای'].includes('کوییک'));
});
test('Torob input rejects other markets, private endpoints, credentials and search URLs',()=>{
  for(const value of ['http://torob.com/browse/541/','https://digikala.com/browse/541/','https://torob.com.evil.ir/browse/541/','https://user:pass@torob.com/browse/541/','https://torob.com/search/?query=battery','https://127.0.0.1/browse/541/'])assert.throws(()=>torobUrl(value,'browse'));
  assert.equal(torobUrl(productUrl+'?session=x','product').url,productUrl);
  assert.equal(sellerUrl('https://evil.ir/product/123'),null);
});
test('JSON-LD extraction fails closed on mismatched products, challenges, bad currencies and price ranges',()=>{
  assert.throws(()=>parseProduct('<html><title>آیا شما یک ربات هستید؟</title><script src="https://widget.arcaptcha.ir"></script></html>',productUrl),/SOURCE_CHALLENGE/);
  assert.throws(()=>parseProduct(fixture,productUrl.replace('c2a29e6f','a2a29e6f')),/TOROB_PRODUCT_DATA_NOT_FOUND/);
  assert.throws(()=>parseProduct(fixture.replaceAll('"IRR"','"USD"'),productUrl));
  assert.throws(()=>parseProduct(fixture.replace('"lowPrice": "41000000"','"lowPrice": "999999990"'),productUrl),/INVALID_TOROB_PRICE_RANGE/);
});
test('shared battery compatibility requires complete specifications; equal amp-hours are insufficient',()=>{
  const product={name:'باتری سپاهان 60 آمپر 12 ولت L2 قطب چپ اتمی',specifications:{طول:'242',عرض:'175',ارتفاع:'190'}};
  const rule={category:'batteries',verified:true,evidenceUrl:'https://manufacturer.ir/data',expiresAt:new Date(Date.now()+86400000),requirements:{capacityAh:60,voltage:12,caseCode:'L2',polarity:'LEFT',technology:'WET',lengthMm:242,widthMm:175,heightMm:190}};
  assert.equal(batterySpecs(product).capacityAh,60);assert.equal(ruleMatches(product,rule),true);
  assert.equal(ruleMatches({...product,name:'باتری 60 آمپر'},rule),false);
  assert.equal(ruleMatches({...product,name:product.name.replace('چپ','راست')},rule),false);
  assert.equal(ruleMatches({...product,specifications:{}},rule),false);
  assert.equal(ruleMatches(product,{...rule,verified:false}),false);
  assert.equal(ruleMatches(product,{...rule,requirements:{capacityAh:60}}),false);
  assert.equal(ruleMatches({...product,specifications:{...product.specifications,'ظرفیت (Ah)':'باتری 50 آمپر'}},rule),false,'Contradictory specifications must not create a verified fitment');
});
test('car mentions support shared products without confusing Mazda 3 and Mazda 323',()=>{
  const cars=[{id:'3',maker:'مزدا',model:'3',trim:'نامشخص',aliases:['مزدا 3']},{id:'323',maker:'مزدا',model:'323',trim:'نامشخص',aliases:['مزدا 323']},{id:'206',maker:'پژو',model:'206',trim:'نامشخص',aliases:['206','پژو 206']}];
  assert.deepEqual(carMentions('لنت مزدا 323',cars).map(m=>m.car.id),['323']);
  assert.deepEqual(carMentions('باتری مزدا 3 و پژو 206',cars).map(m=>m.car.id),['3','206']);
});
function fakeBrowser(status=200){
  let position=0,closed=false;const urls=[productUrl,productUrl.replace('c2a29e6f','a2a29e6f')];
  const page={setUserAgent:async()=>{},setRequestInterception:async()=>{},on:()=>{},goto:async()=>({status:()=>status,ok:()=>status===200}),content:async()=>'<html></html>',waitForSelector:async()=>{},evaluate:async fn=>{const code=String(fn);if(code.includes('querySelectorAll'))return position===0?[urls[0],urls[0]+'?tracking=x']:[urls[1]];if(code.includes('scrollBy')){position++;return;}if(code.includes('scrollY'))return{y:1000,height:1000,viewport:900};return{height:1000};}};
  return{launch:async()=>({newPage:async()=>page,userAgent:async()=> 'HeadlessChrome',close:async()=>{closed=true;}}),closed:()=>closed};
}
const seed={seedUrl:'https://torob.com/browse/541/battery/',maxScrolls:20,maxProducts:10,scrollWaitMs:0,idleRounds:3};
const config={TOROB_CHROME_PATH:process.execPath,TOROB_SCAN_TIMEOUT_MS:10000,TOROB_BROWSER_NO_SANDBOX:false};
test('Puppeteer collection deduplicates by product ID across scrolls and closes the browser',async()=>{
  const browser=fakeBrowser(),found=[];const result=await collectLinks({seed,config,network:{checkRobots:async()=>({delayMs:0})},onLinks:async links=>found.push(...links),launch:browser.launch});
  assert.equal(result.count,2);assert.equal(found.length,2);assert.equal(result.complete,true);assert.equal(browser.closed(),true);
});
test('reaching a scroll/product budget is partial, never reported as complete',async()=>{
  const browser=fakeBrowser();const result=await collectLinks({seed:{...seed,maxProducts:1},config,network:{checkRobots:async()=>({})},onLinks:async()=>{},launch:browser.launch});assert.equal(result.limitReached,true);assert.equal(result.complete,false);
});
test('a challenge stops browser collection and still closes the browser',async()=>{
  const browser=fakeBrowser(490);await assert.rejects(collectLinks({seed,config,network:{checkRobots:async()=>({})},onLinks:async()=>assert.fail(),launch:browser.launch}),/SOURCE_CHALLENGE/);assert.equal(browser.closed(),true);
});

test('browser failures retain HTTP status and stage, and classify 429 as a rate limit',async()=>{
  for(const[status,code]of[[401,'SOURCE_ACCESS_DENIED'],[403,'SOURCE_ACCESS_DENIED'],[429,'SOURCE_RATE_LIMITED']]){
    const browser=fakeBrowser(status);
    await assert.rejects(collectLinks({seed,config,network:{checkRobots:async()=>({})},onLinks:async()=>assert.fail(),launch:browser.launch}),error=>error.message===code&&error.httpStatus===status&&error.stage==='browser-navigation'&&error.url===seed.seedUrl);
    assert.equal(browser.closed(),true);
  }
});
test('native catalog contains sourced vehicle models and a hierarchy of automotive categories',()=>{
  const{carRows,categoryRows}=require('../src/market/torob/catalog');assert.ok(carRows().length>=50);assert.ok(categoryRows.length>=40);assert.ok(carRows().every(c=>c.aliases.length&&c.maker&&c.model&&c.trim));assert.ok(categoryRows.find(c=>c[0]==='batteries'&&c[3]==='541'));
});
test('a documented complete battery rule can link one product to multiple cars',async()=>{
  const{applyCompatibility}=require('../src/market/torob/compatibility');const saved=[];
  const cars=[{id:'one',key:'car-one',maker:'برند 1',model:'ماشین1',trim:'نامشخص',aliases:['ماشین1']},{id:'two',key:'car-two',maker:'برند 2',model:'ماشین2',trim:'نامشخص',aliases:['ماشین2']}];
  const rule={name:'قاعده مرجع آزمایشی',category:'batteries',carKeys:cars.map(c=>c.key),verified:true,evidenceUrl:'https://manufacturer.ir/fixture',expiresAt:new Date(Date.now()+86400000),requirements:{capacityAh:60,voltage:12,caseCode:'L2',polarity:'LEFT',technology:'WET',lengthMm:242,widthMm:175,heightMm:190}};
  const tx={marketCar:{findMany:async()=>cars},marketCompatibilityRule:{findMany:async()=>[rule]},marketProductCompatibility:{deleteMany:async()=>{},create:async({data})=>saved.push(data)}};
  await applyCompatibility(tx,'product',{name:'باتری سپاهان 60 آمپر 12 ولت L2 قطب چپ اتمی',url:productUrl,specifications:{طول:'242',عرض:'175',ارتفاع:'190'}},'batteries');
  assert.deepEqual(saved.map(s=>s.carId),['one','two']);assert.ok(saved.every(s=>s.confidence==='VERIFIED_RULE'));
});
test('structured Torob fitments preserve model-year and automatic-transmission restrictions',async()=>{
  const{applyCompatibility,fitmentClaims}=require('../src/market/torob/compatibility');const parsed=parseProduct(fixture,productUrl);
  const claim=fitmentClaims(parsed.specifications).find(c=>c.text.includes('پژو 206 از'));assert.equal(claim.yearFrom,1396);assert.equal(claim.yearTo,null);
  const cars=[{id:'206',key:'206',maker:'پژو',model:'206',trim:'تیپ 2',aliases:['پژو 206']},{id:'quick-manual',key:'quick-manual',maker:'سایپا',model:'کوییک',trim:'S',aliases:['کوییک']},{id:'quick-auto',key:'quick-auto',maker:'سایپا',model:'کوییک',trim:'اتوماتیک',aliases:['کوییک اتوماتیک'],transmission:'CVT'}],saved=[];
  const tx={marketCar:{findMany:async()=>cars,upsert:async({create})=>({id:create.key,...create})},marketCompatibilityRule:{findMany:async()=>[]},marketProductCompatibility:{deleteMany:async()=>{},create:async({data})=>saved.push(data)}};
  await applyCompatibility(tx,'p',parsed,'batteries');assert.ok(saved.some(s=>s.carId==='206'&&s.yearFrom===1396));assert.ok(saved.some(s=>s.carId==='quick-auto'));assert.equal(saved.some(s=>s.carId==='quick-manual'),false);
  saved.length=0;await applyCompatibility(tx,'p',{...parsed,specifications:{'مناسب خودروهای':'پژو 206 TU5'}},'batteries');assert.equal(saved.some(s=>s.carId==='206'),false,'An explicit engine must not match a trim with unknown engine');
});
test('native product ingestion keeps snapshots idempotent and deduplicates the same seller',async()=>{
  const{createTorobService}=require('../src/market/torob/service');const categories=new Map([['auto-parts',{id:'root',slug:'auto-parts'}]]),offers=new Map(),snapshots=new Map();let product,reference;
  const tx={$queryRaw:async()=>[],marketCategory:{findUnique:async({where})=>categories.get(where.slug),upsert:async({where,create,update})=>{const row=categories.has(where.slug)?{...categories.get(where.slug),...update}:{id:where.slug,...create};categories.set(where.slug,row);return row;}},marketBrand:{upsert:async()=>({id:'brand'})},marketProduct:{upsert:async({create,update})=>(product=product?{...product,...update}:{id:'p',...create}),update:async({data})=>Object.assign(product,data)},marketReferencePrice:{findUnique:async()=>reference,upsert:async({create,update})=>(reference=reference?{...reference,...update}:{id:'r',...create})},marketDiscoveryResult:{upsert:async()=>{}},torobOffer:{upsert:async({where,create,update})=>{const key=where.referenceId_externalId.externalId,row=offers.has(key)?{...offers.get(key),...update}:{id:key,...create};offers.set(key,row);return row;},deleteMany:async()=>{},findMany:async()=>[...offers.values()].filter(o=>o.available&&o.expiresAt>new Date()).sort((a,b)=>a.priceToman-b.priceToman)},marketReferenceSnapshot:{upsert:async({where,create})=>{const key=JSON.stringify(where);if(!snapshots.has(key))snapshots.set(key,create);}},marketCar:{findMany:async()=>[],upsert:async({create})=>({id:create.key,...create})},marketCompatibilityRule:{findMany:async()=>[]},marketProductCompatibility:{deleteMany:async()=>{},create:async()=>{}}};
  const service=createTorobService({$transaction:fn=>fn(tx)},{}),parsed=parseProduct(fixture,productUrl);parsed.offers.forEach(o=>o.priceValidUntil=new Date(Date.now()+86400000));
  await service.ingest({id:'seed',category:'batteries'},parsed,'run');await service.ingest({id:'seed',category:'batteries'},parsed,'run');
  assert.equal(snapshots.size,1);assert.equal(offers.size,6);assert.equal(product.offerCount,4);assert.equal(product.avgPriceToman,5490700);assert.equal(product.minPriceToman,4100000);assert.equal(reference.productId,'p');assert.equal(categories.get('batteries').parentId,'electrical');
});
test('manual source API accepts only Torob browse URLs and car-aware search uses compatibility links',async t=>{
  const http=require('node:http'),{createApp}=require('../src/app');let created,searchWhere;
  const car={id:'car1',maker:'برند',model:'ماشین1',trim:'نامشخص',aliases:['ماشین1']};
  const prisma={marketCategory:{findUnique:async()=>({id:'b',slug:'batteries'})},marketDiscoveryQuery:{create:async({data})=>(created={id:'seed',...data})},marketCar:{findMany:async()=>[car]},marketProduct:{findMany:async({where})=>{searchWhere=where;return[];},count:async()=>0}};
  const app=createApp({prisma,redis:{get:async()=> 'configured',eval:async()=>1},config:{origins:[],TRUST_PROXY:0,ADMIN_PASSWORD_HASH:'configured'},services:{},io:{}});const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const root=`http://127.0.0.1:${server.address().port}/api/v1`,post=url=>fetch(root+'/admin/market/sources',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify({name:'باتری',url,category:'batteries'})});
  assert.equal((await post('https://digikala.com/browse/541/')).status,400);
  assert.equal((await post('https://torob.com/browse/541/battery/')).status,201);assert.equal(created.active,true);assert.equal(created.maxScrolls,1000);
  assert.equal((await fetch(root+'/market/discovery')).status,410);
  assert.equal((await fetch(root+'/market/products?q='+encodeURIComponent('باتری ماشین1'))).status,200);assert.deepEqual(searchWhere.compatibilities.some.carId.in,['car1']);assert.equal(searchWhere.AND[0].searchText.contains,'باتری');
});
