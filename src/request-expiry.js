const PENDING_REQUEST_LIFETIME_MS = 6 * 60 * 60 * 1000;
const pendingRequestCutoff = (now = new Date()) => new Date(now.getTime() - PENDING_REQUEST_LIFETIME_MS);
const isPendingRequestExpired = (request, now = new Date()) => request.status === 'PENDING' && !request.driverId && new Date(request.createdAt) <= pendingRequestCutoff(now);
const isRequestExpired = (request, now = new Date()) => request.status === 'EXPIRED' || isPendingRequestExpired(request, now);

// Row locks and a conditional UPDATE serialize expiration against acceptance.
// SKIP LOCKED also allows multiple API processes to sweep safely.
async function expirePendingRequests(prisma, now = new Date(), limit = 200) {
  const cutoff = pendingRequestCutoff(now);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw`
      WITH due AS (
        SELECT id FROM "AssistanceRequest"
        WHERE status = 'PENDING' AND "driverId" IS NULL AND "createdAt" <= ${cutoff}
        ORDER BY "createdAt", id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE "AssistanceRequest" AS request
      SET status = 'EXPIRED'::"RequestStatus", "updatedAt" = ${now}
      FROM due WHERE request.id = due.id AND request.status = 'PENDING' AND request."driverId" IS NULL
      RETURNING request.id`;
    if (rows.length) {
      await tx.payment.updateMany({ where: { requestId: { in: rows.map(row => row.id) }, status: { in: ['SUBMITTED', 'VERIFIED', 'GATEWAY_PENDING'] } }, data: { status: 'REFUND_REQUIRED' } });
      await tx.outbox.createMany({ data: rows.map(row => ({ requestId: row.id })) });
    }
    return rows.length;
  });
}
module.exports = { PENDING_REQUEST_LIFETIME_MS, pendingRequestCutoff, isPendingRequestExpired, isRequestExpired, expirePendingRequests };
