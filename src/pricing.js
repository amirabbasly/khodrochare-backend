const VERSION = 'reference-table-v1';
// Toman. Source: the tariff image supplied by the project owner.
const TARIFFS = {
  GROUP_1: { NISSAN: [1600000, 60000], FLATBED: [2000000, 75000] },
  GROUP_2: { NISSAN: [2000000, 75000], FLATBED: [2800000, 100000] },
  GROUP_3: { NISSAN: [2600000, 85000], FLATBED: [4000000, 120000] },
  GROUP_4: { NISSAN: [3000000, 100000], FLATBED: [5000000, 145000] },
  NISSAN_PICKUP: { NISSAN: [2500000, 75000] },
};
function normalize(value) {
  return value.toLowerCase().replace(/[۰-۹٠-٩]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.includes(d) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s\u200c\u200f/_·.،-]+/g, '');
}
const MODELS = {
  NISSAN_PICKUP: ['نیسان آبی', 'نیسان وانت', 'وانت نیسان', 'نیسان یخچال', 'زامیاد', 'nissan pickup'],
  GROUP_5: ['بنز شاسی', 'ب ام و شاسی', 'بی ام و شاسی', 'پرادو 6', 'لندکروز', 'هایلوکس', 'پیکاپ', 'لندروور', 'جیپ', 'سوئد خودرو', 'دوکابین', 'دبلیوگل'],
  GROUP_4: ['بنز سواری', 'بی ام و سواری', 'ب ام و سواری', 'سوناتا', 'کمری', 'سانتافه', 'کیا', 'آزرا', 'اسپورتیج', 'سورنتو', 'توسان', 'هیوندای شاسی', 'لکسوس', 'هایما', 'وایکینگ', 'چانگان', 'فیدلیتی', 'جک شاسی', 'پورشه', 'برلیانس شاسی', 'جنیسیس', 'کوپه', 'ماکسیما', 'اپتیما', 'مورانو', 'کولیوس', 'جیلی شاسی', 'پرادو 4', 'ون', 'سوزوکی', 'ویتارا', 'لندمارک', 'میتسوبیشی', 'camry', 'sonata', 'santa fe'],
  GROUP_3: ['مزدا 3', 'مزدا 2', 'بی وای دی', 'byd', 'مگان', 'اکسنت', 'پژو پارس', 'پارس', 'آریا', 'شاهین', 'سراتو', 'آوانته', 'ام جی سواری', 'کرولا', 'اپل', 'زانتیا', 'سیتروئن', 'لیفان 620', 'آلفارومئو', 'برلیانس', 'سراتو', 'ام وی ام ایکس 22', 'ایکس 22', 'corolla', 'mazda 3', 'mazda 2'],
  GROUP_2: ['مزدا 323', 'سمند سورن', 'سورن', 'ساندرو', 'ال 90', 'l90', 'ام وی ام سواری', 'دنا', 'مزدا وانت', 'وانت مزدا', 'تندر', 'وانا', 'sandero'],
  GROUP_1: ['پژو 404', 'پژو 405', 'پژو 206', 'پژو 207', 'peugeot 206', 'peugeot 207', 'پراید', 'تیبا', 'ساینا', 'آردی', 'آر دی', 'سمند', 'نیسان سواری', 'آردی آی', 'پیکان', 'رانا', 'داتسون', 'مزدا 929', 'دوو', 'کوییک', 'ریو'],
};
// Exact prefix at the model boundary avoids e.g. Mazda 323 matching Mazda 3.
function vehicleGroup(vehicleName) {
  const name = normalize(vehicleName);
  const candidates = Object.entries(MODELS).flatMap(([group, models]) => models.map(model => ({ group, model: normalize(model) })))
    .filter(({ model }) => name.startsWith(model) && !(/^\d/.test(name.slice(model.length)) && /\d$/.test(model)))
    .sort((a, b) => b.model.length - a.model.length);
  return candidates[0]?.group || 'UNLISTED';
}
function quote({ service, vehicleName, distanceMeters = 0, transportKind = 'NISSAN', heavyTraffic = false, rainOrSnow = false, hasExtraLoad = false, tariff, groupOverride, at = new Date() }) {
  if (service === 'REPAIR') return {
    priceToman: 800000, pricingVersion: VERSION,
    pricingBreakdown: { version: VERSION, service, baseToman: 800000, totalToman: 800000, partsIncluded: false, partsPricing: 'AFTER_INSPECTION', requiresAgreement: false },
  };
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) throw new Error('Invalid tariff distance');
  const group = groupOverride || vehicleGroup(vehicleName);
  const pair = tariff ? (transportKind === 'NISSAN' ? [tariff.nissanBaseToman, tariff.nissanPerKmToman] : [tariff.flatbedBaseToman, tariff.flatbedPerKmToman]) : null;
  const rate = tariff === undefined ? TARIFFS[group]?.[transportKind] : pair?.every(Number.isInteger) ? pair : null;
  const version = tariff?.version || VERSION;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', hourCycle: 'h23' }).format(at));
  const night = hour < 6;
  const surchargePercent = (night ? 20 : 0) + (heavyTraffic ? 20 : 0) + (rainOrSnow ? 20 : 0);
  const distanceChargeToman = rate ? Math.round(distanceMeters * rate[1] / 1000) : null;
  const subtotalToman = rate ? rate[0] + distanceChargeToman : null;
  const surchargeToman = rate ? Math.round(subtotalToman * surchargePercent / 100) : null;
  const knownTotalToman = rate ? subtotalToman + surchargeToman : null;
  const requiresAgreement = !rate || hasExtraLoad;
  if (knownTotalToman !== null && (!Number.isSafeInteger(knownTotalToman) || knownTotalToman > 2147483647)) throw new Error('Price exceeds supported range');
  return {
    priceToman: requiresAgreement ? null : knownTotalToman, pricingVersion: version,
    pricingBreakdown: { version, service, vehicleGroup: group, transportKind, distanceMeters, baseToman: rate?.[0] ?? null, perKmToman: rate?.[1] ?? null, distanceChargeToman, subtotalToman, night, heavyTraffic, rainOrSnow, hasExtraLoad, nightSurchargePercent: night ? 20 : 0, trafficSurchargePercent: heavyTraffic ? 20 : 0, weatherSurchargePercent: rainOrSnow ? 20 : 0, surchargePercent, surchargeToman, knownTotalToman, totalToman: requiresAgreement ? null : knownTotalToman, requiresAgreement, agreementReason: !rate ? 'UNPRICED_VEHICLE_OR_TRANSPORT' : hasExtraLoad ? 'EXTRA_LOAD' : null },
  };
}
module.exports = { quote, vehicleGroup, TARIFFS, VERSION, MODELS, normalize };
