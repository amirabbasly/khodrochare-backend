const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
test('HTTP role separation, validation, private files and safe errors', async t => {
  t.mock.method(console, 'error', () => {});
  const app = createApp({
    config: { TRUST_PROXY: 0, origins: ['https://app.example'], UPLOAD_DIR: './uploads' },
    redis: { eval: async () => 1, ping: async () => 'PONG' },
    prisma: { $queryRaw: async () => [{ ok: 1 }], document: { findFirst: async () => null }, user: { findUnique: async () => { throw new Error('secret database password'); } } },
    io: {},
    services: { authenticate: async token => {
      if (!['customer', 'driver'].includes(token)) throw Object.assign(new Error('Authentication required'), { status: 401 });
      return { id: token, role: token === 'customer' ? 'CUSTOMER' : 'DRIVER' };
    } },
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, options = {}) => fetch(base + route, options);
  const headers = { Authorization: 'Bearer customer', 'Content-Type': 'application/json', Origin: 'https://app.example' };
  try {
    assert.equal((await call('/health/ready')).status, 200);
    assert.equal((await call('/api/v1/me')).status, 401);
    assert.equal((await call('/api/v1/drivers/location', { method: 'PUT', headers, body: '{}' })).status, 403);
    assert.equal((await call('/api/v1/requests/repair', { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await call('/api/v1/requests/towing', { method: 'POST', headers: { ...headers, Authorization: 'Bearer driver' }, body: '{}' })).status, 403);
    assert.equal((await call('/api/v1/documents/not-mine', { headers })).status, 404);
    assert.equal((await call('/uploads/test.png')).status, 404);
    const invalidJson = await call('/api/v1/requests/repair', { method: 'POST', headers, body: '{' });
    assert.equal(invalidJson.status, 400);
    const error = await call('/api/v1/me', { headers });
    assert.equal(error.status, 500);
    assert.deepEqual(await error.json(), { error: 'Internal server error' });
    const services = await call('/api/v1/services', { headers });
    assert.equal(services.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.equal((await services.json()).services.length, 5);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
