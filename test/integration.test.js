const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const enabled = process.env.RUN_INTEGRATION === '1';
test('real PostGIS / Redis / HTTP / Socket.IO lifecycle', { skip: !enabled, timeout: 120000 }, async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/khodrochare_test', 'Integration tests require the isolated test database');
  const { io } = require('socket.io-client');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: '4199', DISTANCE_MODE: 'geodesic' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const sockets = [];
  const base = 'http://127.0.0.1:4199';
  async function call(route, { token, method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(base + '/api/v1' + route, { method, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const data = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  async function signupDriver(phone) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' }), 'identity.png');
    const document = await call('/documents', { method: 'POST', body: form, status: 201 });
    return call('/auth/drivers/register', { method: 'POST', status: 201, body: { fullName: 'امدادگر آزمایشی', phone, password: 'password123', nationalId: phone === '09121234568' ? '1234567891' : '9876543210', vehiclePlate: '۱۲ب۳۴۵۶۷', vehicleType: 'نیسان', services: ['REPAIR', 'TOWING'], identityDocument: { id: document.id, token: document.token } } });
  }
  async function connect(token) {
    const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([e]) => { throw e; }), delay(5000).then(() => { throw new Error('Socket connection timed out'); })]);
    return socket;
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(base + '/health/ready')).ok; } catch {}
      if (ready) break;
      await delay(250);
    }
    assert.equal(ready, true, output);
    const input = { fullName: 'مشتری آزمایشی', phone: '09121234567', password: 'password123', nationalId: '1234567891' };
    const suffix = String(Date.now()).slice(-7);
    input.phone = '0912' + suffix;
    // Test data is unique per run; national identity uniqueness is scoped by role.
    const existing = await prisma.user.findMany({ where: { nationalId: { in: ['1234567891', '9876543210'] } } });
    assert.equal(existing.length, 0, 'Run with fresh isolated test volumes');
    const customer = await call('/auth/customers/register', { method: 'POST', body: input, status: 201 });
    assert.equal(customer.user.passwordHash, undefined);
    await call('/auth/customers/register', { method: 'POST', body: input, status: 409 });
    await call('/auth/drivers/login', { method: 'POST', body: { phone: input.phone, password: input.password }, status: 401 });
    const login = await call('/auth/customers/login', { method: 'POST', body: { phone: input.phone, password: input.password } });
    assert.ok(login.token);
    const driver = await signupDriver('09121234568');
    const driver2 = await signupDriver('09121234569');
    await call('/drivers/location', { token: customer.token, method: 'PUT', body: {}, status: 403 });
    const repairInput = { vehicleName: 'پژو ۲۰۶', vehiclePlate: '۱۲ب۳۴۵۶۷', origin: { latitude: 35.7, longitude: 51.4 }, problem: 'روشن نمیشود' };
    const repair = await call('/requests/repair', { token: customer.token, method: 'POST', body: repairInput, status: 201 });
    assert.equal(repair.service, 'REPAIR');
    assert.ok(repair.createdAt);
    const towInput = { ...repairInput, destination: { latitude: 35.8, longitude: 51.5 } }; delete towInput.problem;
    const tow = await call('/requests/towing', { token: customer.token, method: 'POST', body: towInput, status: 201 });
    assert.ok(tow.distanceMeters > 10000);
    assert.equal(tow.priceToman, require("../src/pricing").quote({ service: "TOWING", vehicleName: tow.vehicleName, distanceMeters: tow.distanceMeters, at: new Date(tow.createdAt) }).priceToman);
    await call(`/requests/${repair.id}/accept`, { token: driver.token, method: 'POST', status: 409 });
    const gps = { latitude: 35.71, longitude: 51.41, recordedAt: new Date().toISOString() };
    for (const actor of [driver, driver2]) await call('/drivers/location', { token: actor.token, method: 'PUT', body: gps });
    const responses = await Promise.all([driver, driver2].map(actor => fetch(`${base}/api/v1/requests/${repair.id}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${actor.token}` } })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = responses[0].status === 200 ? driver : driver2;
    const loser = winner === driver ? driver2 : driver;
    await call(`/requests/${repair.id}`, { token: loser.token, status: 404 });
    await call(`/requests/${tow.id}/accept`, { token: winner.token, method: 'POST', status: 409 });
    const tracking = await call(`/requests/${repair.id}/tracking`, { token: customer.token });
    assert.ok(tracking.distanceToOriginMeters > 0);
    const customerSocket = await connect(customer.token);
    const driverSocket = await connect(winner.token);
    const locationReceived = once(customerSocket, 'driver:location');
    const driverReceived = once(driverSocket, 'driver:location');
    const ack = await driverSocket.timeout(5000).emitWithAck('driver:location', { ...gps, latitude: 35.72, recordedAt: new Date().toISOString() });
    assert.equal(ack.ok, true);
    const [event] = await Promise.race([locationReceived, delay(5000).then(() => { throw new Error('GPS delivery timed out'); })]);
    assert.equal(event.requestId, repair.id);
    assert.equal((await driverReceived)[0].distanceToOriginMeters, event.distanceToOriginMeters);
    await call(`/requests/${repair.id}/status`, { token: customer.token, method: 'PATCH', body: { status: 'COMPLETED' }, status: 409 });
    for (const status of ['ARRIVED', 'COMPLETED']) await call(`/requests/${repair.id}/status`, { token: winner.token, method: 'PATCH', body: { status } });
    await call(`/requests/${repair.id}/tracking`, { token: customer.token, status: 409 });
    await call('/auth/logout', { token: customer.token, method: 'POST', status: 204 });
    await call('/me', { token: customer.token, status: 401 });
    const events = await prisma.outbox.count(); assert.ok(events >= 4);
  } finally {
    for (const socket of sockets) socket.disconnect();
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), delay(10000)]);
    await prisma.$disconnect();
  }
});
