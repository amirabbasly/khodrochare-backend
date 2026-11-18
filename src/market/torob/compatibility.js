const {normalize}=require('../domain');
function batterySpecs(product){
  const props=product.specifications||{},text=normalize([product.name,...Object.entries(props).map(([k,v])=>`${k} ${v}`)].join(' '));
  const single=(items)=>{const values=[...new Set(items)];return values.length===1?values[0]:null;};
  const numbers=pattern=>single([...text.matchAll(pattern)].map(m=>Number(m[1])));
  const cases=[...text.matchAll(/\b(l[1-6]|d(?:23|26|31))\b/gi)].map(m=>m[1].toUpperCase());
  const poles=[...text.matchAll(/قطب\s*(چپ|راست)/g)].map(m=>m[1]==='چپ'?'LEFT':'RIGHT');
  const values={capacityAh:numbers(/\b(\d{2,3})\s*(?:امپر|آمپر|ah)/gi),voltage:numbers(/\b(\d{1,2})\s*(?:ولت|volt|v)(?=\s|$)/gi),caseCode:single(cases),polarity:single(poles),technology:/\bagm\b/i.test(text)&&/\befb\b/i.test(text)?null:/\bagm\b/i.test(text)?'AGM':/\befb\b/i.test(text)?'EFB':/(سیلد|اتمی|اسیدی)/.test(text)?'WET':null};
  for(const[key,aliases]of Object.entries({lengthMm:['طول','length'],widthMm:['عرض','width'],heightMm:['ارتفاع','height']})){
    values[key]=null;for(const[name,value]of Object.entries(props))if(aliases.includes(normalize(name))){const match=normalize(value).match(/^(\d{2,3})(?:\s*(?:میلی\s*متر|mm))?$/);if(match)values[key]=Number(match[1]);}
  }
  return values;
}
function ruleMatches(product,rule){
  if(!rule.verified||!rule.evidenceUrl||new Date(rule.expiresAt)<=new Date())return false;
  const required=rule.requirements||{},specs=rule.category==='batteries'?batterySpecs(product):{...(product.specifications||{}),partNumber:product.partNumber,oemNumber:product.oemNumber,brand:product.brand};
  if(rule.category==='batteries'&&!['capacityAh','voltage','caseCode','polarity','technology','lengthMm','widthMm','heightMm'].every(key=>required[key]!=null))return false;
  return Object.keys(required).length>0&&Object.entries(required).every(([key,value])=>specs[key]!=null&&normalize(specs[key])===normalize(value));
}
function carMentions(text,cars){
  text=' '+normalize(text)+' ';
  const matches=cars.map(car=>({car,aliases:[...(car.aliases||[]),`${car.maker} ${car.model} ${car.trim}`,car.model].map(normalize).filter(alias=>alias.length>=3&&text.includes(' '+alias+' '))})).filter(m=>m.aliases.length);
  // A specific trim mention must not silently broaden to other trims of the same model.
  const specific=matches.filter(m=>m.aliases.some(a=>a.includes(normalize(m.car.trim))&&m.car.trim!=='نامشخص'));
  return matches.filter(m=>!specific.some(s=>s.car.maker===m.car.maker&&s.car.model===m.car.model)||specific.includes(m)).map(m=>({car:m.car,alias:m.aliases.sort((a,b)=>b.length-a.length)[0]}));
}
function fitmentClaims(specifications){
  return Object.entries(specifications||{}).filter(([key])=>/(مناسب|سازگار|fitment|compatible)/i.test(key)).flatMap(([,value])=>String(value).split(/[,،;؛\n]+/)).map(raw=>{
    const text=normalize(raw),range=text.match(/\b(1\d{3}|20\d{2})\s*(?:تا|الی|to)\s*(1\d{3}|20\d{2})\b/),year=text.match(/\b(1\d{3}|20\d{2})\s*به\s*(بعد|قبل)/);
    return{text,yearFrom:range?Number(range[1]):year?.[2]==='بعد'?Number(year[1]):null,yearTo:range?Number(range[2]):year?.[2]==='قبل'?Number(year[1]):null,automatic:/اتوماتیک|automatic|cvt/i.test(text),hybrid:/هیبرید|hybrid/i.test(text),engineCode:text.match(/\b(tu5p|tu5|tu3|xu7p|xu7|ef7p|ef7|m15i|m15)\b/i)?.[1]?.toUpperCase()||null};
  }).filter(c=>c.text.length>=3&&c.text.length<=300);
}
const makers=['ایران خودرو','فردا موتور','سانگ یانگ','فولکس واگن','لیپ موتور','بی ام و','ام جی','ام وی ام','کی ام سی','پژو','تویوتا','نیسان','هیوندای','هوندا','مزدا','مینی','شورلت','ولوو','رنو','سوزوکی','سایپا','جک','هایما','چری','فیدلیتی','دیگنیتی','کیا','BYD','Toyota','Honda','Hyundai','Peugeot','Mazda','Renault','BMW','Volvo'];
async function claimedCar(tx,claim,url,base){
  const clean=claim.text.replace(/\(?\s*(?:از\s*)?(?:1\d{3}|20\d{2})\s*(?:به\s*(?:بعد|قبل)|تا\s*(?:1\d{3}|20\d{2}))\s*\)?/g,'').replace(/گیربکس\s*/g,'').trim();
  const maker=base?.maker||makers.find(m=>clean.startsWith(normalize(m)+' '));if(!maker)return null;
  let model=base?.model||clean.slice(normalize(maker).length).trim();if(claim.hybrid&&!/هیبرید|hybrid/i.test(model))model+=' هیبرید';if(claim.automatic)model=model.replace(/\s+اتوماتیک$/,'');if(!model||model.length>100)return null;
  const trim=[claim.engineCode,claim.automatic?'اتوماتیک':null].filter(Boolean).join(' ')||'نامشخص',key=[maker,model,trim].map(normalize).join('|');
  return tx.marketCar.upsert({where:{key},create:{key,maker,model,trim,aliases:[clean,model],sourceUrl:url,catalogCheckedAt:new Date(),...(claim.engineCode?{engineCode:claim.engineCode}:{}),...(claim.automatic?{transmission:'AUTOMATIC'}:{})},update:{}});
}
async function applyCompatibility(tx,productId,parsed,category){
  const cars=await tx.marketCar.findMany({take:3000}),now=new Date(),expiresAt=new Date(Date.now()+180*86400000),matches=new Map();
  const claims=fitmentClaims(parsed.specifications);
  if(!claims.length)claims.push({text:normalize(parsed.name),yearFrom:null,yearTo:null,automatic:/اتوماتیک|automatic|cvt/i.test(parsed.name),hybrid:/هیبرید|hybrid/i.test(parsed.name),engineCode:normalize(parsed.name).match(/\b(tu5p|tu5|tu3|xu7p|xu7|ef7p|ef7|m15i|m15)\b/i)?.[1]?.toUpperCase()||null});
  for(const claim of claims){
    const mentioned=carMentions(claim.text,cars);
    let targets=mentioned.filter(({car})=>(!claim.automatic||/اتوماتیک|automatic|cvt|\bat\b/i.test(car.trim+' '+car.transmission))&&(!claim.hybrid||/هیبرید|hybrid/i.test(car.model+' '+car.trim))&&(!claim.engineCode||normalize(car.engineCode)===normalize(claim.engineCode)));
    if(!targets.length){const car=await claimedCar(tx,claim,parsed.url,mentioned[0]?.car);if(car)targets=[{car,alias:claim.text}];}
    for(const{car}of targets)matches.set(car.id,{carId:car.id,confidence:'MODEL_CLAIM',evidenceUrl:parsed.url,evidenceText:`اعلام منبع: ${claim.text}`,yearFrom:claim.yearFrom,yearTo:claim.yearTo});
  }
  const rules=await tx.marketCompatibilityRule.findMany({where:{category,verified:true,expiresAt:{gt:now}},take:1000});
  for(const rule of rules)if(ruleMatches(parsed,rule))for(const car of cars.filter(c=>rule.carKeys.includes(c.key)))matches.set(car.id,{carId:car.id,confidence:'VERIFIED_RULE',evidenceUrl:rule.evidenceUrl,evidenceText:rule.name});
  await tx.marketProductCompatibility.deleteMany({where:{productId}});
  for(const match of matches.values())await tx.marketProductCompatibility.create({data:{productId,yearFrom:null,yearTo:null,...match,checkedAt:now,expiresAt}});
}
module.exports={batterySpecs,ruleMatches,carMentions,applyCompatibility,fitmentClaims};
