const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/domain');

async function fixture(t, overrides = {}) {
  const values = new Map();
  const redis = { eval: async () => 1, get: async key => values.get(key) ?? null, set: async (key, value) => values.set(key, value), del: async key => values.delete(key) };
  const config = { TRUST_PROXY: 0, origins: [], LOCATION_MAX_AGE_SECONDS: 120, ADMIN_USERNAME: 'observer', ADMIN_PASSWORD_HASH: await hashPassword('test-password') };
  const prisma = overrides.prisma || {};
  const services = { authenticate: async token => {
    if (!['customer', 'driver', 'other-driver'].includes(token)) throw Object.assign(new Error('Authentication required'), { status: 401 });
    return { id: token, role: token === 'customer' ? 'CUSTOMER' : 'DRIVER' };
  }, ...overrides.services };
  const server = http.createServer(createApp({ prisma, redis, config, services, io: {} }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (route, method = 'GET', body, token) => fetch(`http://127.0.0.1:${server.address().port}/api/v1${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, values, config };
}
test('admin login is isolated, read-only, revocable and uses fresh/stale GPS with private fields excluded', async t => {
  const user = { id: 'driver', role: 'DRIVER', fullName: 'Test', services: [], telemetry: { latitude: 35, longitude: 51, province: 'Tehran', recordedAt: new Date(Date.now()-180000) }, location: null };
  const prisma = { user: { findMany: async ({ select }) => { assert.equal(select.passwordHash, undefined); assert.equal(select.nationalId, undefined); return [user]; }, count: async () => 1 }, assistanceRequest: { findMany: async () => [], count: async () => 0, groupBy: async () => [] }, payment: { groupBy: async () => [] }, driverEarning: { aggregate: async () => ({ _sum: {} }) }, $queryRaw: async () => [] };
  const { call } = await fixture(t, { prisma });
  assert.equal((await call('/admin/overview')).status, 401);
  assert.equal((await call('/admin/overview', 'GET', undefined, 'customer')).status, 401);
  assert.equal((await call('/admin/session', 'POST', { username: 'observer', password: 'wrong' })).status, 401);
  const response = await call('/admin/session', 'POST', { username: 'observer', password: 'test-password' });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  const overview = await call('/admin/overview', 'GET', undefined, token);
  assert.equal(overview.headers.get('cache-control'), 'no-store');
  const data = await overview.json();
  assert.equal(data.people[0].location.fresh, false);
  assert.equal(data.people[0].province, 'Tehran');
  assert.equal(data.people[0].telemetry, undefined);
  assert.equal((await call('/admin/users/driver', 'PATCH', {}, token)).status, 404);
  assert.equal((await call('/requests/a/status', 'PATCH', { status: 'COMPLETED' }, token)).status, 401);
  assert.equal((await call('/admin/session', 'DELETE', undefined, token)).status, 204);
  assert.equal((await call('/admin/overview', 'GET', undefined, token)).status, 401);
});
test('telemetry rejects unauthenticated, stale and invalid coordinates without geocoding them', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/me/location', 'PUT', {})).status, 401);
  assert.equal((await call('/me/location', 'PUT', { latitude: 91, longitude: 51, recordedAt: new Date().toISOString() }, 'customer')).status, 400);
  assert.equal((await call('/me/location', 'PUT', { latitude: 35, longitude: 51, recordedAt: new Date(Date.now()-180000).toISOString() }, 'customer')).status, 400);
});
test('repair operations require approved parts; completion cannot claim unverified payment', async t => {
  let request = { id: 'a', customerId: 'customer', driverId: 'driver', service: 'REPAIR', status: 'ARRIVED', partsApprovedToman: null, operationsStartedAt: null, payment: { status: 'SUBMITTED' } };
  const tx = { $queryRaw: async () => [], assistanceRequest: { findUnique: async () => request, update: async ({ data }) => (request = { ...request, ...data }), updateMany: async ({ data }) => { request = { ...request, ...data }; return { count: 1 }; } }, outbox: { create: async () => {} }, driverEarning: { createMany: async () => {} } };
  const { call } = await fixture(t, { prisma: { $transaction: async fn => fn(tx) }, services: { ownedRequest: async () => request } });
  assert.equal((await call('/requests/a/operations/start', 'POST', undefined, 'other-driver')).status, 404);
  assert.equal((await call('/requests/a/operations/start', 'POST', undefined, 'customer')).status, 403);
  assert.equal((await call('/requests/a/operations/start', 'POST', undefined, 'driver')).status, 409);
  request.partsApprovedToman = 0;
  assert.equal((await call('/requests/a/operations/start', 'POST', undefined, 'driver')).status, 200);
  assert.ok(request.operationsStartedAt);
  assert.equal((await call('/requests/a/status', 'PATCH', { status: 'COMPLETED' }, 'driver')).status, 409);
  request.payment = { id: 'p', status: 'VERIFIED', driverShareToman: 560000, commissionToman: 240000 };
  assert.equal((await call('/requests/a/status', 'PATCH', { status: 'COMPLETED' }, 'driver')).status, 200);
});
