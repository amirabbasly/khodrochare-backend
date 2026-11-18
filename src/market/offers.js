const {Prisma}=require('@prisma/client');
// A seller appearing in both an aggregator and its own feed must count only once.
function eligible(ids){return Prisma.sql`
  SELECT o.id,o."productId",o."priceToman",l."sellerId",
    ROW_NUMBER() OVER(PARTITION BY o."productId",l."sellerId" ORDER BY o."priceToman",o.id) AS rn
  FROM "MarketOffer" o JOIN "MarketListing" l ON l.id=o."listingId"
  JOIN "MarketProduct" p ON p.id=o."productId" AND p.id=l."productId"
  JOIN "MarketBrand" b ON b.id=p."brandId" JOIN "MarketCategory" c ON c.id=p."categoryId"
  JOIN "MarketSeller" s ON s.id=l."sellerId" JOIN "MarketSource" src ON src.id=l."sourceId"
  WHERE p.id IN (${Prisma.join(ids)}) AND p.active AND b.active AND c.active
    AND o."inStock" AND NOT o.suspicious AND o."expiresAt">NOW()
    AND l."matchStatus"='APPROVED' AND s.active AND src.active
    AND src."licenseUrl" IS NOT NULL AND src."permissionExpiresAt">NOW()`;}
async function offerStatistics(prisma,ids){
  if(!ids.length)return[];
  return prisma.$queryRaw(Prisma.sql`WITH quotes AS (${eligible(ids)})
    SELECT "productId",MIN("priceToman")::int AS min,MAX("priceToman")::int AS max,
      ROUND(AVG("priceToman"))::int AS average,COUNT(*)::int AS count,
      (ARRAY_AGG(id ORDER BY "priceToman",id))[1] AS "bestOfferId"
    FROM quotes WHERE rn=1 GROUP BY "productId"`);
}
async function offerIds(prisma,id,skip,take){return prisma.$queryRaw(Prisma.sql`WITH quotes AS (${eligible([id])}) SELECT id FROM quotes WHERE rn=1 ORDER BY "priceToman",id OFFSET ${skip} LIMIT ${take}`);}
module.exports={offerStatistics,offerIds};
