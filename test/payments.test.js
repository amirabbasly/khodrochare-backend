const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitAmount, createPayments, settleEarning, CARD_NUMBER } = require('../src/payments');
test('commission includes service AND parts, with exact 30/70 and 20/80 splits', () => {
  assert.deepEqual(splitAmount('REPAIR', 800000, 200000), { serviceToman: 800000, partsToman: 200000, amountToman: 1000000, commissionPercent: 30, commissionToman: 300000, driverShareToman: 700000 });
  assert.equal(splitAmount('TOWING', 1000000, 200000).commissionToman, 240000);
  const odd = splitAmount('REPAIR', 800001, 0);
  assert.equal(odd.commissionToman + odd.driverShareToman, odd.amountToman);
  for (const amount of [-1, 1.5, NaN, 2147483648]) assert.throws(() => splitAmount('REPAIR', amount, 0));
  assert.throws(() => splitAmount('UNKNOWN', 1000));
  assert.equal(CARD_NUMBER, '6219861435789192');
});
function database(request) {
  let payment = null;
  const attempts = [];
  const earnings = new Map();
  const tx = {
    $queryRaw: async () => [],
    assistanceRequest: { findUnique: async () => request ? { ...request, payment } : null },
    payment: {
      findUnique: async () => payment ? { ...payment, attempts: attempts.filter(a => a.status === 'SUBMITTED').slice(-1), request } : null,
      create: async ({ data }) => (payment = { ...data, id: 'payment', status: 'AWAITING_TRANSFER', createdAt: new Date(Date.now() - 60000), attempts: [] }),
      update: async ({ data }) => { Object.assign(payment, data); return { ...payment, attempts }; },
    },
    paymentAttempt: {
      create: async ({ data }) => { if (attempts.some(a => a.bankReference === data.bankReference)) throw Object.assign(new Error('Duplicate reference'), { code: 'P2002' }); attempts.push({ ...data, id: `attempt-${attempts.length}`, status: 'SUBMITTED' }); },
      update: async ({ where, data }) => Object.assign(attempts.find(a => a.id === where.id), data),
    },
    driverEarning: { createMany: async ({ data }) => { for (const entry of data) if (!earnings.has(entry.paymentId)) earnings.set(entry.paymentId, entry); } },
    outbox: { create: async () => {} },
  };
  return { prisma: { $transaction: callback => callback(tx) }, tx, attempts, earnings, payment: () => payment };
}
test('repair payment requires customer-approved parts and uses the stored total', async () => {
  const request = { id: 'r', customerId: 'c', driverId: 'd', service: 'REPAIR', priceToman: 800000, status: 'ARRIVED', partsApprovedToman: null };
  const db = database(request); const payments = createPayments(db.prisma);
  await assert.rejects(payments.getOrCreate('r', 'stranger'), { status: 404 });
  await assert.rejects(payments.getOrCreate('r', 'c'), { status: 409 });
  request.partsApprovedToman = 200000;
  const result = await payments.getOrCreate('r', 'c');
  assert.equal(result.amountToman, 1000000); assert.equal(result.driverShareToman, 700000);
  assert.equal((await payments.getOrCreate('r', 'c')).id, result.id);
});
test('reporting a transfer never credits the driver; verification and completion are both required', async () => {
  const request = { id: 'r', customerId: 'c', driverId: 'd', service: 'TOWING', priceToman: 1000000, status: 'ARRIVED' };
  const db = database(request); const payments = createPayments(db.prisma);
  await payments.getOrCreate('r', 'c');
  await payments.submit('r', 'c', { bankReference: '1234567890', transferredAt: new Date().toISOString() });
  assert.equal(db.payment().status, 'SUBMITTED'); assert.equal(db.earnings.size, 0);
  await payments.review('payment', true, 'bank-reviewer', 'Matched bank statement');
  assert.equal(db.earnings.size, 0);
  request.status = 'COMPLETED';
  await settleEarning(db.tx, 'r'); await settleEarning(db.tx, 'r');
  assert.equal(db.earnings.size, 1); assert.equal(db.earnings.get('payment').amountToman, 800000);
  await assert.rejects(payments.review('payment', true, 'reviewer'), { status: 409 });
});
test('completion before bank verification settles on verification, and rejected reports preserve history', async () => {
  const request = { id: 'r', customerId: 'c', driverId: 'd', service: 'REPAIR', priceToman: 800000, partsApprovedToman: 200000, status: 'COMPLETED' };
  const db = database(request); const payments = createPayments(db.prisma);
  await payments.getOrCreate('r', 'c');
  await payments.submit('r', 'c', { bankReference: 'first123', transferredAt: new Date().toISOString() });
  await payments.review('payment', false, 'reviewer', 'Not found');
  assert.equal(db.earnings.size, 0); assert.equal(db.attempts[0].status, 'REJECTED');
  await payments.submit('r', 'c', { bankReference: 'second123', transferredAt: new Date().toISOString() });
  await payments.review('payment', true, 'reviewer');
  assert.equal(db.attempts.length, 2); assert.equal(db.earnings.size, 1);
  assert.equal(db.earnings.get('payment').amountToman, 700000);
});
