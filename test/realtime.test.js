const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { attachRealtime } = require('../src/realtime');
const { HttpError } = require('../src/domain');
test('real socket authentication, role checks, private delivery and session revocation', { timeout: 15000 }, async () => {
  const server = http.createServer((req, res) => res.end('ready'));
  const io = new Server(server);
  let revoked = false;
  const services = {
    authenticate: async token => {
      if (!['driver', 'customer', 'other'].includes(token) || (revoked && token === 'driver')) throw new HttpError(401, 'Session expired');
      return { id: token, role: token === 'driver' ? 'DRIVER' : 'CUSTOMER' };
    },
    updateLocation: async (user, point) => {
      io.to('user:customer').to('user:driver').emit('driver:location', { requestId: 'request-1', driver: point, distanceToOriginMeters: 100 });
      return point;
    },
    ownedRequest: async (id, user) => {
      if (user.id === 'other') throw new HttpError(404, 'Request not found');
      return { id, status: 'ACCEPTED' };
    },
    tracking: async () => ({ distanceToOriginMeters: 100 }),
  };
  attachRealtime(io, services, { set: async () => 'OK' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const connect = token => new Promise((resolve, reject) => {
    const socket = client(base, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 3000 });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  const emit = (socket, name, payload) => socket.timeout(3000).emitWithAck(name, payload);
  try {
    assert.equal(await (await fetch(base)).text(), 'ready');
    await assert.rejects(connect('invalid'), /Authentication required/);
    const driver = await connect('driver');
    const customer = await connect('customer');
    const other = await connect('other');
    const point = { latitude: 35, longitude: 51, recordedAt: new Date().toISOString() };
    assert.equal((await emit(customer, 'driver:location', point)).ok, false);
    assert.equal((await emit(other, 'request:tracking', { requestId: 'request-1' })).ok, false);
    assert.equal((await emit(customer, 'request:tracking', { requestId: 'request-1' })).data.distanceToOriginMeters, 100);
    let leaked = false;
    other.on('driver:location', () => { leaked = true; });
    const received = new Promise(resolve => customer.once('driver:location', resolve));
    assert.equal((await emit(driver, 'driver:location', point)).ok, true);
    assert.equal((await received).requestId, 'request-1');
    assert.equal(leaked, false);
    revoked = true;
    const disconnected = new Promise(resolve => driver.once('disconnect', resolve));
    assert.equal((await emit(driver, 'driver:location', point)).ok, false);
    await disconnected;
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});
