// Read-only diagnostics. Never prints database/Redis credentials or mutates queues.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    const now = new Date();
    const activeRef = { source: 'TOROB', productId: { not: null }, suspicious: false, expiresAt: { gt: now }, results: { some: { query: { active: true, seedUrl: { not: null } } } } };
    const [storedProducts, torobProducts, publishedProducts, sources, links, availableOffers, cars] = await Promise.all([
      prisma.marketProduct.count(),
      prisma.marketReferencePrice.count({ where: { source: 'TOROB', productId: { not: null } } }),
      prisma.marketProduct.count({ where: { active: true, brand: { active: true }, category: { active: true }, torobReference: { is: activeRef } } }),
      prisma.marketDiscoveryQuery.findMany({ where: { seedUrl: { not: null } }, select: { id: true, query: true, seedUrl: true, active: true, status: true, generation: true, lastError: true, nextRunAt: true, fetchedAt: true } }),
      prisma.torobCrawlLink.groupBy({ by: ['queryId', 'generation', 'status'], _count: true }),
      prisma.torobOffer.count({ where: { available: true, expiresAt: { gt: now } } }),
      prisma.marketCar.findMany({ select: { key: true, maker: true, model: true, trim: true }, orderBy: { key: 'asc' } }),
    ]);
    const queues = {};
    for (const name of ['torob-browse-v2', 'torob-product-v2']) {
      const prefix = 'bull:' + name + ':';
      queues[name] = {
        waiting: await redis.llen(prefix + 'wait'), active: await redis.llen(prefix + 'active'),
        paused: await redis.llen(prefix + 'paused'), delayed: await redis.zcard(prefix + 'delayed'),
        failed: await redis.zcard(prefix + 'failed'), completed: await redis.zcard(prefix + 'completed'),
      };
    }
    console.log(JSON.stringify({ time: now, storedProducts, torobProducts, publishedProducts, availableOffers,
      workerHeartbeat: await redis.get('market:worker-heartbeat'),
      backoffSeconds: Math.max(0, Math.ceil(await redis.pttl('market:backoff:torob-native') / 1000)),
      sources, links, queues, ...(process.argv.includes('--cars') ? { cars } : { vehicleCount: cars.length }),
    }, null, 2));
  } finally { await prisma.$disconnect(); await redis.quit(); }
}
main().catch(error => { console.error(error.code || error.name, 'Market status failed; check database and Redis connectivity.'); process.exitCode = 1; });
