const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../src/app');
const { PENDING_REQUEST_LIFETIME_MS: lifetime, pendingRequestCutoff, isPendingRequestExpired, expirePendingRequests } = require('../src/request-expiry');

test('pending requests expire exactly at six hours; accepted/assigned requests never expire', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  assert.equal(pendingRequestCutoff(now).toISOString(), '2026-11-21T06:00:00.000Z');
  const pending = { status: 'PENDING', driverId: null, createdAt: new Date(now - lifetime) };
  assert.equal(isPendingRequestExpired(pending, now), true);
  assert.equal(isPendingRequestExpired({ ...pending, createdAt: new Date(now - lifetime + 1) }, now), false);
  assert.equal(isPendingRequestExpired({ ...pending, driverId: 'driver' }, now), false);
  assert.equal(isPendingRequestExpired({ ...pending, operatorConfirmedAt: now }, now), false);
  for (const status of ['ACCEPTED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'EXPIRED']) assert.equal(isPendingRequestExpired({ ...pending, status }, now), false);
});

test('actual expiry migration and PostgreSQL sweep preserve history, protect assignments and atomically enqueue events', { timeout: 60000 }, async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TYPE "RequestStatus" AS ENUM ('PENDING','ACCEPTED','ARRIVED','COMPLETED','CANCELLED');
      CREATE TABLE "AssistanceRequest" (id TEXT PRIMARY KEY, status "RequestStatus", "driverId" TEXT, "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL);
      CREATE TABLE "Outbox" ("requestId" TEXT REFERENCES "AssistanceRequest"(id));
      CREATE TABLE "Payment" ("requestId" TEXT REFERENCES "AssistanceRequest"(id),status TEXT);`);
    await db.exec(await readFile(path.join(__dirname, '../prisma/migrations/202611210001_request_expiry/migration.sql'), 'utf8'));
    const now = new Date('2026-11-21T12:00:00Z');
    for (const [id, status, driverId, age] of [['old', 'PENDING', null, lifetime + 1], ['boundary', 'PENDING', null, lifetime], ['fresh', 'PENDING', null, lifetime - 1], ['accepted', 'ACCEPTED', 'driver', lifetime * 2], ['assigned', 'PENDING', 'driver', lifetime * 2], ['cancelled', 'CANCELLED', null, lifetime * 2]]) {
      await db.query('INSERT INTO "AssistanceRequest" VALUES ($1,$2,$3,$4,$4)', [id, status, driverId, new Date(now - age).toISOString()]);
    }
    await db.exec('ALTER TABLE "AssistanceRequest" ADD COLUMN "operatorConfirmedAt" TIMESTAMPTZ');
    await db.query(`INSERT INTO "Payment" VALUES ('old','VERIFIED')`);
    let failOutbox = false;
    const prisma = { $transaction: callback => db.transaction(async connection => callback({
      $queryRaw: async (strings, ...values) => (await connection.query(strings.reduce((sql, part, i) => sql + (i ? '$' + i : '') + part, ''), values.map(v => v instanceof Date ? v.toISOString() : v))).rows,
      payment: { updateMany: async ({ where, data }) => connection.query('UPDATE "Payment" SET status=$1 WHERE "requestId"=ANY($2) AND status=ANY($3)', [data.status, where.requestId.in, where.status.in]) },
      outbox: { createMany: async ({ data }) => { if (failOutbox) throw new Error('outbox offline'); for (const row of data) await connection.query('INSERT INTO "Outbox" VALUES ($1)', [row.requestId]); } },
    })) };
    failOutbox = true;
    await assert.rejects(expirePendingRequests(prisma, now), /outbox offline/);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM "AssistanceRequest" WHERE status='EXPIRED'`)).rows[0].count, 0);
    assert.equal((await db.query('SELECT status FROM "Payment"')).rows[0].status, 'VERIFIED');
    failOutbox = false;
    assert.equal(await expirePendingRequests(prisma, now, 1), 1);
    assert.equal(await expirePendingRequests(prisma, now), 1);
    assert.equal(await expirePendingRequests(prisma, now), 0);
    const rows = (await db.query('SELECT id,status FROM "AssistanceRequest" ORDER BY id')).rows;
    assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, r.status])), { accepted: 'ACCEPTED', assigned: 'PENDING', boundary: 'EXPIRED', cancelled: 'CANCELLED', fresh: 'PENDING', old: 'EXPIRED' });
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM "Outbox"')).rows[0].count, 2);
    assert.equal((await db.query('SELECT status FROM "Payment"')).rows[0].status, 'REFUND_REQUIRED');
    // Even before a sweep, the conditional acceptance predicate must reject the boundary.
    const accepted = await db.query(`UPDATE "AssistanceRequest" SET status='ACCEPTED',"driverId"='new-driver' WHERE id='fresh' AND status='PENDING' AND "driverId" IS NULL AND "createdAt">$1 RETURNING id`, [pendingRequestCutoff(now).toISOString()]);
    assert.equal(accepted.rows.length, 1);
    assert.equal(await expirePendingRequests(prisma, new Date(now.getTime() + lifetime)), 0);
  } finally { await db.close(); }
});

