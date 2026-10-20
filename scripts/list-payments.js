// Read-only queue for an operator with server/database access.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.payment.findMany({
  where: { status: 'SUBMITTED' }, orderBy: { createdAt: 'asc' }, take: 100,
  select: { id: true, requestId: true, amountToman: true, cardNumber: true, attempts: { orderBy: { createdAt: 'desc' }, take: 1, select: { bankReference: true, transferredAt: true } } },
}).then(rows => console.log(JSON.stringify(rows, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
