const { z } = require('zod');
const { hash, HttpError } = require('../domain');
const digits = s => String(s).replace(/[۰-۹٠-٩]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.includes(d) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const normalize = s => digits(s || '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').normalize('NFKC').replace(/[\s\u200c\u200f،/_.-]+/g, ' ').trim();
const code = s => normalize(s).replace(/[^\p{L}\p{N}]/gu, '');
function money(value, currency) {
  const text = digits(value).replace(/[,٬\s]/g, '');
  if (!/^\d+(?:\.0+)?$/.test(text)) throw new HttpError(400, 'Invalid market price');
  const amount = Number(text);
  if (!['IRR', 'IRT', 'TOMAN'].includes(currency)) throw new HttpError(400, 'Explicit supported currency required');
  const toman = currency === 'IRR' ? amount / 10 : amount;
  if (!Number.isSafeInteger(toman) || toman <= 0 || toman > 2147483647) throw new HttpError(400, 'Invalid market price');
  return toman;
}
function safeUrl(value) {
  let url; try { url = new URL(value); } catch { throw new HttpError(400, 'Invalid market URL'); }
  const h = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !h.includes('.') || /(^|\.)(localhost|local|internal|test|example|invalid)$/.test(h) || /^[\d.:\[\]]+$/.test(h)) throw new HttpError(400, 'Public HTTPS URL required');
  url.hash = ''; return url.href;
}
const httpsUrl = z.string().max(2000).transform(safeUrl);
const condition = z.enum(['NEW', 'REFURBISHED', 'USED']);
const authenticity = z.enum(['GENUINE', 'OEM', 'AFTERMARKET', 'UNKNOWN']);
const fitment = z.object({ maker: z.string().min(1).max(80), model: z.string().min(1).max(100), trim: z.string().min(1).max(100), yearFrom: z.number().int().min(1300).max(2200), yearTo: z.number().int().min(1300).max(2200) }).strict().refine(v => v.yearFrom <= v.yearTo && ((v.yearFrom < 1800) === (v.yearTo < 1800)), 'Invalid fitment year range');
const partFields = {
  name: z.string().trim().min(3).max(250), englishName: z.string().max(250).optional(), brand: z.string().trim().min(1).max(100), category: z.string().min(1).max(80), partNumber: z.string().max(100).optional(), oemNumber: z.string().max(100).optional(),
  condition, authenticity, country: z.string().max(100).optional(), description: z.string().max(8000).default(''), images: z.array(httpsUrl).max(12).default([]), specifications: z.record(z.string().max(100), z.string().max(500)).default({}), fitments: z.array(fitment).max(100).default([]),
};
const productSchema = z.object(partFields).strict();
const listingSchema = z.object({ ...partFields, externalId: z.string().min(1).max(250), url: httpsUrl, currency: z.enum(['IRR', 'IRT', 'TOMAN']), price: z.union([z.string().max(50), z.number()]), shipping: z.union([z.string().max(50), z.number()]).nullable().optional(), inStock: z.boolean(), quantity: z.number().int().nonnegative().optional(), seller: z.object({ externalId: z.string().min(1).max(250), name: z.string().min(1).max(150), url: httpsUrl, logo: httpsUrl.optional() }).strict() }).strict();
const sourceSchema = z.object({ name: z.string().min(2).max(150), kind: z.enum(['TOROB', 'DIVAR', 'DIGIKALA', 'SPECIALIST', 'INDEPENDENT', 'SUPPLIER']), adapter: z.string().min(1).max(80).refine(value=>Object.hasOwn(require('./adapters'),value),'Unknown market adapter'), baseUrl: httpsUrl, allowedHosts: z.array(z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/)).min(1).max(30), config: z.object({ path: z.string().startsWith('/').max(1000), currency: z.enum(['IRR', 'IRT', 'TOMAN']).optional(), category: z.string().max(80).optional(), automaticPublication: z.boolean().default(true) }).strict(), secretEnv: z.string().regex(/^MARKET_SECRET_[A-Z0-9_]+$/).nullable().default(null), licenseUrl: httpsUrl.nullable().default(null), permissionExpiresAt: z.iso.datetime().nullable().default(null), active: z.boolean().default(false), intervalMinutes: z.number().int().min(15).max(43200).default(360), minDelayMs: z.number().int().min(1000).max(60000).default(3000), maxPages: z.number().int().min(1).max(1000).default(25), offerTtlHours: z.number().int().min(1).max(168).default(24) }).strict();
function validateSource(input) {
  const s = sourceSchema.parse(input);
  if (!s.allowedHosts.includes(new URL(s.baseUrl).hostname) || new URL(s.config.path, s.baseUrl).origin !== new URL(s.baseUrl).origin) throw new HttpError(400, 'Source origin must be allowlisted');
  for(const url of [new URL(s.baseUrl),new URL(s.config.path,s.baseUrl)])if([...url.searchParams.keys()].some(k=>/^(api_?key|access_?token|token|password|secret|consumer_(key|secret))$/i.test(k)))throw new HttpError(400,'Credentials belong in environment, not source URL');
  if (s.active && (!s.licenseUrl || !s.permissionExpiresAt || Date.parse(s.permissionExpiresAt) <= Date.now())) throw new HttpError(400, 'An unexpired source permission is required');
  return s;
}
function fitmentSignature(fitments) { return [...new Set(fitments.map(f => `${normalize(f.maker)}|${normalize(f.model)}|${normalize(f.trim)}|${f.yearFrom}|${f.yearTo}`))].sort().join(';'); }
function specificationsSignature(specifications) { return Object.entries(specifications).map(([k,v]) => [normalize(k), normalize(v)]).sort(([a],[b]) => a.localeCompare(b)).map(p => p.join('=')).join(';'); }
function identity(product) { return hash(JSON.stringify([normalize(product.brand), product.category, code(product.partNumber), code(product.oemNumber), product.condition, product.authenticity, fitmentSignature(product.fitments), specificationsSignature(product.specifications), (product.partNumber||product.oemNumber)?null:normalize(product.name)])); }
function match(listing, product) {
  const reasons = [];
  const brand = product.brand?.name || product.brand;
  const category = product.category?.slug || product.category;
  if (normalize(listing.brand) !== normalize(brand)) reasons.push('BRAND_CONFLICT');
  if (listing.category !== category) reasons.push('CATEGORY_CONFLICT');
  if (listing.condition !== product.condition) reasons.push('CONDITION_CONFLICT');
  if (listing.authenticity === 'UNKNOWN' || listing.authenticity !== product.authenticity) reasons.push('AUTHENTICITY_UNCERTAIN');
  const signature = product.fitmentSignature ?? fitmentSignature(product.fitments || []);
  if (!signature || signature !== fitmentSignature(listing.fitments)) reasons.push('FITMENT_CONFLICT_OR_MISSING');
  if (specificationsSignature(listing.specifications) !== specificationsSignature(product.specifications || {})) reasons.push('SPECIFICATIONS_CONFLICT');
  if (listing.partNumber && product.partNumber && code(listing.partNumber) !== code(product.partNumber)) reasons.push('PART_NUMBER_CONFLICT');
  if (listing.oemNumber && product.oemNumber && code(listing.oemNumber) !== code(product.oemNumber)) reasons.push('OEM_CONFLICT');
  const exactCode = !!((listing.partNumber && product.partNumber && code(listing.partNumber) === code(product.partNumber)) || (listing.oemNumber && product.oemNumber && code(listing.oemNumber) === code(product.oemNumber)));
  const a = new Set(normalize(listing.name).split(' ')), b = new Set(normalize(product.name).split(' '));
  const similarity = [...a].filter(w => b.has(w)).length / Math.max(1, new Set([...a,...b]).size);
  const score = reasons.length ? Math.min(59, Math.round(similarity * 50)) : exactCode ? 100 : Math.round(60 + similarity * 29);
  return { score, auto: exactCode && reasons.length === 0, reasons: [...reasons, ...(exactCode ? ['EXACT_CODE'] : ['NO_EXACT_CODE']), ...(listing.images.some(i => product.images?.includes(i)) ? ['SHARED_IMAGE_NON_AUTHORITATIVE'] : [])] };
}
function compare(offers) {
  if (!offers.length) return { min: null, max: null, average: null, spreadPercent: 0 };
  const prices = offers.map(o => o.priceToman), min = Math.min(...prices), max = Math.max(...prices), average = Math.round(prices.reduce((a,b) => a+b, 0)/prices.length);
  return { min, max, average, spreadPercent: Math.round((max-min)/average*100) };
}
function deal({ offers = [], summary, previousLow, seller }) {
  const stats = summary || compare(offers);
  if (!stats.min || (summary?.count ?? offers.length) < 2 || !seller?.verified || seller.reputation < 60) return { score: 0, dropPercent: 0 };
  const belowMarket = Math.max(0, (stats.average-stats.min)/stats.average*100);
  const dropPercent = previousLow && previousLow > stats.min ? Math.floor((previousLow-stats.min)/previousLow*100) : 0;
  return { score: Math.min(100, Math.round(belowMarket + Math.min(40, dropPercent) + seller.reputation/5)), dropPercent };
}
module.exports = { normalize, code, money, safeUrl, httpsUrl, productSchema, listingSchema, sourceSchema, validateSource, fitmentSignature, identity, match, compare, deal };
