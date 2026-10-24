const { z } = require('zod');
const { randomBytes } = require('node:crypto');
const d = require('./domain');

function registerMonitoring({ app, prisma, redis, config, auth, limit, geocoder }) {
  app.post('/api/v1/admin/session', limit('admin-login', 5, 900), async (req, res) => {
    const input = z.object({ username: z.string().max(100), password: z.string().min(1).max(128) }).strict().parse(req.body);
    if (!config.ADMIN_PASSWORD_HASH) throw new d.HttpError(503, 'Admin login is not configured');
    const valid = await d.verifyPassword(input.password, config.ADMIN_PASSWORD_HASH);
    if (input.username !== config.ADMIN_USERNAME || !valid) throw new d.HttpError(401, 'Invalid credentials');
    const token = randomBytes(32).toString('hex');
    await redis.set(`admin:session:${d.hash(token)}`, config.ADMIN_PASSWORD_HASH, 'EX', 28800);
    res.set('Cache-Control', 'no-store').json({ token });
  });
  const admin = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (!token || !/^[a-f0-9]{64}$/.test(token) || !config.ADMIN_PASSWORD_HASH || await redis.get(`admin:session:${d.hash(token)}`) !== config.ADMIN_PASSWORD_HASH) throw new d.HttpError(401, 'Admin authentication required');
      req.adminToken = token;
      res.set('Cache-Control', 'no-store'); next();
    } catch (error) { next(error); }
  };
  app.delete('/api/v1/admin/session', admin, async (req, res) => { await redis.del(`admin:session:${d.hash(req.adminToken)}`); res.status(204).end(); });
  app.get('/api/v1/admin/overview', admin, async (req, res) => res.json(await overview(prisma, config.LOCATION_MAX_AGE_SECONDS)));
  app.patch('/api/v1/me', auth, async (req, res) => {
    const input = z.object({ fullName: z.string().trim().min(3).max(150) }).strict().parse(req.body);
    const updated = await prisma.user.update({ where: { id: req.user.id }, data: input, include: { vehicles: true } });
    const { passwordHash, ...safe } = updated;
    res.json(safe);
  });
  app.put('/api/v1/me/location', auth, limit('telemetry', 20, 60), async (req, res) => {
    const point = d.location.parse(req.body);
    const age = Date.now() - Date.parse(point.recordedAt);
    if (age > config.LOCATION_MAX_AGE_SECONDS * 1000 || age < -30000) throw new d.HttpError(400, 'GPS timestamp is stale or in the future');
    // Province resolution is cached by coarse area, not requested on every GPS update.
    const key = `province:${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}`;
    let province = await redis.get(key);
    if (province == null) {
      try { province = (await geocoder.resolve(null, point)).province || ''; } catch { province = ''; }
      await redis.set(key, province, 'EX', province ? 86400 : 300);
    }
    const rows = await prisma.$queryRaw`INSERT INTO "UserLocation" ("userId", latitude, longitude, province, "recordedAt") VALUES (${req.user.id}, ${point.latitude}, ${point.longitude}, ${province}, ${new Date(point.recordedAt)}) ON CONFLICT ("userId") DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, province=EXCLUDED.province, "recordedAt"=EXCLUDED."recordedAt" WHERE "UserLocation"."recordedAt" < EXCLUDED."recordedAt" RETURNING "userId"`;
    if (!rows.length) throw new d.HttpError(409, 'Out of order GPS update');
    res.status(204).end();
  });
}
async function overview(prisma, maxAge = 120) {
  const [users, requests, payments, revenue, totals] = await Promise.all([
    prisma.user.findMany({ select: { id: true, role: true, fullName: true, phone: true, vehiclePlate: true, vehicleType: true, services: true, createdAt: true, telemetry: true, location: true, _count: { select: { requests: true, assignments: true } } }, orderBy: { createdAt: 'desc' }, take: 2000 }),
    prisma.assistanceRequest.findMany({ include: { payment: { select: { status: true, amountToman: true, commissionToman: true, driverShareToman: true } } }, orderBy: { createdAt: 'desc' }, take: 2000 }),
    prisma.payment.groupBy({ by: ['status'], _count: true, _sum: { amountToman: true } }),
    prisma.$queryRaw`SELECT "driverId", to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD') AS day, SUM("amountToman")::float8 AS "driverToman", SUM("commissionToman")::float8 AS "appToman" FROM "DriverEarning" WHERE "createdAt" >= NOW() - INTERVAL '30 days' GROUP BY 1, 2 ORDER BY 2`,
    Promise.all([prisma.user.count({ where: { role: 'CUSTOMER' } }), prisma.user.count({ where: { role: 'DRIVER' } }), prisma.assistanceRequest.count(), prisma.driverEarning.aggregate({ _sum: { amountToman: true, commissionToman: true } }), prisma.assistanceRequest.groupBy({ by: ['status', 'service'], _count: true })]),
  ]);
  const people = users.map(({ telemetry, location, ...user }) => {
    const latest = telemetry && (!location || telemetry.recordedAt >= location.recordedAt) ? telemetry : location;
    const fresh = !!latest && Date.now() - latest.recordedAt.getTime() <= maxAge * 1000;
    const active = requests.find(r => (r.customerId === user.id || r.driverId === user.id) && ['PENDING', 'ACCEPTED', 'ARRIVED'].includes(r.status));
    return { ...user, province: telemetry?.province || 'نامشخص', location: latest ? { latitude: latest.latitude, longitude: latest.longitude, recordedAt: latest.recordedAt, fresh } : null, status: active?.status || (fresh ? 'ONLINE' : 'OFFLINE'), activeRequestId: active?.id || null };
  });
  return { generatedAt: new Date(), people, requests, payments, revenue, totals: { customers: totals[0], drivers: totals[1], requests: totals[2], driverToman: totals[3]._sum.amountToman || 0, appToman: totals[3]._sum.commissionToman || 0, categories: totals[4] }, limits: { people: 2000, requests: 2000 }, locationMaxAgeSeconds: maxAge };
}
module.exports = { registerMonitoring, overview };
