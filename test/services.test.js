const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../src/services');
test('sessions reject malformed, unknown and expired credentials', async () => {
  const prisma = { session: { findUnique: async () => null } };
  const s = createServices({ prisma });
  await assert.rejects(s.authenticate('bad'), { status: 401 });
  await assert.rejects(s.authenticate('a'.repeat(64)), { status: 401 });
  prisma.session.findUnique = async () => ({ expiresAt: new Date(0), user: {} });
  await assert.rejects(s.authenticate('a'.repeat(64)), { status: 401 });
});
test('request ownership hides other customers and unassigned requests from drivers', async () => {
  const request = { customerId: 'customer', driverId: 'driver' };
  const s = createServices({ prisma: { assistanceRequest: { findUnique: async () => request } } });
  await assert.rejects(s.ownedRequest('id', { id: 'stranger' }), { status: 404 });
  assert.equal(await s.ownedRequest('id', { id: 'driver' }), request);
});
test('GPS rejects customer updates, stale timestamps and reordered updates', async () => {
  const s = createServices({ prisma: { $queryRaw: async () => [] }, config: { LOCATION_MAX_AGE_SECONDS: 120 } });
  await assert.rejects(s.updateLocation({ role: 'CUSTOMER' }, {}), { status: 403 });
  await assert.rejects(s.updateLocation({ role: 'DRIVER' }, { recordedAt: new Date(0).toISOString() }), { status: 400 });
  await assert.rejects(s.updateLocation({ role: 'DRIVER' }, { recordedAt: new Date().toISOString() }), { status: 409 });
});
test('stale GPS is hidden and fresh distance comes from PostGIS', async () => {
  const prisma = { driverLocation: { findUnique: async () => ({ recordedAt: new Date(0) }) }, $queryRaw: async () => [{ meters: 123.7 }] };
  const s = createServices({ prisma, config: { LOCATION_MAX_AGE_SECONDS: 120 } });
  assert.deepEqual(await s.tracking({ driverId: 'd' }), { driver: null, stale: true });
  prisma.driverLocation.findUnique = async () => ({ latitude: 35, longitude: 51, recordedAt: new Date() });
  assert.equal((await s.tracking({ driverId: 'd', originLat: 35.1, originLng: 51.1 })).distanceToOriginMeters, 124);
});
test('unavailable road routing fails explicitly instead of charging straight-line price', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  try {
    const s = createServices({ redis: { get: async () => null }, config: { DISTANCE_MODE: 'road', OSRM_URL: 'https://routing.invalid' } });
    await assert.rejects(s.distance({ longitude: 51, latitude: 35 }, { longitude: 52, latitude: 36 }, true), { status: 503 });
  } finally { global.fetch = oldFetch; }
});
