const { z } = require('zod');
const d = require('./domain');
const { createCustomerAuth } = require('./customer-auth');
const { setSessionCookie, clearSessionCookie } = require('./session-cookies');
function registerDriverAuth({ app, prisma, config, services, limit, io, sms }) {
  const service = createCustomerAuth({ prisma, config, services, sms, accountRole: 'DRIVER', registerDriver: async (tx, input) => {
    const { password, identityDocument, ...data } = input;
    const user = await tx.user.create({ data: { ...data, role: 'DRIVER', passwordHash: await d.hashPassword(password), phoneVerifiedAt: new Date() } });
    await services.claimDocument(tx, identityDocument, user.id);
    return tx.user.update({ where: { id: user.id }, data: { identityDocumentId: identityDocument.id } });
  } });
  const root = '/api/v1/auth/drivers';
  const code = { challengeId: z.string().uuid(), code: z.string().transform(d.digits).pipe(z.string().regex(/^\d{6}$/)) };
  app.post(root + '/otp/request', limit('driver-otp-send', 20, 3600), async (req, res) => {
    const input = z.object({ phone: d.phone, purpose: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']) }).strict().parse(req.body);
    if (input.purpose !== 'REGISTER' && !await prisma.user.findUnique({ where: { role_phone: { role: 'DRIVER', phone: input.phone } } })) throw new d.HttpError(400, 'ابتدا ثبت‌نام ناوگان را تکمیل کنید.');
    res.set('Cache-Control', 'no-store').json(await service.requestCode(input));
  });
  app.post(root + '/otp/verify', limit('driver-otp-verify', 60, 900), async (req, res) => {
    const input = z.object({ ...code, remember: z.boolean().default(true) }).strict().parse(req.body);
    const { session } = await service.consume(input);
    setSessionCookie(res, session, config, input.remember);
    res.set('Cache-Control', 'no-store').json(session);
  });
  app.post(root + '/register', limit('driver-register', 10, 3600), async (req, res) => {
    const { challengeId, code: value, ...body } = req.body || {};
    const registration = d.driverRegistration.parse(body);
    const input = z.object(code).parse({ challengeId, code: value });
    const { session } = await service.consume({ ...input, registration });
    setSessionCookie(res, session, config);
    res.status(201).set('Cache-Control', 'no-store').json(session);
  });
  app.post(root + '/password/reset', limit('driver-reset', 20, 900), async (req, res) => {
    const input = z.object({ ...code, password: z.string().min(8).max(128) }).strict().parse(req.body);
    const { resetUserId } = await service.consume(input, true);
    io.in(`user:${resetUserId}`).disconnectSockets(true);
    clearSessionCookie(res, 'DRIVER', config);
    res.set('Cache-Control', 'no-store').json({ reset: true });
  });
}
module.exports = { registerDriverAuth };
