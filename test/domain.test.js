const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/domain');
function nationalId() {
  const prefix = '123456789';
  const rem = [...prefix].reduce((s, v, i) => s + Number(v) * (10 - i), 0) % 11;
  return prefix + (rem < 2 ? rem : 11 - rem);
}
test('Iranian national ID checks reject repeated digits and incorrect checksum', () => {
  assert.equal(d.validNationalId(nationalId()), true);
  assert.equal(d.validNationalId('1111111111'), false);
  assert.equal(d.validNationalId('1234567890'), false);
});
test('customer signup normalizes Persian digits and requires all identity fields', () => {
  const input = { fullName: 'کاربر آزمایشی', phone: '+989121234567', password: 'strong-password', nationalId: nationalId() };
  assert.equal(d.customerRegistration.parse(input).phone, '09121234567');
  assert.equal(d.phone.parse('۰۹۱۲۱۲۳۴۵۶۷'), '09121234567');
  for (const key of ['fullName', 'phone', 'password', 'nationalId']) {
    const copy = { ...input }; delete copy[key];
    assert.equal(d.customerRegistration.safeParse(copy).success, false);
  }
  assert.equal(d.customerRegistration.safeParse({ ...input, role: 'DRIVER' }).success, false);
});
test('driver requires document, plate, vehicle type and at least one recognized service', () => {
  const base = { fullName: 'امدادگر تست', phone: '09121234567', password: 'strong-password', nationalId: nationalId(), vehiclePlate: '12ب34567', vehicleType: 'نیسان', services: ['REPAIR'], identityDocument: { id: 'b771a129-21c5-4f11-93b7-32dba57fd036', token: 'a'.repeat(64) } };
  assert.equal(d.driverRegistration.safeParse(base).success, true);
  for (const key of ['identityDocument', 'vehiclePlate', 'vehicleType', 'services']) {
    const copy = { ...base }; delete copy[key];
    assert.equal(d.driverRegistration.safeParse(copy).success, false);
  }
  assert.equal(d.driverRegistration.safeParse({ ...base, services: ['UNKNOWN'] }).success, false);
});
test('request types validate coordinates and service-specific fields', () => {
  const base = { vehicleName: 'پژو ۲۰۶', vehiclePlate: '12ب34567', origin: { latitude: 35.7, longitude: 51.4 } };
  assert.equal(d.towing.safeParse(base).success, false);
  assert.equal(d.repair.safeParse(base).success, false);
  assert.equal(d.repair.safeParse({ ...base, problem: 'روشن نمیشود' }).success, true);
  assert.equal(d.towing.safeParse({ ...base, destination: { latitude: 91, longitude: 51 } }).success, false);
  assert.equal(d.towing.safeParse({ ...base, destination: base.origin, priceToman: 1 }).success, false);
});
test('passwords use independent salts and verify correctly', async () => {
  const first = await d.hashPassword('test-password');
  const second = await d.hashPassword('test-password');
  assert.notEqual(first, second);
  assert.equal(await d.verifyPassword('test-password', first), true);
  assert.equal(await d.verifyPassword('wrong', first), false);
});
test('towing price rounds kilometers upward and prevents overflow', () => {
  assert.equal(d.priceFor(1001, 200000, 20000), 240000);
  assert.equal(d.priceFor(1000, 200000, 20000), 220000);
  assert.throws(() => d.priceFor(1e12, 200000, 20000));
});
