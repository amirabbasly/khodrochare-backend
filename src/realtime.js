const { location, HttpError } = require('./domain');
const { cookieToken } = require('./session-cookies');
function attachRealtime(io, services, redis) {
  io.use(async (socket, next) => {
    try {
      socket.data.token = socket.handshake.auth.token || cookieToken(socket.handshake.headers.cookie, socket.handshake.auth.role);
      socket.data.user = await services.authenticate(socket.data.token);
      next();
    } catch { next(new Error('Authentication required')); }
  });
  io.on('connection', socket => {
    socket.join(`user:${socket.data.user.id}`);
    const run = handler => async (payload, ack) => {
      try {
        const user = await services.authenticate(socket.data.token);
        const result = await handler(user, payload);
        if (typeof ack === 'function') ack({ ok: true, data: result });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, error: e.status ? e.message : 'Invalid event or unavailable service' });
        if (e.status === 401) socket.disconnect(true);
      }
    };
    const recheck = setInterval(async () => {
      try { await services.authenticate(socket.data.token); } catch { socket.disconnect(true); }
    }, 15000);
    socket.on('disconnect', () => clearInterval(recheck));
    socket.on('driver:location', run(async (user, payload) => {
      if (user.role !== 'DRIVER') throw new HttpError(403, 'Driver role required');
      const key = `socket-gps:${user.id}`;
      if (!await redis.set(key, '1', 'PX', 1000, 'NX')) throw new HttpError(429, 'GPS updates limited to once per second');
      return services.updateLocation(user, location.parse(payload));
    }));
    socket.on('request:tracking', run(async (user, payload) => {
      if (typeof payload?.requestId !== 'string') throw new HttpError(400, 'requestId required');
      const request = await services.ownedRequest(payload.requestId, user);
      if (['CANCELLED', 'COMPLETED'].includes(request.status)) throw new HttpError(409, 'Tracking has ended');
      return services.tracking(request);
    }));
  });
}
module.exports = { attachRealtime };
