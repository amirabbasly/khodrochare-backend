const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { PrismaClient } = require('@prisma/client');
const { createNiazpardaz, OTP_TEMPLATE } = require('../src/niazpardaz');
const { createApp } = require('../src/app');
const { createServices } = require('../src/services');
const { createCustomerAuth } = require('../src/customer-auth');
const { hashPassword, verifyPassword } = require('../src/domain');

test('Niazpardaz uses the official SDK contract, service sender and exact approved text; provider errors are never success', async () => {
  const calls = [];
  const provider = createNiazpardaz({ NIAZPARDAZ_API_KEY: ' server-secret ' }, (key, options) => {
    assert.equal(key, 'server-secret'); assert.equal(options.timeout, 10000);
    return { send: async (...args) => { calls.push(args); return { resultCode: 0, batchSmsId: 1234 }; } };
  });
  await provider.sendCode('09121234567', '123456');
  assert.deepEqual(calls, [['10009611', '09121234567', OTP_TEMPLATE.replace('{code}', '123456')]]);
  for (const result of [{ resultCode: 18, batchSmsId: 0 }, { resultCode: 0, batchSmsId: 0 }]) {
    await assert.rejects(createNiazpardaz({ NIAZPARDAZ_API_KEY: 'secret' }, () => ({ send: async () => result })).sendCode('09121234567', '123456'), { status: 503 });
  }
  await assert.rejects(createNiazpardaz({}).sendCode('09121234567', '123456'), { status: 503 });
});

