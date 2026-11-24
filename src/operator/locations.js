const { randomUUID } = require('node:crypto');
const { HttpError } = require('../domain');

function point(value, source, now, maxAge) {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return null;
  const at = new Date(value.recordedAt);
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 30000) return null;
  return { latitude: value.latitude, longitude: value.longitude, recordedAt: at.toISOString(), source, fresh: now - at <= maxAge * 1000 };
}
async function currentLocations(db, request, maxAge = 120, now = new Date()) {
  const [customer, driverTelemetry, driverGps] = await Promise.all([
    db.userLocation.findUnique({ where: { userId: request.customerId } }),
    request.driverId ? db.userLocation.findUnique({ where: { userId: request.driverId } }) : null,
    request.driverId ? db.driverLocation.findUnique({ where: { driverId: request.driverId } }) : null,
  ]);
  const drivers = [point(driverTelemetry, 'DEVICE_GPS', now, maxAge), point(driverGps, 'DRIVER_GPS', now, maxAge)].filter(Boolean).sort((a,b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  return {
    origin: { latitude: request.originLat, longitude: request.originLng, recordedAt: new Date(request.createdAt).toISOString(), source: 'REQUEST_ORIGIN' },
    customer: point(customer, 'DEVICE_GPS', now, maxAge), driver: drivers[0] || null,
  };
}
async function captureRequestLocations(db, request, actor, reason, maxAge = 120) {
  const locations = await currentLocations(db, request, maxAge);
  return db.operatorAudit.create({ data: { id:randomUUID(), actorId:actor.id, actorRole:actor.role, actorName:actor.name, action:'REQUEST_LOCATION_CAPTURE', targetId:request.id, details:{locations,driverId:request.driverId || null,status:request.status || 'PENDING',reason} } });
}
function registerRequestLocations({ app, root, prisma, config, id }) {
  const maxAge = config.LOCATION_MAX_AGE_SECONDS || 120;
  app.get(root + '/requests/:id/locations', async (req, res) => {
    const request = await prisma.assistanceRequest.findUnique({ where: { id: id.parse(req.params.id) }, select: { id:true, customerId:true, driverId:true, originLat:true, originLng:true, createdAt:true, status:true, customer:{select:{fullName:true}}, driver:{select:{fullName:true}} } });
    if (!request) throw new HttpError(404, 'درخواست پیدا نشد.');
    const [current, snapshots] = await Promise.all([
      currentLocations(prisma, request, maxAge),
      prisma.operatorAudit.findMany({ where: { targetId: request.id, action: 'REQUEST_LOCATION_CAPTURE' }, orderBy: [{createdAt:'desc'},{id:'desc'}], take: 50 }),
    ]);
    res.json({ requestId:request.id, status:request.status, customerName:request.customer.fullName, driverName:request.driver?.fullName || null, generatedAt:new Date(), maxAgeSeconds:maxAge, current, snapshots:snapshots.map(row=>({id:row.id,capturedAt:row.createdAt,actorName:row.actorName,...row.details})), limit:50 });
  });
  app.post(root + '/requests/:id/locations', async (req, res) => {
    require('zod').z.object({}).strict().parse(req.body);
    const requestId = id.parse(req.params.id);
    const saved = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AssistanceRequest" WHERE id=${requestId} FOR UPDATE`;
      const request = await tx.assistanceRequest.findUnique({ where: { id:requestId } });
      if (!request) throw new HttpError(404, 'درخواست پیدا نشد.');
      // Coordinates come only from persisted device samples, never from panel input.
      return captureRequestLocations(tx, request, req.operatorActor, 'OPERATOR_CAPTURE', maxAge);
    });
    res.status(201).json({ id:saved.id, capturedAt:saved.createdAt, actorName:saved.actorName, ...saved.details });
  });
}
module.exports = { point, currentLocations, captureRequestLocations, registerRequestLocations };
