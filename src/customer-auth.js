const { randomInt, randomUUID, createHmac, timingSafeEqual } = require('node:crypto');
const { z } = require('zod');
const d = require('./domain');
const { profileComplete } = require('./customer-profile');
const { createNiazpardaz } = require('./niazpardaz');
const { assertDeletable, eraseCustomer } = require('./customer-deletion');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setSessionCookie, clearSessionCookie } = require('./session-cookies');
const OTP_SECONDS = 300, RESEND_SECONDS = 60, MAX_ATTEMPTS = 5;
const invalidCode = () => new d.HttpError(400, 'کد تأیید نادرست است یا مهلت آن تمام شده؛ کد جدید دریافت کنید.');
const otpHash = (secret, id, phone, purpose, code) => createHmac('sha256', secret).update(JSON.stringify([id, phone, purpose, code])).digest('hex');

function createCustomerAuth({ prisma, config, services, sms = createNiazpardaz(config), now = () => new Date(), generateCode = () => String(randomInt(100000, 1000000)) }) {
  const secret = config.OTP_HMAC_SECRET || config.NIAZPARDAZ_API_KEY;
  async function requestCode({ phone, purpose }) {
    if (!sms.enabled || !secret) throw new d.HttpError(503, 'ارسال کد تأیید هنوز در سرور تنظیم نشده است.');
    const at = now(), id = randomUUID(), code = generateCode();
    const expiresAt = new Date(at.getTime() + OTP_SECONDS * 1000);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('customer-otp'),hashtext(${phone}))::text AS locked`;
      const latest = await tx.customerOtpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
      if (latest && at.getTime() - latest.createdAt.getTime() < RESEND_SECONDS * 1000) throw new d.HttpError(429, 'برای دریافت کد جدید، یک دقیقه از آخرین درخواست صبر کنید.');
      const [hour, day] = await Promise.all([
        tx.customerOtpChallenge.count({ where: { phone, createdAt: { gte: new Date(at.getTime() - 3600000) } } }),
        tx.customerOtpChallenge.count({ where: { phone, createdAt: { gte: new Date(at.getTime() - 86400000) } } }),
      ]);
      if (hour >= 5 || day >= 10) throw new d.HttpError(429, 'تعداد درخواست‌های کد برای این شماره بیش از حد مجاز است؛ بعداً تلاش کنید.');
      await tx.customerOtpChallenge.updateMany({ where: { phone, status: { in: ['SENDING', 'SENT'] } }, data: { status: 'INVALIDATED' } });
      await tx.customerOtpChallenge.create({ data: { id, phone, purpose, codeHash: otpHash(secret, id, phone, purpose, code), expiresAt, createdAt: at } });
    });
    try {
      await sms.sendCode(phone, code);
      const result = await prisma.customerOtpChallenge.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'SENT', sentAt: now() } });
      if (!result.count) throw new d.HttpError(409, 'کد جدیدتری درخواست شده است؛ آخرین کد را وارد کنید.');
    } catch (error) {
      await prisma.customerOtpChallenge.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'FAILED' } });
      throw error instanceof d.HttpError ? error : new d.HttpError(503, 'ارسال کد انجام نشد؛ دوباره تلاش کنید.');
    }
    return { challengeId: id, expiresInSeconds: Math.max(0, Math.floor((expiresAt - now()) / 1000)), retryAfterSeconds: Math.max(0, Math.ceil((at.getTime() + RESEND_SECONDS * 1000 - now().getTime()) / 1000)) };
  }

  async function requestDeletion(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'CUSTOMER' || user.deletedAt) throw new d.HttpError(401, 'Authentication required');
    await assertDeletable(prisma, userId);
    return requestCode({ phone: user.phone, purpose: 'DELETE_ACCOUNT' });
  }

  async function consume(input, reset = false, deletionUserId = null) {
    const outcome = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CustomerOtpChallenge" WHERE id=${input.challengeId} FOR UPDATE`;
      const challenge = await tx.customerOtpChallenge.findUnique({ where: { id: input.challengeId } });
      if (!secret || !challenge || challenge.status !== 'SENT' || challenge.expiresAt <= now() || challenge.attempts >= MAX_ATTEMPTS || (deletionUserId ? challenge.purpose !== 'DELETE_ACCOUNT' : reset ? challenge.purpose !== 'RESET_PASSWORD' : !['REGISTER', 'LOGIN'].includes(challenge.purpose))) return { error: invalidCode() };
      let deletingUser;
      if (deletionUserId) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${deletionUserId} FOR UPDATE`;
        deletingUser = await tx.user.findUnique({ where: { id: deletionUserId } });
        if (!deletingUser || deletingUser.role !== 'CUSTOMER' || deletingUser.deletedAt || deletingUser.phone !== challenge.phone) return { error: invalidCode() };
      }
      const expected = Buffer.from(challenge.codeHash, 'hex');
      const actual = Buffer.from(otpHash(secret, challenge.id, challenge.phone, challenge.purpose, input.code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        const attempts = challenge.attempts + 1;
        await tx.customerOtpChallenge.update({ where: { id: challenge.id }, data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { status: 'LOCKED' } : {}) } });
        return { error: invalidCode() }; // Commit failed-attempt counters before throwing.
      }
      await tx.customerOtpChallenge.update({ where: { id: challenge.id }, data: { status: 'USED', consumedAt: now() } });
      if (deletingUser) return eraseCustomer(tx, deletingUser, now());
      let user = await tx.user.findUnique({ where: { role_phone: { role: 'CUSTOMER', phone: challenge.phone } } });
      if (reset) {
        if (!user) return { error: new d.HttpError(400, 'برای این شماره حساب مشتری وجود ندارد؛ ابتدا ثبت‌نام کنید.') };
        const passwordHash = await d.hashPassword(input.password);
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, phoneVerifiedAt: now() } });
        await tx.session.deleteMany({ where: { userId: user.id } });
        return { resetUserId: user.id };
      }
      if (!user && challenge.purpose === 'LOGIN') return { error: new d.HttpError(400, 'این شماره هنوز ثبت‌نام نکرده است؛ از بخش ثبت‌نام اقدام کنید.') };
      if (!user) user = await tx.user.upsert({ where: { role_phone: { role: 'CUSTOMER', phone: challenge.phone } }, create: { role: 'CUSTOMER', phone: challenge.phone, fullName: 'کاربر خودرو چاره', nationalId: null, passwordHash: null, services: [], phoneVerifiedAt: now() }, update: { phoneVerifiedAt: now() } });
      else user = await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: now() } });
      return { session: await services.session(user, tx) };
    }, deletionUserId ? { isolationLevel: 'Serializable' } : undefined).catch(error => {
      if (deletionUserId && error.code === 'P2034') throw new d.HttpError(409, 'وضعیت حساب هم‌زمان تغییر کرد؛ دوباره حذف حساب را تأیید کنید.');
      throw error;
    });
    if (outcome.error) throw outcome.error;
    return outcome;
  }

  async function completeProfile(userId, input) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current || current.role !== 'CUSTOMER') throw new d.HttpError(403, 'Customer role required');
      if (profileComplete(current)) return services.safeUser(current);
      if (!current.passwordHash && !input.password) throw new d.HttpError(400, 'برای حساب خود رمز عبور تعیین کنید.');
      if (current.passwordHash && input.password) throw new d.HttpError(400, 'برای تغییر رمز عبور از بازیابی رمز استفاده کنید.');
      const updated = await tx.user.update({ where: { id: userId }, data: { fullName: input.fullName, nationalId: input.nationalId, ...(!current.passwordHash ? { passwordHash: await d.hashPassword(input.password) } : {}) } });
      return services.safeUser(updated);
    });
  }
  return { requestCode, requestDeletion, consume, completeProfile };
}

function registerCustomerAuth({ app, prisma, config, services, auth, role, limit, io, sms }) {
  const service = createCustomerAuth({ prisma, config, services, sms });
  const root = '/api/v1/auth/customers';
  const codeInput = { challengeId: z.string().uuid(), code: z.string().transform(d.digits).pipe(z.string().regex(/^\d{6}$/)) };
  app.post('/api/v1/me/account-deletion/otp', auth, role('CUSTOMER'), limit('customer-delete-send', 10, 3600), async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await service.requestDeletion(req.user.id));
  });
  app.delete('/api/v1/me', auth, role('CUSTOMER'), limit('customer-delete-confirm', 20, 900), async (req, res) => {
    const input = z.object({ ...codeInput, confirmation: z.literal('DELETE') }).strict().parse(req.body);
    const { deletedUserId, removedFiles } = await service.consume(input, false, req.user.id);
    clearSessionCookie(res, 'CUSTOMER', config);
    io.in(`user:${deletedUserId}`).disconnectSockets(true);
    // The database revokes access atomically; delete private disk files only
    // after commit. Never resolve an arbitrary path from a stored key.
    for (const key of removedFiles) {
      if (!key || path.basename(key) !== key || !/^[a-zA-Z0-9-]+$/.test(key)) continue;
      try { await fs.unlink(path.join(config.UPLOAD_DIR, key)); }
      catch (error) { if (error.code !== 'ENOENT') console.error('Deleted account file cleanup:', error.code || 'FAILED'); }
    }
    res.set('Cache-Control', 'no-store').json({ deleted: true });
  });
  app.post(root + '/otp/request', limit('customer-otp-send', 20, 3600), async (req, res) => {
    const input = z.object({ phone: d.phone, purpose: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']) }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await service.requestCode(input));
  });
  app.post(root + '/otp/verify', limit('customer-otp-verify', 60, 900), async (req, res) => {
    const input = z.object({ ...codeInput, remember: z.boolean().default(true) }).strict().parse(req.body);
    const { session } = await service.consume(input);
    setSessionCookie(res, session, config, input.remember);
    res.set('Cache-Control', 'no-store').json(session);
  });
  app.post(root + '/password/reset', limit('customer-password-reset', 20, 900), async (req, res) => {
    const input = z.object({ ...codeInput, password: z.string().min(8).max(128) }).strict().parse(req.body);
    const { resetUserId } = await service.consume(input, true);
    io.in(`user:${resetUserId}`).disconnectSockets(true);
    clearSessionCookie(res, 'CUSTOMER', config);
    res.set('Cache-Control', 'no-store').json({ reset: true });
  });
  app.post('/api/v1/me/complete-profile', auth, role('CUSTOMER'), limit('customer-profile', 20, 900), async (req, res) => {
    const input = z.object({ fullName: z.string().trim().min(3).max(150), nationalId: z.string().transform(d.digits).refine(d.validNationalId, 'کد ملی معتبر نیست.'), password: z.string().min(8).max(128).optional() }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await service.completeProfile(req.user.id, input));
  });
}
async function cleanupCustomerOtps(prisma) {
  await prisma.customerOtpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 2 * 86400000) } } });
}
module.exports = { createCustomerAuth, registerCustomerAuth, cleanupCustomerOtps, otpHash, OTP_SECONDS, RESEND_SECONDS };
