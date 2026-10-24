const { randomBytes } = require('node:crypto');
const { hash, HttpError } = require('./domain');
const { quote } = require('./pricing');
const { createCatalog } = require('./catalog');
const { createGeocoder } = require('./geocoding');
function createServices({ prisma, redis, config, io }) {
  const catalog = createCatalog(prisma);
  const geocoder = createGeocoder({ redis, config: config || {} });
  const safeUser = u => { const { passwordHash, ...safe } = u; return safe; };
  async function session(user) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86400000);
    await prisma.session.create({ data: { tokenHash: hash(token), userId: user.id, expiresAt } });
    return { token, expiresAt, user: safeUser(user) };
  }
  async function authenticateSession(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Authentication required');
    const found = await prisma.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    if (!found || found.expiresAt <= new Date()) throw new HttpError(401, 'Session expired');
    let expiresAt = found.expiresAt;
    const lifetime = config?.SESSION_DAYS * 86400000;
    if (lifetime && expiresAt.getTime() - Date.now() < lifetime / 2) {
      expiresAt = new Date(Date.now() + lifetime);
      await prisma.session.update({ where: { tokenHash: hash(token) }, data: { expiresAt } });
    }
    return { user: found.user, expiresAt, token };
  }
  async function authenticate(token) { return (await authenticateSession(token)).user; }
  async function claimDocument(tx, ref, userId, vehicleId) {
    const result = await tx.document.updateMany({ where: { id: ref.id, ownerId: null, uploadTokenHash: hash(ref.token), createdAt: { gt: new Date(Date.now() - 86400000) } }, data: { ownerId: userId, vehicleId, uploadTokenHash: null } });
    if (result.count !== 1) throw new HttpError(400, 'Invalid, expired or already used document');
  }
  async function distance(a, b, road = false) {
    if (road && config.DISTANCE_MODE === 'road') {
      try {
        const cacheKey = `route:v1:${hash(JSON.stringify([config.OSRM_URL, a, b]))}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
          const result = JSON.parse(cached);
          if (Number.isInteger(result.meters) && result.meters > 0 && result.method === 'OSRM_ROAD') return result;
        }
        const url = `${config.OSRM_URL.replace(/\/$/, '')}/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=false`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        const meters = data.routes?.[0]?.distance;
        if (!response.ok || data.code !== 'Ok' || !Number.isFinite(meters) || meters <= 0) throw new Error('No route');
        const result = { meters: Math.round(meters), method: 'OSRM_ROAD' };
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
        return result;
      } catch { throw new HttpError(503, 'Routing service unavailable or no drivable route'); }
    }
    const [row] = await prisma.$queryRaw`SELECT ST_Distance(ST_SetSRID(ST_MakePoint(${a.longitude}, ${a.latitude}),4326)::geography, ST_SetSRID(ST_MakePoint(${b.longitude}, ${b.latitude}),4326)::geography) AS meters`;
    return { meters: Math.round(row.meters), method: 'POSTGIS_GEODESIC' };
  }
  async function ownedRequest(id, user) {
    const request = await prisma.assistanceRequest.findUnique({ where: { id } });
    if (!request || (request.customerId !== user.id && request.driverId !== user.id)) throw new HttpError(404, 'Request not found');
    return request;
  }
  async function tracking(request) {
    if (!request.driverId) return { driver: null };
    const loc = await prisma.driverLocation.findUnique({ where: { driverId: request.driverId } });
    if (!loc || Date.now() - loc.recordedAt.getTime() > config.LOCATION_MAX_AGE_SECONDS * 1000) return { driver: null, stale: true };
    const result = await distance(loc, { latitude: request.originLat, longitude: request.originLng });
    return { driver: { latitude: loc.latitude, longitude: loc.longitude, recordedAt: loc.recordedAt }, distanceToOriginMeters: result.meters, distanceMethod: result.method, stale: false };
  }
  async function updateLocation(user, input) {
    if (user.role !== 'DRIVER') throw new HttpError(403, 'Driver role required');
    const recordedAt = new Date(input.recordedAt);
    const age = Date.now() - recordedAt.getTime();
    if (age > config.LOCATION_MAX_AGE_SECONDS * 1000 || age < -30000) throw new HttpError(400, 'GPS timestamp is stale or in the future');
    const rows = await prisma.$queryRaw`INSERT INTO "DriverLocation" ("driverId", latitude, longitude, point, "recordedAt") VALUES (${user.id}, ${input.latitude}, ${input.longitude}, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}),4326)::geography, ${recordedAt}) ON CONFLICT ("driverId") DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, point=EXCLUDED.point, "recordedAt"=EXCLUDED."recordedAt" WHERE "DriverLocation"."recordedAt" < EXCLUDED."recordedAt" RETURNING "driverId"`;
    if (!rows.length) throw new HttpError(409, 'Out of order GPS update');
    const requests = await prisma.assistanceRequest.findMany({ where: { driverId: user.id, status: { in: ['ACCEPTED', 'ARRIVED'] } } });
    for (const request of requests) {
      const result = await tracking(request);
      io.to(`user:${request.customerId}`).to(`user:${user.id}`).emit('driver:location', { requestId: request.id, ...result });
    }
    return { recordedAt };
  }
  async function prepareTowing(input, at) {
    const model = await catalog.resolve(input.vehicleName, input.vehicleModelId);
    const [origin, destination] = await Promise.all([geocoder.resolve(input.originPlaceId, input.origin), geocoder.resolve(input.destinationPlaceId, input.destination)]);
    const canonical = { ...input, vehicleName: model?.name || input.vehicleName, origin, destination };
    const route = await distance(origin, destination, true);
    const pricing = quote({ ...canonical, service: 'TOWING', distanceMeters: route.meters, at, tariff: model?.group || null, groupOverride: model?.groupId || 'UNLISTED' });
    return { input: canonical, model, route, pricing };
  }
  async function estimateTowing(input) {
    const prepared = await prepareTowing(input, new Date());
    if (prepared.route.meters < 1) throw new HttpError(400, 'Origin and destination must differ');
    return { ...prepared.pricing, distanceMeters: prepared.route.meters, distanceMethod: prepared.route.method, vehicleName: prepared.input.vehicleName, originAddress: prepared.input.origin.label, destinationAddress: prepared.input.destination.label };
  }
  async function createRequest(user, input, service) {
    const now = new Date();
    const prepared = service === 'TOWING' ? await prepareTowing(input, now) : null;
    let repairAddress = null;
    if (service === 'REPAIR' && config?.PHOTON_URL) { try { repairAddress = await geocoder.resolve(null, input.origin); } catch {} }
    const route = prepared?.route;
    if (prepared) input = prepared.input;
    if (route && route.meters < 1) throw new HttpError(400, 'Origin and destination must differ');
    const pricing = prepared?.pricing || quote({ ...input, service, at: now });
    return prisma.$transaction(async tx => {
      const request = await tx.assistanceRequest.create({ data: {
        customerId: user.id, service, vehicleName: input.vehicleName, vehiclePlate: input.vehiclePlate,
        vehicleModelId: prepared?.model?.id || undefined,
        originProvince: prepared?.input.origin.province || repairAddress?.province,
        originAddress: prepared?.input.origin.label || repairAddress?.label, destinationAddress: prepared?.input.destination.label,
        originLat: input.origin.latitude, originLng: input.origin.longitude,
        destinationLat: input.destination?.latitude, destinationLng: input.destination?.longitude,
        problem: input.problem, distanceMeters: route?.meters, distanceMethod: route?.method,
        ...pricing, createdAt: now,
      } });
      await tx.$executeRaw`UPDATE "AssistanceRequest" SET origin=ST_SetSRID(ST_MakePoint(${input.origin.longitude},${input.origin.latitude}),4326)::geography WHERE id=${request.id}`;
      if (input.destination) await tx.$executeRaw`UPDATE "AssistanceRequest" SET destination=ST_SetSRID(ST_MakePoint(${input.destination.longitude},${input.destination.latitude}),4326)::geography WHERE id=${request.id}`;
      await tx.outbox.create({ data: { requestId: request.id } });
      return request;
    });
  }
  return { safeUser, session, authenticate, authenticateSession, claimDocument, distance, ownedRequest, tracking, updateLocation, createRequest, estimateTowing };
}
module.exports = { createServices };
