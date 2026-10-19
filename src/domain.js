const { z } = require('zod');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const services = ['REPAIR', 'MOBILE_CARWASH', 'PERIODIC_SERVICE', 'TOWING', 'INSPECTION'];
const digits = value => value.replace(/[۰-۹٠-٩]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const phone = z.string().transform(v => digits(v).replace(/^\+98/, '0')).pipe(z.string().regex(/^09\d{9}$/));
function validNationalId(v) {
  if (!/^\d{10}$/.test(v) || /^(\d)\1{9}$/.test(v)) return false;
  const remainder = [...v.slice(0, 9)].reduce((sum, n, i) => sum + Number(n) * (10 - i), 0) % 11;
  return Number(v[9]) === (remainder < 2 ? remainder : 11 - remainder);
}
const documentRef = z.object({ id: z.string().uuid(), token: z.string().min(32).max(128) }).strict();
const vehicle = z.object({ name: z.string().trim().min(2).max(100), plate: z.string().trim().min(4).max(30), documents: z.array(documentRef).max(10).default([]) }).strict();
const common = { fullName: z.string().trim().min(3).max(150), phone, password: z.string().min(8).max(128), nationalId: z.string().transform(digits).refine(validNationalId, 'Invalid national ID') };
const customerRegistration = z.object({ ...common, identityDocument: documentRef.optional(), vehicles: z.array(vehicle).max(20).default([]) }).strict();
const driverRegistration = z.object({ ...common, vehiclePlate: vehicle.shape.plate, vehicleType: z.string().trim().min(2).max(100), services: z.array(z.enum(services)).min(1).max(5).transform(v => [...new Set(v)]), identityDocument: documentRef }).strict();
const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
const baseRequest = { vehicleName: vehicle.shape.name, vehiclePlate: vehicle.shape.plate, origin: point };
const towing = z.object({ ...baseRequest, destination: point }).strict();
const repair = z.object({ ...baseRequest, problem: z.string().trim().min(3).max(2000) }).strict();
const location = point.extend({ recordedAt: z.iso.datetime() }).strict();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, digest] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}
function priceFor(distance, base, perKm) {
  const price = base + Math.ceil(distance / 1000) * perKm;
  if (!Number.isSafeInteger(price) || price > 2147483647) throw new Error('Price exceeds supported range');
  return price;
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
module.exports = { services, phone, documentRef, vehicle, customerRegistration, driverRegistration, point, towing, repair, location, hash, hashPassword, verifyPassword, priceFor, HttpError, validNationalId };
