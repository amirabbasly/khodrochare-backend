const {hash}=require('../../domain');
const {money,normalize,safeUrl}=require('../domain');
const {torobUrl,sellerUrl}=require('./urls');
function jsonld(html){
  const found=[];const visit=value=>{if(Array.isArray(value))return value.forEach(visit);if(!value||typeof value!=='object')return;found.push(value);if(value['@graph'])visit(value['@graph']);};
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(match[1]));}catch{/* Ignore an unrelated invalid block; never execute page scripts. */}}
  return found;
}
const isType=(value,type)=>value?.['@type']===type||Array.isArray(value?.['@type'])&&value['@type'].includes(type);
function parseProduct(html,url){
  if(/<title[^>]*>[^<]*(ربات|captcha)|widget\.arcaptcha|class=["'][^"']*captcha/i.test(html.slice(0,15000)))throw new Error('SOURCE_CHALLENGE');
  const expected=torobUrl(url,'product'),blocks=jsonld(html),products=blocks.filter(p=>isType(p,'Product'));
  const product=products.find(p=>String(p.sku).toLowerCase()===expected.id)||products.find(p=>{try{return torobUrl(p.url,'product').id===expected.id;}catch{return false;}});
  if(!product||typeof product.name!=='string'||product.name.length<3||product.name.length>250)throw new Error('TOROB_PRODUCT_DATA_NOT_FOUND');
  const aggregate=Array.isArray(product.offers)?product.offers[0]:product.offers||{};
  const rawOffers=isType(aggregate,'AggregateOffer')?(Array.isArray(aggregate.offers)?aggregate.offers:aggregate.offers?[aggregate.offers]:[]):Array.isArray(product.offers)?product.offers:[aggregate];
  const offers=[];let rejectedOffers=0;
  for(const offer of rawOffers.slice(0,500)){
    try{
      const link=sellerUrl(offer.url);if(!link||!offer.name||String(offer.name).length>150)throw new Error('INVALID_SELLER');
      const priceToman=money(offer.price,offer.priceCurrency||aggregate.priceCurrency);
      const available=/\/(InStock|LimitedAvailability)$/.test(offer.availability||'')?true:/\/(OutOfStock|SoldOut|Discontinued)$/.test(offer.availability||'')?false:null;
      let priceValidUntil=null;if(offer.priceValidUntil){if(!/^\d{4}-\d{2}-\d{2}$/.test(offer.priceValidUntil))throw new Error('INVALID_EXPIRY');priceValidUntil=new Date(offer.priceValidUntil+'T23:59:59.999+03:30');if(Number.isNaN(+priceValidUntil)||priceValidUntil.toISOString().slice(0,10)!==offer.priceValidUntil)throw new Error('INVALID_EXPIRY');}
      const condition=/\/NewCondition$/.test(offer.itemCondition||'')?'NEW':/\/UsedCondition$/.test(offer.itemCondition||'')?'USED':/\/RefurbishedCondition$/.test(offer.itemCondition||'')?'REFURBISHED':'UNKNOWN';
      offers.push({externalId:link.externalId,sellerKey:hash(normalize(offer.name)),sellerName:String(offer.name),url:link.url,priceToman,available,condition,priceValidUntil});
    }catch{rejectedOffers++;}
  }
  let minPriceToman=null,maxPriceToman=null;
  const priced=value=>value!=null&&String(value).trim()!==''&&!/^0+(?:\.0+)?$/.test(String(value).trim());
  if(priced(aggregate.lowPrice))minPriceToman=money(aggregate.lowPrice,aggregate.priceCurrency);
  if(priced(aggregate.highPrice))maxPriceToman=money(aggregate.highPrice,aggregate.priceCurrency);
  if(minPriceToman&&maxPriceToman&&maxPriceToman<minPriceToman)throw new Error('INVALID_TOROB_PRICE_RANGE');
  if(!minPriceToman&&offers.length)minPriceToman=Math.min(...offers.map(o=>o.priceToman));
  const imageValues=Array.isArray(product.image)?product.image:product.image?[product.image]:[];
  const images=imageValues.slice(0,12).map(i=>typeof i==='string'?i:i?.url).filter(Boolean).flatMap(value=>{try{const u=new URL(safeUrl(value));return ['image.torob.com','assets.torob.com'].includes(u.hostname)?[u.href]:[];}catch{return[];}});
  const specifications={};for(const p of (Array.isArray(product.additionalProperty)?product.additionalProperty:[]).slice(0,100))if(p?.name&&p.value!=null)specifications[String(p.name).slice(0,100)]=String(p.value).slice(0,500);
  const nextMatch=html.match(/<script\b[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(nextMatch){try{
    const base=JSON.parse(nextMatch[1])?.props?.pageProps?.baseProduct;
    if(base?.random_key===expected.id)for(const group of(base.structural_specs?.headers||[]).slice(0,30))for(const[key,value]of Object.entries(group.specs||{}).slice(0,100))if(value!=null&&['string','number'].includes(typeof value)&&!(key in specifications))specifications[String(key).slice(0,100)]=String(value).slice(0,4000);
  }catch{/* JSON-LD remains usable when optional Next data changes. */}}
  const categories=blocks.filter(p=>isType(p,'BreadcrumbList')).flatMap(p=>p.itemListElement||[]).flatMap(item=>{try{const parsed=torobUrl(typeof item.item==='string'?item.item:item.item?.['@id'],'browse');return[{torobId:parsed.id,name:String(item.name||'').slice(0,100),url:parsed.url}];}catch{return[];}});
  const brand=typeof product.brand==='string'?product.brand:product.brand?.name||'نامشخص';
  const uniqueOffers=[...new Map(offers.map(o=>[o.externalId,o])).values()];
  const specCode=pattern=>Object.entries(specifications).find(([key])=>pattern.test(normalize(key)))?.[1];
  const partNumber=product.mpn||specCode(/^(کد فنی|شماره فنی|شماره قطعه|mpn|part number)$/i),oemNumber=product.oemNumber||specCode(/^(oem|کد oem|شماره oem)$/i);
  return{externalId:expected.id,url:expected.url,name:product.name,brand:String(brand).slice(0,100),description:String(product.description||'').replace(/<[^>]*>/g,'').slice(0,8000),images,specifications,partNumber:partNumber?String(partNumber).slice(0,100):null,oemNumber:oemNumber?String(oemNumber).slice(0,100):null,condition:uniqueOffers.length&&uniqueOffers.every(o=>o.condition==='NEW')?'NEW':'UNKNOWN',categories,minPriceToman,maxPriceToman,reportedOfferCount:Number.isInteger(Number(aggregate.offerCount))&&Number(aggregate.offerCount)>=0?Number(aggregate.offerCount):uniqueOffers.length,offers:uniqueOffers,rejectedOffers};
}
module.exports={parseProduct,jsonld};
