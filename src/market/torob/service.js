const {hash,HttpError}=require('../../domain');
const {normalize}=require('../domain');
const {categoryRows,bootstrapCatalog}=require('./catalog');
const {applyCompatibility}=require('./compatibility');
const {readSettings,syncSettings}=require('./env-settings');
const DEFAULT_SEED='https://torob.com/browse/541/باتری-خودرو-battery/';
async function categoriesFromBreadcrumbs(tx,parsed,fallback){
  let parent=await tx.marketCategory.findUnique({where:{slug:'auto-parts'}}),selected=null;
  const crumbs=parsed.categories,root=crumbs.findIndex(c=>c.torobId==='293');
  if(root<0)throw new HttpError(400,'TOROB_AUTOMOTIVE_CATEGORY_REQUIRED');
  const seen=new Set();for(const item of root>=0?crumbs.slice(root):[]){
    if(seen.has(item.torobId))continue;seen.add(item.torobId);
    const known=categoryRows.find(row=>row[3]===item.torobId),slug=known?.[0]||'torob-'+item.torobId;
    selected=await tx.marketCategory.upsert({where:{slug},create:{slug,name:item.name,torobId:item.torobId,sourceUrl:item.url,parentId:item.torobId==='293'?null:parent?.id},update:{torobId:item.torobId,sourceUrl:item.url,...(item.torobId!=='293'?{parentId:parent?.id}:{})}});parent=selected;
  }
  return selected||await tx.marketCategory.findUnique({where:{slug:fallback||'auto-parts'}});
}
function createTorobService(prisma,config){
  async function bootstrap(){
    const settings=readSettings(config);
    await bootstrapCatalog(prisma);
    return syncSettings(prisma,settings);
  }
  async function ingest(seed,parsed,runKey){
    return prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('torob-product'),hashtext(${parsed.externalId}))`;
      const now=new Date(),expiresAt=new Date(Date.now()+(config.TOROB_PRICE_TTL_HOURS||24)*3600000);
      const category=await categoriesFromBreadcrumbs(tx,parsed,seed.category);if(!category)throw new HttpError(400,'Unknown automotive category');
      const brand=await tx.marketBrand.upsert({where:{key:normalize(parsed.brand)},create:{key:normalize(parsed.brand),name:parsed.brand},update:{}});
      const previous=await tx.marketReferencePrice.findUnique({where:{source_externalId:{source:'TOROB',externalId:parsed.externalId}}});
      const suspicious=!!(previous?.suspicious||previous?.priceToman&&parsed.minPriceToman&&(parsed.minPriceToman<previous.priceToman*.2||parsed.minPriceToman>previous.priceToman*5));
      const productData={name:parsed.name,searchText:normalize([parsed.name,parsed.brand,parsed.partNumber,parsed.oemNumber].filter(Boolean).join(' ')),categoryId:category.id,brandId:brand.id,description:parsed.description,images:parsed.images,specifications:parsed.specifications,condition:parsed.condition,authenticity:'UNKNOWN',partNumber:parsed.partNumber,oemNumber:parsed.oemNumber,fitmentSignature:'',minPriceToman:suspicious?null:parsed.minPriceToman,maxPriceToman:parsed.maxPriceToman,summaryAt:now,dealScore:0,dropPercent:0};
      const product=await tx.marketProduct.upsert({where:{identityKey:hash('torob:'+parsed.externalId)},create:{identityKey:hash('torob:'+parsed.externalId),...productData},update:productData});
      const metadata={reportedOfferCount:parsed.reportedOfferCount,maxPriceToman:parsed.maxPriceToman,rejectedOffers:parsed.rejectedOffers,source:'TOROB_HTML_JSONLD'};
      const reference=await tx.marketReferencePrice.upsert({where:{source_externalId:{source:'TOROB',externalId:parsed.externalId}},create:{source:'TOROB',externalId:parsed.externalId,productId:product.id,title:parsed.name,searchText:productData.searchText,url:parsed.url,priceToman:parsed.minPriceToman,metadata,suspicious,checkedAt:now,expiresAt},update:{productId:product.id,title:parsed.name,searchText:productData.searchText,url:parsed.url,priceToman:parsed.minPriceToman,metadata,suspicious,checkedAt:now,expiresAt}});
      await tx.marketDiscoveryResult.upsert({where:{queryId_referenceId:{queryId:seed.id,referenceId:reference.id}},create:{queryId:seed.id,referenceId:reference.id,rank:0,seenAt:now},update:{seenAt:now}});
      const ids=[];
      for(const offer of parsed.offers){
        const offerExpires=offer.priceValidUntil&&offer.priceValidUntil<expiresAt?offer.priceValidUntil:expiresAt;
        const row=await tx.torobOffer.upsert({where:{referenceId_externalId:{referenceId:reference.id,externalId:offer.externalId}},create:{referenceId:reference.id,...offer,checkedAt:now,expiresAt:offerExpires},update:{...offer,checkedAt:now,expiresAt:offerExpires}});ids.push(row.id);
      }
      await tx.torobOffer.deleteMany({where:{referenceId:reference.id,id:{notIn:ids}}});
      const valid=await tx.torobOffer.findMany({where:{referenceId:reference.id,available:true,expiresAt:{gt:now}},orderBy:{priceToman:'asc'}});
      const bySeller=new Map();for(const offer of valid)if(!bySeller.has(offer.sellerKey))bySeller.set(offer.sellerKey,offer);const unique=[...bySeller.values()];
      await tx.marketProduct.update({where:{id:product.id},data:{offerCount:unique.length,avgPriceToman:unique.length?Math.round(unique.reduce((s,o)=>s+o.priceToman,0)/unique.length):null}});
      if(parsed.minPriceToman&&!suspicious)await tx.marketReferenceSnapshot.upsert({where:{referenceId_runKey:{referenceId:reference.id,runKey}},create:{referenceId:reference.id,runKey,priceToman:parsed.minPriceToman,checkedAt:now},update:{}});
      await applyCompatibility(tx,product.id,parsed,category.slug);
      return{productId:product.id,priceToman:suspicious?null:parsed.minPriceToman};
    },{timeout:60000});
  }
  return{bootstrap,ingest};
}
module.exports={createTorobService,categoriesFromBreadcrumbs,DEFAULT_SEED};
