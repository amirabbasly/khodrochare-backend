const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog } = require('../src/catalog');
const { addressFeature, createGeocoder } = require('../src/geocoding');
const { createServices } = require('../src/services');
const { normalize } = require('../src/pricing');
function memoryRedis() {
  const values = new Map();
  return { values, get: async key => values.get(key) || null, set: async (key, value) => { values.set(key, value); } };
}
test('database catalog matches Persian digits and prevents Mazda 323 matching Mazda 3', async () => {
  const models = ['مزدا 3', 'مزدا 323'].map((name, index) => ({ id: String(index), name, normalizedName: normalize(name), aliases: [normalize(name).replace('مزدا', '')], group: { version: 'db-v2' } }));
  const catalog = createCatalog({ vehicleModel: { findMany: async () => models, findUnique: async ({ where }) => models.find(m => m.id === where.id) } });
  assert.equal((await catalog.resolve('مزدا ۳۲۳')).name, 'مزدا 323');
  assert.equal((await catalog.resolve('۳')).name, 'مزدا 3');
  await assert.rejects(catalog.resolve('anything', 'missing'), { status: 400 });
  assert.equal(await catalog.resolve('خودروی ناشناخته'), null);
});
test('address labels contain city and street; country and malformed geometry are rejected', () => {
  const feature = { properties: { countrycode: 'IR', city: 'تهران', street: 'خیابان ولیعصر', housenumber: '25' }, geometry: { coordinates: [51.4, 35.7] } };
  const result = addressFeature(feature);
  assert.equal(result.label, 'تهران، خیابان ولیعصر');
  assert.equal(result.longitude, 51.4); assert.equal(result.latitude, 35.7);
  assert.equal(addressFeature({ ...feature, properties: { ...feature.properties, countrycode: 'DE' } }), null);
  assert.equal(addressFeature({ properties: {}, geometry: {} }), null);
});
test('forward search caches trusted selections and refreshes expired selection cache', async t => {
  const redis = memoryRedis();
  let calls = 0;
  t.mock.method(global, 'fetch', async url => {
    calls++;
    assert.equal(url.searchParams.get('countrycode'), 'IR');
    assert.equal(url.searchParams.get('layer'), 'street');
    return { ok: true, json: async () => ({ features: [{ properties: { countrycode: 'IR', city: 'تهران', name: 'آزادی' }, geometry: { coordinates: [51.3, 35.7] } }] }) };
  });
  const geocoder = createGeocoder({ redis, config: { PHOTON_URL: 'https://geocoder.example' } });
  const [place] = await geocoder.search('تهران آزادی');
  assert.equal((await geocoder.resolve(place.id)).label, 'تهران، آزادی');
  redis.values.delete(`place:${place.id}`);
  await geocoder.search('تهران آزادی');
  assert.equal(calls, 1);
  assert.ok(await geocoder.resolve(place.id));
  await assert.rejects(geocoder.resolve('missing'), { status: 400 });
});
test('provider failure does not create invented coordinates or addresses', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: false }));
  const geocoder = createGeocoder({ redis: memoryRedis(), config: {} });
  await assert.rejects(geocoder.search('تهران'), { status: 503 });
});
test('towing snapshots canonical database model, database rates and cached addresses instead of client guesses', async () => {
  const redis = memoryRedis();
  for (const [id, latitude, label] of [['a', 35.7, 'تهران، ولیعصر'], ['b', 35.8, 'تهران، آزادی']]) await redis.set(`place:${id.repeat(64)}`, JSON.stringify({ latitude, longitude: 51.4, label }));
  let saved;
  const tx = { assistanceRequest: { create: async ({ data }) => { saved = data; return { id: 'request', ...data }; } }, $executeRaw: async () => 1, outbox: { create: async () => {} } };
  const prisma = { vehicleModel: { findUnique: async () => ({ id: 'model', name: 'پژو 206', groupId: 'GROUP_1', group: { version: 'custom-db-rate', nissanBaseToman: 100000, nissanPerKmToman: 10000 } }) }, $queryRaw: async () => [{ meters: 1000 }], $transaction: callback => callback(tx) };
  const s = createServices({ prisma, redis, config: { DISTANCE_MODE: 'geodesic' } });
  await s.createRequest({ id: 'customer' }, { vehicleModelId: 'model', vehicleName: 'fake name', vehiclePlate: '12ب34567', origin: { latitude: 0, longitude: 0 }, destination: { latitude: 0, longitude: 0 }, originPlaceId: 'a'.repeat(64), destinationPlaceId: 'b'.repeat(64), transportKind: 'NISSAN' }, 'TOWING');
  assert.equal(saved.vehicleName, 'پژو 206'); assert.equal(saved.vehicleModelId, 'model');
  assert.equal(saved.originLat, 35.7); assert.equal(saved.originAddress, 'تهران، ولیعصر');
  assert.equal(saved.destinationAddress, 'تهران، آزادی');
  assert.equal(saved.pricingVersion, 'custom-db-rate');
  assert.equal(saved.pricingBreakdown.baseToman, 100000);
  assert.equal(saved.pricingBreakdown.perKmToman, 10000);
});
