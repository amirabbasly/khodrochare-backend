// This command requires server/database access; there is no public payment-approval endpoint.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { createPayments } = require('../src/payments');
const [paymentId, action, operator, ...note] = process.argv.slice(2);
if (!paymentId || !['approve', 'reject'].includes(action) || !operator) {
  console.error('Usage: node scripts/review-payment.js PAYMENT_ID approve|reject OPERATOR [NOTE]');
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient();
  createPayments(prisma).review(paymentId, action === 'approve', operator, note.join(' '))
    .then(payment => console.log(JSON.stringify({ id: payment.id, status: payment.status, amountToman: payment.amountToman, commissionToman: payment.commissionToman, driverShareToman: payment.driverShareToman })))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
