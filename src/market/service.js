const m = require('./domain');
const { HttpError, hash } = require('../domain');
const {offerStatistics}=require('./offers');
function validOfferWhere(now = new Date()) {
  return { inStock: true, suspicious: false, expiresAt: { gt: now }, listing: { matchStatus: 'APPROVED', product: { active: true, category: { active: true }, brand: { active: true } }, seller: { active: true }, source: { active: true, licenseUrl: { not: null }, permissionExpiresAt: { gt: now } } } };
}
function createMarketService(prisma) {
  const audit = (tx, actor, action, entityId, note) => tx.marketAuditLog.create({ data: { actor, action, entityId, note } });
  async function createProduct(input, actor) {
    const p = m.productSchema.parse(input);
    return prisma.$transaction(tx => persistProduct(tx,p,m.identity(p),actor));
  }
  async function persistProduct(tx,p,identityKey,actor) {
      let category = await tx.marketCategory.findUnique({ where: { slug: p.category } });
      if(!category&&p.category==='unclassified')category=await tx.marketCategory.upsert({where:{slug:'unclassified'},create:{slug:'unclassified',name:'سایر قطعات'},update:{}});
      if (!category) throw new HttpError(400, 'Unknown market category');
      const brand = await tx.marketBrand.upsert({ where: { key: m.normalize(p.brand) }, create: { key: m.normalize(p.brand), name: p.brand }, update: {} });
      const data = {
        name: p.name, englishName: p.englishName, searchText: m.normalize([p.name, p.englishName, p.brand, p.partNumber, p.oemNumber].filter(Boolean).join(' ')), identityKey, categoryId: category.id, brandId: brand.id,
        partNumber: p.partNumber ? m.code(p.partNumber) : null, oemNumber: p.oemNumber ? m.code(p.oemNumber) : null, condition: p.condition, authenticity: p.authenticity, country: p.country, description: p.description, images: p.images, specifications: p.specifications, fitmentSignature: m.fitmentSignature(p.fitments),
      };
      const product=await tx.marketProduct.upsert({where:{identityKey},create:data,update:{}});
      for (const f of p.fitments) {
        const key = [f.maker, f.model, f.trim].map(m.normalize).join('|');
        const car = await tx.marketCar.upsert({ where: { key }, create: { key, maker: f.maker, model: f.model, trim: f.trim }, update: {} });
        await tx.marketFitment.upsert({ where: { productId_carId_yearFrom_yearTo: { productId: product.id, carId: car.id, yearFrom: f.yearFrom, yearTo: f.yearTo } }, create: { productId: product.id, carId: car.id, yearFrom: f.yearFrom, yearTo: f.yearTo }, update: {} });
      }
      await audit(tx, actor, 'PRODUCT_CREATED', product.id, 'Canonical product registered'); return product;
  }
  async function ingest(source, runId, raw) {
    const extracted=m.listingSchema.parse(raw);
    let p=extracted, fingerprint=m.identity(extracted);
    const sourceFingerprint=fingerprint,priceToman=m.money(p.price,p.currency);
    const zeroShipping=String(p.shipping).replace(/[۰٠]/g,'0').replace(/[,٬\s]/g,'');
    const shippingToman=p.shipping==null?null:/^0+$/.test(zeroShipping)?0:m.money(p.shipping,p.currency);
    const sellerDomain = new URL(p.seller.url).hostname.replace(/^www\./,'');
    if (new URL(p.url).hostname.replace(/^www\./,'') !== sellerDomain) throw new HttpError(400, 'Offer URL must belong to its seller');
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}),hashtext(${p.externalId}))::text AS locked`;
      await tx.$queryRaw`SELECT id FROM "MarketListing" WHERE "sourceId"=${source.id} AND "externalId"=${p.externalId} FOR UPDATE`;
      const existing = await tx.marketListing.findUnique({ where: { sourceId_externalId: { sourceId: source.id, externalId: p.externalId } }, include: { offer: true } });
      const metadataOverrides = existing?.sourceFingerprint===sourceFingerprint?existing.metadataOverrides:null;
      if(metadataOverrides){p=m.listingSchema.parse({...extracted,...metadataOverrides});fingerprint=m.identity(p);}
      const seller = await tx.marketSeller.upsert({ where: { domain: sellerDomain }, create: { sourceId: source.id, externalId: p.seller.externalId, name: p.seller.name, domain: sellerDomain, url: p.seller.url, logo: p.seller.logo, lastCheckedAt: new Date() }, update: { name: p.seller.name, lastCheckedAt: new Date() } });
      if (seller.domain !== sellerDomain) throw new HttpError(400, 'Seller domain changed; review required');
      const same = existing?.fingerprint === fingerprint;
      let productId = same ? existing.productId : null, matchStatus = same ? existing.matchStatus : 'PENDING', matchScore = same ? existing.matchScore : 0, candidate;
      if (!same) {
        const identifiers = [...(p.partNumber ? [{ partNumber: m.code(p.partNumber) }] : []), ...(p.oemNumber ? [{ oemNumber: m.code(p.oemNumber) }] : [])];
        const alternatives = await tx.marketProduct.findMany({ where: { active: true, brand: { key: m.normalize(p.brand) }, category: { slug: p.category }, ...(identifiers.length ? { OR: identifiers } : {}) }, include: { brand: true, category: true }, take: 50 });
        const ranked = alternatives.map(product => ({ product, ...m.match(p, product) })).sort((a, b) => b.score - a.score);
        candidate = ranked[0] || { score: 0, reasons: ['NO_CANDIDATE'] };
        if (candidate.auto && ranked.filter(r => r.auto).length === 1) { productId = candidate.product.id; matchStatus = 'APPROVED'; }
        matchScore = candidate.score;
        if(matchStatus==='PENDING'&&source.config?.automaticPublication!==false){
          // Only complete technical identities may group prices across sources.
          // Incomplete records remain separate, with UNKNOWN metadata preserved.
          const reliable=m.match(p,p).auto&&!['نامشخص','unknown'].includes(m.normalize(p.brand));
          const identityKey=reliable?m.identity(p):hash(JSON.stringify(['isolated',source.id,p.externalId,fingerprint]));
          const product=await persistProduct(tx,p,identityKey,'worker:'+source.id);
          productId=product.id;matchStatus='APPROVED';matchScore=reliable?100:0;
        }
      }
      const checkedAt = new Date();
      const data = { sourceFingerprint, metadataOverrides: metadataOverrides || {}, sellerId: seller.id, productId, title: p.name, url: p.url, normalized: p, fingerprint, matchStatus, matchScore, checkedAt };
      const listing = await tx.marketListing.upsert({ where: { sourceId_externalId: { sourceId: source.id, externalId: p.externalId } }, create: { sourceId: source.id, externalId: p.externalId, ...data }, update: data });
      if (candidate && matchStatus === 'PENDING') await tx.marketMatchReview.upsert({ where: { listingId_fingerprint: { listingId: listing.id, fingerprint } }, create: { listingId: listing.id, fingerprint, candidateId: candidate.product?.id, score: candidate.score, reasons: candidate.reasons }, update: {} });
      const suspicious = !!(same && (existing.offer?.suspicious || existing.offer && (priceToman < existing.offer.priceToman * .2 || priceToman > existing.offer.priceToman * 5)));
      const offer = { productId, priceToman, shippingToman, inStock: p.inStock, quantity: p.quantity ?? null, suspicious, checkedAt, expiresAt: new Date(checkedAt.getTime() + source.offerTtlHours * 3600000) };
      await tx.marketOffer.upsert({ where: { listingId: listing.id }, create: { listingId: listing.id, ...offer }, update: offer });
      await tx.marketPriceSnapshot.upsert({ where: { listingId_runId: { listingId: listing.id, runId } }, create: { listingId: listing.id, runId, productId, fingerprint, priceToman, shippingToman, inStock: p.inStock, suspicious, checkedAt }, update: {} });
      return [...new Set([existing?.productId, productId].filter(Boolean))];
    });
  }
  async function review(id, input, actor) {
    return prisma.$transaction(async tx => {
      const item = await tx.marketMatchReview.findUnique({ where: { id } }); if (!item) throw new HttpError(404, 'Market review not found');
      await tx.$queryRaw`SELECT id FROM "MarketListing" WHERE id=${item.listingId} FOR UPDATE`;
      const listing = await tx.marketListing.findUnique({ where: { id: item.listingId } });
      if (item.status !== 'PENDING' || item.fingerprint !== listing.fingerprint) throw new HttpError(409, 'Listing changed; reload review');
      if (input.status === 'APPROVED') {
        const product = await tx.marketProduct.findUnique({ where: { id: input.productId }, include: { brand: true, category: true } }); if (!product) throw new HttpError(404, 'Market product not found');
        const comparison = m.match(listing.normalized, product);
        if (comparison.reasons.some(r => r.includes('CONFLICT') || r === 'AUTHENTICITY_UNCERTAIN')) throw new HttpError(409, 'Resolve conflicting or missing technical metadata before approval');
      }
      const productId = input.status === 'APPROVED' ? input.productId : null;
      await tx.marketListing.update({ where: { id: listing.id }, data: { matchStatus: input.status, productId } });
      await tx.marketOffer.update({ where: { listingId: listing.id }, data: { productId } });
      if (productId) await tx.marketPriceSnapshot.updateMany({ where: { listingId: listing.id, fingerprint: listing.fingerprint, productId: null }, data: { productId } });
      await tx.marketMatchReview.update({ where: { id }, data: { status: input.status, candidateId: productId, operator: actor, note: input.note, reviewedAt: new Date() } });
      await audit(tx, actor, 'MATCH_' + input.status, listing.id, input.note); return productId;
    });
  }
  async function refreshProduct(id) {
    const [rows,baseline]=await Promise.all([
      offerStatistics(prisma,[id]),
      prisma.$queryRaw`SELECT MIN("priceToman")::int AS low,COUNT(DISTINCT "checkedAt"::date)::int AS days FROM "MarketPriceSnapshot" WHERE "productId"=${id} AND "inStock"=true AND suspicious=false AND "checkedAt">NOW()-INTERVAL '30 days' AND "checkedAt"<NOW()-INTERVAL '1 day'`,
    ]);
    const stats=rows[0]||{min:null,max:null,average:null,count:0};
    const best=stats.bestOfferId?await prisma.marketOffer.findUnique({where:{id:stats.bestOfferId},include:{listing:{include:{seller:true}}}}):null;
    const opportunity=m.deal({summary:stats,previousLow:baseline[0]?.days>=7?baseline[0].low:null,seller:best?.listing.seller});
    await prisma.marketProduct.update({where:{id},data:{minPriceToman:stats.min,maxPriceToman:stats.max,avgPriceToman:stats.average,offerCount:stats.count,dealScore:opportunity.score,dropPercent:opportunity.dropPercent,summaryAt:new Date()}});
    await evaluateAlerts(id,stats.min);
  }
  async function evaluateAlerts(productId, price) {
    let cursor;
    do {
      const alerts = await prisma.marketAlert.findMany({ where: { productId, active: true }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const { id } of alerts) await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "MarketAlert" WHERE id=${id} FOR UPDATE`;
        const alert = await tx.marketAlert.findUnique({ where: { id }, include: { product: true } }); if (!alert?.active) return;
        const inStock = price != null, eligible = inStock && price <= alert.targetToman;
        const fire = (eligible && !alert.lastEligible) || (alert.notifyStock && inStock && !alert.lastInStock), cycle = alert.cycle + (fire ? 1 : 0);
        await tx.marketAlert.update({ where: { id }, data: { lastEligible: eligible, lastInStock: inStock, cycle } });
        if (fire) await tx.marketNotification.create({ data: { alertId: id, cycle, title: 'خبر تازه از جمعه‌بازار', body: `${alert.product.name}: ${price.toLocaleString('fa-IR')} تومان`, smsState: alert.sms ? 'PENDING' : 'NOT_REQUESTED' } });
      });
      cursor = alerts.length === 100 ? alerts.at(-1).id : undefined;
    } while (cursor);
  }
  return { createProduct, ingest, review, refreshProduct, evaluateAlerts, audit };
}
module.exports = { createMarketService, validOfferWhere };
