const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID, randomBytes } = require('node:crypto');
const { z } = require('zod');
const d = require('./domain');

function createApp({ prisma, redis, config, io, services: s }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: config.origins, credentials: false }));
  app.use(express.json({ limit: '256kb' }));
  const auth = async (req, res, next) => {
    try { req.token = req.headers.authorization?.replace(/^Bearer /, ''); req.user = await s.authenticate(req.token); next(); } catch (e) { next(e); }
  };
  const role = value => (req, res, next) => req.user.role === value ? next() : next(new d.HttpError(403, `${value} role required`));
  const limit = (name, max, seconds) => async (req, res, next) => {
    try {
      const key = `limit:${name}:${req.user?.id || req.ip}`;
      const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, seconds);
      if (count > max) { res.set('Retry-After', String(seconds)); throw new d.HttpError(429, 'Too many requests'); }
      next();
    } catch (e) { next(e); }
  };
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try { await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use('/api', limit('api', 300, 60));
  app.get('/api/v1/services', (req, res) => res.json({ services: d.services }));
  // Private image storage: never expose uploads as a static directory.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/v1/documents', limit('upload', 10, 3600), upload.single('file'), async (req, res) => {
    const buffer = req.file?.buffer;
    let mimeType;
    if (buffer?.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) mimeType = 'image/jpeg';
    if (buffer?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
    if (!mimeType) throw new d.HttpError(400, 'Upload a JPEG or PNG image (maximum 5 MB)');
    const storageKey = randomUUID();
    const token = randomBytes(32).toString('hex');
    await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
    const filename = path.resolve(config.UPLOAD_DIR, storageKey);
    await fs.writeFile(filename, buffer, { flag: 'wx', mode: 0o600 });
    try {
      const doc = await prisma.document.create({ data: { storageKey, mimeType, uploadTokenHash: d.hash(token) } });
      res.status(201).json({ id: doc.id, token, expiresInSeconds: 86400 });
    } catch (e) { await fs.unlink(filename).catch(() => {}); throw e; }
  });
  app.get('/api/v1/documents/:id', auth, async (req, res) => {
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!doc) throw new d.HttpError(404, 'Document not found');
    res.set('Cache-Control', 'no-store').type(doc.mimeType).sendFile(path.resolve(config.UPLOAD_DIR, doc.storageKey));
  });
  for (const [slug, userRole, schema] of [['customers', 'CUSTOMER', d.customerRegistration], ['drivers', 'DRIVER', d.driverRegistration]]) {
    app.post(`/api/v1/auth/${slug}/register`, limit('register', 10, 3600), async (req, res) => {
      const input = schema.parse(req.body);
      const passwordHash = await d.hashPassword(input.password);
      const user = await prisma.$transaction(async tx => {
        const user = await tx.user.create({ data: { role: userRole, fullName: input.fullName, phone: input.phone, nationalId: input.nationalId, passwordHash, vehiclePlate: input.vehiclePlate, vehicleType: input.vehicleType, services: input.services || [] } });
        if (input.identityDocument) {
          await s.claimDocument(tx, input.identityDocument, user.id);
          await tx.user.update({ where: { id: user.id }, data: { identityDocumentId: input.identityDocument.id } });
          user.identityDocumentId = input.identityDocument.id;
        }
        for (const car of input.vehicles || []) {
          const vehicle = await tx.vehicle.create({ data: { userId: user.id, name: car.name, plate: car.plate } });
          for (const document of car.documents) await s.claimDocument(tx, document, user.id, vehicle.id);
        }
        return user;
      });
      res.status(201).json(await s.session(user));
    });
    app.post(`/api/v1/auth/${slug}/login`, limit('login', 10, 900), async (req, res) => {
      const input = z.object({ phone: d.phone, password: z.string().min(1).max(128) }).strict().parse(req.body);
      const user = await prisma.user.findUnique({ where: { role_phone: { role: userRole, phone: input.phone } } });
      const fallback = '00000000000000000000000000000000:' + '00'.repeat(64);
      const correct = await d.verifyPassword(input.password, user?.passwordHash || fallback);
      if (!user || !correct) throw new d.HttpError(401, 'Invalid phone or password');
      res.json(await s.session(user));
    });
  }
  app.post('/api/v1/auth/logout', auth, async (req, res) => {
    await prisma.session.deleteMany({ where: { tokenHash: d.hash(req.token) } });
    io.in(`user:${req.user.id}`).disconnectSockets(true);
    res.status(204).end();
  });
  app.get('/api/v1/me', auth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { vehicles: { include: { documents: { select: { id: true, mimeType: true } } } }, documents: { select: { id: true, mimeType: true } } } });
    res.json(s.safeUser(user));
  });
  app.post('/api/v1/me/vehicles', auth, role('CUSTOMER'), async (req, res) => {
    const input = d.vehicle.parse(req.body);
    const car = await prisma.$transaction(async tx => {
      const car = await tx.vehicle.create({ data: { userId: req.user.id, name: input.name, plate: input.plate } });
      for (const ref of input.documents) await s.claimDocument(tx, ref, req.user.id, car.id);
      return car;
    });
    res.status(201).json(car);
  });
  app.post('/api/v1/me/identity-document', auth, async (req, res) => {
    const ref = d.documentRef.parse(req.body);
    await prisma.$transaction(async tx => {
      await s.claimDocument(tx, ref, req.user.id);
      await tx.user.update({ where: { id: req.user.id }, data: { identityDocumentId: ref.id } });
    });
    res.status(204).end();
  });
  for (const [slug, service, schema] of [['towing', 'TOWING', d.towing], ['repair', 'REPAIR', d.repair]]) {
    app.post(`/api/v1/requests/${slug}`, auth, role('CUSTOMER'), limit('create-request', 20, 3600), async (req, res) => {
      res.status(201).json(await s.createRequest(req.user, schema.parse(req.body), service));
    });
  }
  app.get('/api/v1/requests', auth, async (req, res) => {
    const { page } = z.object({ page: z.coerce.number().int().positive().max(10000).default(1) }).parse(req.query);
    res.json(await prisma.assistanceRequest.findMany({ where: req.user.role === 'CUSTOMER' ? { customerId: req.user.id } : { driverId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50, skip: (page - 1) * 50 }));
  });
  app.get('/api/v1/drivers/requests/available', auth, role('DRIVER'), async (req, res) => {
    const requests = await prisma.assistanceRequest.findMany({ where: { status: 'PENDING', service: { in: req.user.services } }, select: { id: true, service: true, vehicleName: true, originLat: true, originLng: true, destinationLat: true, destinationLng: true, distanceMeters: true, priceToman: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(requests);
  });
  app.get('/api/v1/requests/:id', auth, async (req, res) => res.json(await s.ownedRequest(req.params.id, req.user)));
  app.get('/api/v1/requests/:id/tracking', auth, async (req, res) => {
    const request = await s.ownedRequest(req.params.id, req.user);
    if (['CANCELLED', 'COMPLETED'].includes(request.status)) throw new d.HttpError(409, 'Tracking has ended');
    res.json(await s.tracking(request));
  });
  app.post('/api/v1/requests/:id/accept', auth, role('DRIVER'), async (req, res) => {
    const request = await prisma.$transaction(async tx => {
      // Serialize acceptance per driver; conditional update prevents two drivers accepting one request.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
      const loc = await tx.driverLocation.findUnique({ where: { driverId: req.user.id } });
      if (!loc || Date.now() - loc.recordedAt.getTime() > config.LOCATION_MAX_AGE_SECONDS * 1000) throw new d.HttpError(409, 'Send a fresh GPS location before accepting');
      const active = await tx.assistanceRequest.count({ where: { driverId: req.user.id, status: { in: ['ACCEPTED', 'ARRIVED'] } } });
      if (active) throw new d.HttpError(409, 'Driver already has an active request');
      const updated = await tx.assistanceRequest.updateMany({ where: { id: req.params.id, status: 'PENDING', driverId: null, service: { in: req.user.services } }, data: { driverId: req.user.id, status: 'ACCEPTED', acceptedAt: new Date() } });
      if (!updated.count) throw new d.HttpError(409, 'Request unavailable or unsupported service');
      await tx.outbox.create({ data: { requestId: req.params.id } });
      return tx.assistanceRequest.findUnique({ where: { id: req.params.id } });
    });
    res.json(request);
  });
  app.patch('/api/v1/requests/:id/status', auth, async (req, res) => {
    const { status } = z.object({ status: z.enum(['ARRIVED', 'COMPLETED', 'CANCELLED']) }).strict().parse(req.body);
    const request = await s.ownedRequest(req.params.id, req.user);
    const allowed = req.user.role === 'CUSTOMER' ? status === 'CANCELLED' && request.status === 'PENDING' : (request.driverId === req.user.id && ((request.status === 'ACCEPTED' && status === 'ARRIVED') || (request.status === 'ARRIVED' && status === 'COMPLETED')));
    if (!allowed) throw new d.HttpError(409, 'Invalid status transition');
    await prisma.$transaction(async tx => {
      const updated = await tx.assistanceRequest.updateMany({ where: { id: request.id, status: request.status }, data: { status } });
      if (!updated.count) throw new d.HttpError(409, 'Request changed; reload');
      await tx.outbox.create({ data: { requestId: request.id } });
    });
    res.json(await s.ownedRequest(request.id, req.user));
  });
  app.put('/api/v1/drivers/location', auth, role('DRIVER'), limit('gps', 120, 60), async (req, res) => res.json(await s.updateLocation(req.user, d.location.parse(req.body))));
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Phone or national ID already registered for this role' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    const status = err.status >= 400 && err.status < 500 ? err.status : err.status === 503 ? 503 : 500;
    if (status === 500) console.error({ error: err.message, code: err.code });
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
  });
  return app;
}
module.exports = { createApp };