test('real migration, Prisma and HTTP: phone-only registration, one-time OTP, deferred identity, password recovery and driver isolation', { timeout: 120000 }, async () => {
  const db = await PGlite.create(); const tcp = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
  let prisma, server;
  try {
    await db.exec(`CREATE TYPE "Role" AS ENUM ('CUSTOMER','DRIVER');
      CREATE TYPE "Service" AS ENUM ('REPAIR','TOWING','MOBILE_CARWASH','PERIODIC_SERVICE','INSPECTION');
      CREATE TABLE "User" (id TEXT PRIMARY KEY,role "Role" NOT NULL,"fullName" TEXT NOT NULL,phone TEXT NOT NULL,"nationalId" TEXT NOT NULL,"passwordHash" TEXT NOT NULL,"vehiclePlate" TEXT,"vehicleType" TEXT,services "Service"[] NOT NULL DEFAULT '{}',"identityDocumentId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(role,phone),UNIQUE(role,"nationalId"));
      CREATE TABLE "Session" (id TEXT PRIMARY KEY,"tokenHash" TEXT UNIQUE NOT NULL,"userId" TEXT NOT NULL REFERENCES "User"(id),"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE "Vehicle" (id TEXT PRIMARY KEY,"userId" TEXT NOT NULL,name TEXT NOT NULL,plate TEXT NOT NULL,"catalogCarId" TEXT,"productionYear" INTEGER,mileage INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "Document" (id TEXT PRIMARY KEY,"mimeType" TEXT NOT NULL,"ownerId" TEXT,"vehicleId" TEXT);
    `);
    await db.exec(await readFile(path.join(__dirname, '../prisma/migrations/202611220001_customer_otp/migration.sql'), 'utf8'));
    await assert.rejects(db.query(`INSERT INTO "User"(id,role,"fullName",phone,services) VALUES ('invalid-driver','DRIVER','Driver','09120000000','{}')`), /User_driver_credentials_required/);
    await tcp.start();
    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@${tcp.getServerConn()}/postgres?schema=public&connection_limit=1&sslmode=disable` } }, transactionOptions: { timeout: 20000, maxWait: 20000 } });
    const oldHash = await hashPassword('password123');
    const driver = await prisma.user.create({ data: { role: 'DRIVER', fullName: 'سفیر قبلی', phone: '09121234567', nationalId: '1234567891', passwordHash: oldHash, services: ['REPAIR'] } });
    const legacy = await prisma.user.create({ data: { role: 'CUSTOMER', fullName: 'مشتری قبلی', phone: '09121234568', nationalId: '9876543210', passwordHash: oldHash, services: [] } });
    const config = { SESSION_DAYS: 90, TRUST_PROXY: 0, origins: [], NODE_ENV: 'production', NIAZPARDAZ_API_KEY: 'test-only-key-not-a-provider-credential' };
    const redis = { eval: async () => 1 }, disconnected = [];
    const io = { in: room => ({ disconnectSockets: () => disconnected.push(room) }) };
    const services = createServices({ prisma, config, redis, io });
    const sent = []; let fail = false;
    const sms = { enabled: true, sendCode: async (phone, code) => { if (fail) throw new Error('provider secret must never leak'); sent.push({ phone, code }); } };
    server = createApp({ prisma, config, redis, io, services, otpSms: sms }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    async function call(route, body, cookie) {
      const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie, 'X-App-Role': 'CUSTOMER' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, status: response.status, data: await response.json() };
    }
    const send = (phone, purpose = 'REGISTER') => call('/auth/customers/otp/request', { phone, purpose });
    const verify = (challengeId, code) => call('/auth/customers/otp/verify', { challengeId, code });
    const age = phone => prisma.customerOtpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 61000) } });
    const first = await send('۰۹۱۲۱۲۳۴۵۶۷'); assert.equal(first.status, 200); assert.equal(sent.length, 1); assert.equal(sent[0].phone, '09121234567');
    assert.equal(JSON.stringify(first.data).includes(sent[0].code), false);
    const stored = await prisma.customerOtpChallenge.findUnique({ where: { id: first.data.challengeId } }); assert.notEqual(stored.codeHash, sent[0].code); assert.equal(stored.codeHash.length, 64);
    assert.equal((await send('09121234567', 'LOGIN')).status, 429); assert.equal(sent.length, 1);
    const wrong = sent[0].code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) assert.equal((await verify(first.data.challengeId, wrong)).status, 400);
    assert.equal((await prisma.customerOtpChallenge.findUnique({ where: { id: first.data.challengeId } })).status, 'LOCKED');
    assert.equal((await verify(first.data.challengeId, sent[0].code)).status, 400);
    await age('09121234567'); const fresh = await send('09121234567'); assert.equal(fresh.status, 200);
    const results = await Promise.all([verify(fresh.data.challengeId, sent.at(-1).code), verify(fresh.data.challengeId, sent.at(-1).code)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    const success = results.find(r => r.status === 200);
    assert.equal(success.data.user.profileComplete, false); assert.equal(success.data.user.hasPassword, false); assert.equal(success.data.user.nationalId, null); assert.equal(success.data.user.passwordHash, undefined);
    assert.match(success.response.headers.get('set-cookie'), /HttpOnly/); assert.match(success.response.headers.get('set-cookie'), /Secure/);
    const cookie = success.response.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/me', null, cookie)).data.profileComplete, false);
    const blocked = await call('/requests/repair', { vehicleName: 'پژو', vehiclePlate: '12 ب 345', problem: 'خرابی موتور', origin: { latitude: 35.7, longitude: 51.4 } }, cookie); assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'PROFILE_INCOMPLETE');
    assert.equal((await call('/wallet/topups', { amountToman: 10000, idempotencyKey: randomUUID() }, cookie)).status, 403);
    const invalid = await call('/me/complete-profile', { fullName: 'مشتری تست', nationalId: '1111111111', password: 'newPassword123' }, cookie); assert.equal(invalid.status, 400);
    const completed = await call('/me/complete-profile', { fullName: 'مشتری تست', nationalId: '۱۲۳۴۵۶۷۸۹۱', password: 'newPassword123' }, cookie); assert.equal(completed.status, 200); assert.equal(completed.data.profileComplete, true); assert.equal(completed.data.hasPassword, true);
    assert.equal((await call('/me', null, cookie)).data.profileComplete, true);
    assert.equal((await call('/auth/customers/login', { phone: '09121234567', password: 'newPassword123' })).status, 200);
    assert.equal((await call('/auth/drivers/login', { phone: '09121234567', password: 'password123' })).status, 200);
    await age('09121234567'); const reset = await send('09121234567', 'RESET_PASSWORD'), resetCode = sent.at(-1).code;
    assert.equal((await verify(reset.data.challengeId, resetCode)).status, 400);
    assert.equal((await prisma.customerOtpChallenge.findUnique({ where: { id: reset.data.challengeId } })).status, 'SENT');
    const changed = await call('/auth/customers/password/reset', { challengeId: reset.data.challengeId, code: resetCode, password: 'recoveredPassword123' }); assert.equal(changed.status, 200);
    assert.equal((await call('/me', null, cookie)).status, 401);
    assert.equal((await call('/auth/customers/login', { phone: '09121234567', password: 'newPassword123' })).status, 401);
    assert.equal((await call('/auth/customers/login', { phone: '09121234567', password: 'recoveredPassword123' })).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: driver.id } })).passwordHash, oldHash);
    assert.ok(disconnected.includes(`user:${success.data.user.id}`)); assert.equal(disconnected.includes(`user:${driver.id}`), false);
    await age('09121234567'); const loginOtp = await send('09121234567', 'LOGIN'); const otpSession = await verify(loginOtp.data.challengeId, sent.at(-1).code); assert.equal(otpSession.status, 200); assert.equal(otpSession.data.user.fullName, 'مشتری تست'); assert.equal(otpSession.data.user.profileComplete, true);
    const existing = await send(legacy.phone); const existingSession = await verify(existing.data.challengeId, sent.at(-1).code); assert.equal(existingSession.status, 200); assert.equal(existingSession.data.user.id, legacy.id); assert.equal(existingSession.data.user.profileComplete, true);
    const unknown = await send('09121234569', 'LOGIN'); assert.equal((await verify(unknown.data.challengeId, sent.at(-1).code)).status, 400); assert.equal(await prisma.user.findUnique({ where: { role_phone: { role: 'CUSTOMER', phone: '09121234569' } } }), null);
    const expired = await send('09121234560'); await prisma.customerOtpChallenge.update({ where: { id: expired.data.challengeId }, data: { expiresAt: new Date(Date.now() - 1) } }); assert.equal((await verify(expired.data.challengeId, sent.at(-1).code)).status, 400);
    fail = true; const failed = await send('09121234561'); assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.data).includes('provider secret'), false); assert.equal((await prisma.customerOtpChallenge.findFirst({ where: { phone: '09121234561' } })).status, 'FAILED'); fail = false;
    assert.equal((await call('/auth/customers/register', { fullName: 'بایپس', phone: '09121234562', nationalId: '1234567891', password: 'password123' })).status, 410);
    const service = createCustomerAuth({ prisma, config, services, sms });
    const quotaPhone = '09120000000';
    await prisma.customerOtpChallenge.createMany({ data: Array.from({ length: 5 }, () => ({ id: randomUUID(), phone: quotaPhone, purpose: 'LOGIN', codeHash: '0'.repeat(64), status: 'USED', expiresAt: new Date(), createdAt: new Date(Date.now() - 120000) })) });
    await assert.rejects(service.requestCode({ phone: quotaPhone, purpose: 'LOGIN' }), { status: 429 });
    await prisma.customerOtpChallenge.deleteMany({ where: { phone: quotaPhone } });
    await prisma.customerOtpChallenge.createMany({ data: Array.from({ length: 10 }, () => ({ id: randomUUID(), phone: quotaPhone, purpose: 'LOGIN', codeHash: '0'.repeat(64), status: 'USED', expiresAt: new Date(), createdAt: new Date(Date.now() - 7200000) })) });
    await assert.rejects(service.requestCode({ phone: quotaPhone, purpose: 'LOGIN' }), { status: 429 });
    const row = await prisma.user.findUnique({ where: { id: success.data.user.id } }); assert.ok(await verifyPassword('recoveredPassword123', row.passwordHash));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    await tcp.stop(); await db.close();
  }
});
