const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cookieToken, setSessionCookie, clearSessionCookie } = require('../src/session-cookies');
const { createServices } = require('../src/services');
test('cookie authentication selects roles independently', () => {
  const header = 'khodrochare_customer_session=customer; khodrochare_driver_session=driver';
  assert.equal(cookieToken(header, 'CUSTOMER'), 'customer');
  assert.equal(cookieToken(header, 'DRIVER'), 'driver');
  assert.equal(cookieToken(header, undefined), undefined);
});
test('persistent cookies are HttpOnly Secure SameSite=Lax, and remember=false stays a browser session', () => {
  let saved;
  const res = { cookie: (name, token, options) => { saved = { name, token, options }; }, clearCookie: name => { saved = { name }; } };
  const session = { token: 'a'.repeat(64), user: { role: 'DRIVER' }, expiresAt: new Date('2027-01-20') };
  setSessionCookie(res, session, { NODE_ENV: 'production' });
  assert.equal(saved.name, 'khodrochare_driver_session');
  assert.equal(saved.options.httpOnly, true); assert.equal(saved.options.secure, true); assert.equal(saved.options.sameSite, 'lax');
  assert.equal(saved.options.expires, session.expiresAt);
  setSessionCookie(res, session, { NODE_ENV: 'production' }, false);
  assert.equal(saved.options.expires, undefined);
  clearSessionCookie(res, 'DRIVER', { NODE_ENV: 'production' });
  assert.equal(saved.name, 'khodrochare_driver_session');
});
test('active server sessions renew without allowing expired sessions to revive', async () => {
  const user = { id: 'driver', role: 'DRIVER' };
  let renewed = false;
  const prisma = { session: { findUnique: async () => ({ user, expiresAt: new Date(Date.now() + 86400000) }), update: async () => { renewed = true; } } };
  const services = createServices({ prisma, config: { SESSION_DAYS: 90 } });
  const result = await services.authenticateSession('a'.repeat(64));
  assert.equal(result.user, user); assert.equal(renewed, true);
  assert.ok(result.expiresAt > new Date(Date.now() + 89 * 86400000));
  renewed = false;
  prisma.session.findUnique = async () => ({ user, expiresAt: new Date(0) });
  await assert.rejects(services.authenticateSession('a'.repeat(64)), { status: 401 });
  assert.equal(renewed, false);
});

test('HTTP login issues a cookie, cookie-only requests authenticate, roles stay separate and logout revokes it', async () => {
  const http = require('node:http');
  const { createApp } = require('../src/app');
  const { hashPassword } = require('../src/domain');
  const sessions = new Map();
  const user = { id: 'customer', role: 'CUSTOMER', phone: '09121234567', fullName: 'Test User', passwordHash: await hashPassword('password123') };
  const prisma = {
    user: { findUnique: async () => user },
    session: {
      create: async ({ data }) => { sessions.set(data.tokenHash, data); return data; },
      findUnique: async ({ where }) => { const found = sessions.get(where.tokenHash); return found ? { ...found, user } : null; },
      deleteMany: async ({ where }) => sessions.delete(where.tokenHash),
    },
  };
  const config = { NODE_ENV: 'production', TRUST_PROXY: 0, SESSION_DAYS: 90, origins: ['https://app.example'], UPLOAD_DIR: './uploads' };
  const redis = { eval: async () => 1 };
  const io = { in: () => ({ disconnectSockets() {} }) };
  const services = createServices({ prisma, config, redis, io });
  const server = http.createServer(createApp({ prisma, config, redis, io, services }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const login = await fetch(base + '/auth/customers/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example' }, body: JSON.stringify({ phone: user.phone, password: 'password123' }) });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('access-control-allow-credentials'), 'true');
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const headers = { Cookie: cookie, 'X-App-Role': 'CUSTOMER' };
    const me = await fetch(base + '/me', { headers });
    assert.equal(me.status, 200); assert.ok(me.headers.get('x-session-expires-at'));
    assert.equal((await me.json()).passwordHash, undefined);
    assert.equal((await fetch(base + '/me', { headers: { Cookie: cookie, 'X-App-Role': 'DRIVER' } })).status, 401);
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers })).status, 204);
    assert.equal((await fetch(base + '/me', { headers })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