test('available HTTP filters elapsed requests and acceptance rechecks the deadline inside its conditional update', async () => {
  const old = { id: 'old', customerId: 'customer', status: 'PENDING', driverId: null, service: 'REPAIR', createdAt: new Date(Date.now() - lifetime - 10000) };
  const fresh = { ...old, id: 'fresh', createdAt: new Date() };
  const extra=['MOBILE_CARWASH','PERIODIC_SERVICE','INSPECTION'].map(service=>({...fresh,id:service,service}));
  const requests = [old, fresh,...extra]; const events = [];let balance=0;
  const prisma = { walletEntry:{aggregate:async()=>({_sum:{amountToman:balance}})},driverEarning:{aggregate:async()=>({_sum:{amountToman:0}})},assistanceRequest: {
    findMany: async ({ where }) => where.customerId ? requests : requests.filter(r => r.status === where.status && r.driverId === where.driverId && r.createdAt > where.createdAt.gt && where.service.in.includes(r.service)),
    count: async () => 0,
    updateMany: async ({ where, data }) => { assert.ok(where.createdAt.gt instanceof Date); const r = requests.find(r => r.id === where.id && r.status === where.status && !r.driverId && where.service.in.includes(r.service) && r.createdAt > where.createdAt.gt); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
    findUnique: async ({ where }) => requests.find(r => r.id === where.id),
  }, userLocation:{findUnique:async()=>null},operatorAudit:{create:async()=>({})},driverLocation: { findUnique: async () => ({ recordedAt: new Date() }) }, outbox: { create: async ({ data }) => events.push(data) }, $queryRaw: async () => [], $transaction: callback => callback(prisma) };
  const app = createApp({ prisma, redis: { eval: async () => 1 }, io: {}, config: { TRUST_PROXY: 0, origins: [], UPLOAD_DIR: './uploads', LOCATION_MAX_AGE_SECONDS: 120 }, services: { authenticate: async token => ({ id: token, role: token === 'customer' ? 'CUSTOMER' : 'DRIVER', activityCity:'مشهد',activityDistrict:'بخش مرکزی',services: [token.startsWith('service:')?token.slice(8):'REPAIR'] }) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const call = (url, token = 'driver', method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}/api/v1${url}`, { method, headers: { authorization: `Bearer ${token}` } });
  try {
    assert.deepEqual((await (await call('/drivers/requests/available')).json()).map(r => r.id), ['fresh']);
    const history = await (await call('/requests', 'customer')).json(); assert.equal(history.find(r => r.id === 'old').status, 'EXPIRED');
    assert.equal((await call('/requests/old/accept', 'driver', 'POST')).status, 409);
    assert.equal(events.length, 0);
    const response = await call('/requests/fresh/accept', 'driver', 'POST'); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ACCEPTED');
    assert.equal(events.length, 1);
    for(const row of extra){assert.deepEqual((await(await call('/drivers/requests/available','service:'+row.service)).json()).map(r=>r.id),[row.id]);assert.equal((await call('/requests/'+row.id+'/accept','driver','POST')).status,409);}
    balance=-1;assert.deepEqual(await(await call('/drivers/requests/available','service:MOBILE_CARWASH')).json(),[]);
    const blocked=await call('/requests/MOBILE_CARWASH/accept','service:MOBILE_CARWASH','POST');assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/کمیسیون/);
    balance=0;assert.equal((await call('/requests/MOBILE_CARWASH/accept','service:MOBILE_CARWASH','POST')).status,200);

  } finally { await new Promise(resolve => server.close(resolve)); }
});
