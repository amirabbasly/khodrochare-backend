const { HttpError } = require('./domain');
const CARD_NUMBER = '6219861435789192';
const ACCOUNT_NAME = 'حساب خودرو چاره';
function splitAmount(service, serviceToman, partsToman = 0) {
  if (!['REPAIR', 'TOWING'].includes(service)) throw new HttpError(400, 'Unsupported payment service');
  const amountToman = serviceToman + partsToman;
  if (![serviceToman, partsToman].every(n => Number.isSafeInteger(n) && n >= 0) || amountToman < 1 || amountToman > 2147483647) throw new HttpError(400, 'Invalid payment amount');
  const commissionPercent = service === 'REPAIR' ? 30 : 20;
  const commissionToman = Math.round(amountToman * commissionPercent / 100);
  return { serviceToman, partsToman, amountToman, commissionPercent, commissionToman, driverShareToman: amountToman - commissionToman };
}
async function lockRequest(tx, id) { await tx.$queryRaw`SELECT id FROM "AssistanceRequest" WHERE id=${id} FOR UPDATE`; }
async function settleEarning(tx, requestId) {
  const request = await tx.assistanceRequest.findUnique({ where: { id: requestId }, include: { payment: true } });
  if (request?.status !== 'COMPLETED' || !request.driverId || request.payment?.status !== 'VERIFIED') return;
  const payment = request.payment;
  await tx.driverEarning.createMany({ data: [{ paymentId: payment.id, driverId: request.driverId, amountToman: payment.driverShareToman, commissionToman: payment.commissionToman }], skipDuplicates: true });
}
function createPayments(prisma) {
  async function getOrCreate(requestId, customerId) {
    return prisma.$transaction(async tx => {
      await lockRequest(tx, requestId);
      const request = await tx.assistanceRequest.findUnique({ where: { id: requestId } });
      if (!request || request.customerId !== customerId) throw new HttpError(404, 'Request not found');
      if (request.status === 'CANCELLED') throw new HttpError(409, 'Cancelled request cannot be paid');
      const existing = await tx.payment.findUnique({ where: { requestId }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      if (existing) return existing;
      if (request.priceToman == null) throw new HttpError(409, 'Final service amount requires agreement');
      if (request.service === 'REPAIR' && request.partsApprovedToman == null) throw new HttpError(409, 'Parts quote must be approved before payment');
      const amounts = splitAmount(request.service, request.priceToman, request.partsApprovedToman || 0);
      return tx.payment.create({ data: { requestId, ...amounts, cardNumber: CARD_NUMBER, accountName: ACCOUNT_NAME }, include: { attempts: true } });
    });
  }
  async function submit(requestId, customerId, input) {
    return prisma.$transaction(async tx => {
      await lockRequest(tx, requestId);
      const request = await tx.assistanceRequest.findUnique({ where: { id: requestId } });
      if (!request || request.customerId !== customerId) throw new HttpError(404, 'Request not found');
      const payment = await tx.payment.findUnique({ where: { requestId } });
      if (!payment || request.status === 'CANCELLED' || !['AWAITING_TRANSFER', 'REJECTED'].includes(payment.status)) throw new HttpError(409, 'Payment cannot be submitted in this state');
      const transferredAt = new Date(input.transferredAt);
      if (transferredAt > new Date(Date.now() + 60000) || transferredAt.getTime() < payment.createdAt.getTime() - 60000) throw new HttpError(400, 'Invalid transfer time');
      await tx.paymentAttempt.create({ data: { paymentId: payment.id, bankReference: input.bankReference, transferredAt } });
      const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUBMITTED' }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      await tx.outbox.create({ data: { requestId } });
      return updated;
    });
  }
  async function review(paymentId, approve, operator, note = '') {
    if (!operator?.trim()) throw new HttpError(400, 'Operator is required');
    return prisma.$transaction(async tx => {
      const initial = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!initial) throw new HttpError(404, 'Payment not found');
      await lockRequest(tx, initial.requestId);
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { attempts: { where: { status: 'SUBMITTED' }, orderBy: { createdAt: 'desc' }, take: 1 }, request: true } });
      if (payment.status !== 'SUBMITTED' || !payment.attempts[0] || payment.request.status === 'CANCELLED') throw new HttpError(409, 'Payment is not awaiting review');
      await tx.paymentAttempt.update({ where: { id: payment.attempts[0].id }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedBy: operator.trim(), reviewNote: note.slice(0, 1000), reviewedAt: new Date() } });
      const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: approve ? 'VERIFIED' : 'REJECTED', verifiedAt: approve ? new Date() : null } });
      await settleEarning(tx, payment.requestId);
      await tx.outbox.create({ data: { requestId: payment.requestId } });
      return updated;
    });
  }
  return { getOrCreate, submit, review };
}
module.exports = { createPayments, splitAmount, lockRequest, settleEarning, CARD_NUMBER, ACCOUNT_NAME };
