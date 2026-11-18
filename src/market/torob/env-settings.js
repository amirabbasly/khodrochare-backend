const { z } = require('zod');
const { hash } = require('../../domain');
const { torobUrl } = require('./urls');

const integer = (min, max) => z.number().int().min(min).max(max);
const sourceSchema = z.object({
  name: z.string().trim().min(2).max(150), url: z.string().url(),
  category: z.string().min(2).max(80).default('auto-parts'), active: z.boolean().default(true),
  intervalMinutes: integer(15, 43200).optional(), maxScrolls: integer(1, 10000).optional(),
  maxProducts: integer(1, 100000).optional(), scrollWaitMs: integer(1500, 10000).optional(),
  idleRounds: integer(3, 30).optional(),
}).strict();
const ruleSchema = z.object({
  name: z.string().min(3).max(150), category: z.string().min(2).max(80),
  carKeys: z.array(z.string().max(300)).min(1).max(100),
  requirements: z.record(z.string().max(80), z.union([z.string().max(100), z.number()])),
  evidenceUrl: z.string().url(), verified: z.boolean(),
  checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict();
function jsonArray(value, name, schema) {
  try { return z.array(schema).max(1000).parse(JSON.parse(value)); }
  catch { throw new Error(`${name}_INVALID`); }
}
function readSettings(config) {
  const defaults = {
    intervalMinutes: config.TOROB_INTERVAL_MINUTES ?? 360,
    maxScrolls: config.TOROB_MAX_SCROLLS ?? 1000,
    maxProducts: config.TOROB_MAX_PRODUCTS ?? 10000,
    scrollWaitMs: config.TOROB_SCROLL_WAIT_MS ?? 2000,
    idleRounds: config.TOROB_IDLE_ROUNDS ?? 8,
  };
  const entries = config.TOROB_SOURCES_JSON === undefined
    ? [{ name: 'Torob initial category', url: config.TOROB_INITIAL_CATEGORY_URL || 'https://torob.com/browse/541/', category: 'auto-parts', active: true }]
    : jsonArray(config.TOROB_SOURCES_JSON, 'TOROB_SOURCES_JSON', sourceSchema);
  const ids = new Set();
  const sources = entries.map(entry => {
    const input = sourceSchema.parse(entry), seed = torobUrl(input.url, 'browse');
    if (ids.has(seed.id)) throw new Error('TOROB_DUPLICATE_CATEGORY');
    ids.add(seed.id);
    const { name, url, ...settings } = input;
    return { ...defaults, ...settings, query: name, seedUrl: seed.url, key: hash('torob-browse:' + seed.id), active: config.TOROB_ENABLED !== false && input.active };
  });
  const rules = config.TOROB_COMPATIBILITY_RULES_JSON === undefined ? null
    : jsonArray(config.TOROB_COMPATIBILITY_RULES_JSON, 'TOROB_COMPATIBILITY_RULES_JSON', ruleSchema);
  const names = new Set();
  for (const rule of rules || []) {
    if (names.has(rule.name)) throw new Error('TOROB_DUPLICATE_RULE_NAME');
    names.add(rule.name);
    if (!rule.evidenceUrl.startsWith('https://') || Date.parse(rule.expiresAt) <= Date.now() || Date.parse(rule.checkedAt) > Date.now() + 60000) throw new Error('TOROB_RULE_INVALID_EVIDENCE');
    if (rule.verified && rule.category === 'batteries' && !['capacityAh', 'voltage', 'caseCode', 'polarity', 'technology', 'lengthMm', 'widthMm', 'heightMm'].every(k => rule.requirements[k] != null)) throw new Error('TOROB_RULE_INCOMPLETE_BATTERY_SPECIFICATIONS');
  }
  return { sources, rules };
}
async function syncSettings(prisma, settings) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('torob-env-settings'))::text AS locked`;
    // Validate every entry before changing an existing source or rule.
    for (const source of settings.sources) {
      if (!await tx.marketCategory.findUnique({ where: { slug: source.category } })) throw new Error('TOROB_ENV_UNKNOWN_CATEGORY');
    }
    for (const rule of settings.rules || []) {
      const keys = [...new Set(rule.carKeys)];
      if (!await tx.marketCategory.findUnique({ where: { slug: rule.category } })) throw new Error('TOROB_ENV_UNKNOWN_CATEGORY');
      if (await tx.marketCar.count({ where: { key: { in: keys } } }) !== keys.length) throw new Error('TOROB_ENV_UNKNOWN_CAR_KEY');
    }
    // Keep rows, products and histories. Only retire sources omitted from the env list.
    await tx.marketDiscoveryQuery.updateMany({ where: { seedUrl: { not: null }, active: true, key: { notIn: settings.sources.map(s => s.key) } }, data: { active: false, status: 'CANCELLED', generation: { increment: 1 } } });
    for (const data of settings.sources) {
      const previous = await tx.marketDiscoveryQuery.findUnique({ where: { key: data.key } });
      const changed = previous && Object.entries(data).some(([k, v]) => previous[k] !== v);
      await tx.marketDiscoveryQuery.upsert({
        where: { key: data.key }, create: { ...data, status: data.active ? 'QUEUED' : 'CANCELLED' },
        // An unchanged restart must preserve a source's cooldown and progress.
        update: changed ? { ...data, generation: { increment: 1 }, status: data.active ? 'QUEUED' : 'CANCELLED', nextRunAt: new Date(), lastError: null } : {},
      });
    }
    if (settings.rules !== null) {
      await tx.marketCompatibilityRule.updateMany({ where: { name: { notIn: settings.rules.map(r => r.name) }, verified: true }, data: { verified: false } });
      for (const rule of settings.rules) {
        const data = { ...rule, checkedAt: new Date(rule.checkedAt), expiresAt: new Date(rule.expiresAt) };
        const old = await tx.marketCompatibilityRule.findFirst({ where: { name: rule.name }, orderBy: { id: 'asc' } });
        if (old) {
          await tx.marketCompatibilityRule.update({ where: { id: old.id }, data });
          await tx.marketCompatibilityRule.updateMany({ where: { name: rule.name, id: { not: old.id } }, data: { verified: false } });
        } else await tx.marketCompatibilityRule.create({ data });
      }
    }
    return { configured: settings.sources.length, active: settings.sources.filter(s => s.active).length, rules: settings.rules?.length ?? null };
  }, { timeout: 60000 });
}
module.exports = { readSettings, syncSettings };
