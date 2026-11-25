const { HttpError } = require('./domain');

async function assertDeletable(db, userId) {
  const [request, checkout, order, payment, wallet, receipt, spent] = await Promise.all([
    db.assistanceRequest.findFirst({ where: { customerId: userId, status: { in: ['PENDING', 'ACCEPTED', 'ARRIVED'] } }, select: { id: true } }),
    db.gatewayCheckout.findFirst({ where: { userId, status: { in: ['CREATING', 'PENDING', 'REFUND_REQUIRED', 'DUPLICATE_PAYMENT'] } }, select: { id: true } }),
    db.hallOrder.findFirst({ where: { userId, status: { in: ['CREATING', 'PENDING', 'REFUND_REQUIRED', 'REVIEW_REQUIRED'] } }, select: { id: true } }),
    db.payment.findFirst({ where: { request: { customerId: userId }, OR: [{ status: 'REFUND_REQUIRED' }, { status: { in: ['AWAITING_PAYMENT', 'AWAITING_TRANSFER', 'SUBMITTED', 'GATEWAY_PENDING'] }, request: { status: { notIn: ['CANCELLED','EXPIRED'] } } }] }, select: { id: true } }),
    db.walletEntry.aggregate({ where: { userId, mode: 'live' }, _sum: { amountToman: true } }),
    db.walletReceipt.findFirst({where:{userId,status:'SUBMITTED'},select:{id:true}}),
    db.walletDebit.aggregate({where:{userId},_sum:{amountToman:true}}),
  ]);
  if (request) throw new HttpError(409, 'پیش از حذف حساب، درخواست امداد فعال خود را پایان دهید یا لغو کنید.');
  if (checkout || order) throw new HttpError(409, 'یک پرداخت درگاه یا بازپرداخت هنوز تعیین تکلیف نشده است؛ ابتدا وضعیت آن را از بخش پرداخت بررسی کنید.');
  if (payment) throw new HttpError(409, 'هزینهٔ یکی از خدمات هنوز تأیید یا تسویه نشده است؛ ابتدا پرداخت آن را تکمیل کنید.');
  if(receipt)throw new HttpError(409,'رسید واریز شما در انتظار بررسی است؛ ابتدا نتیجهٔ آن مشخص شود.');
  if ((wallet._sum.amountToman||0)-(spent._sum.amountToman||0)) throw new HttpError(409, 'کیف پول شما موجودی دارد؛ برای تسویهٔ موجودی پیش از حذف حساب با پشتیبانی تماس بگیرید.');
}

async function eraseCustomer(tx, user, at) {
  await assertDeletable(tx, user.id);
  const documents = await tx.document.findMany({ where: { OR: [{ ownerId: user.id }, { vehicle: { userId: user.id } }] }, select: { id: true, storageKey: true } });
  const photos = await tx.hallPhoto.findMany({ where: { listing: { ownerId: user.id } }, select: { storageKey: true } });
  // Keep anonymous references required by historical transactions and other
  // participants; erase login credentials and personal profile information.
  await tx.user.update({ where: { id: user.id }, data: { fullName: 'حساب حذف‌شده', phone: `deleted:${user.id}`, nationalId: null, passwordHash: null, phoneVerifiedAt: null, identityDocumentId: null, vehiclePlate: null, vehicleType: null, services: [], deletedAt: at } });
  await tx.session.deleteMany({ where: { userId: user.id } });
  await tx.customerOtpChallenge.deleteMany({ where: { phone: user.phone } });
  await tx.userLocation.deleteMany({ where: { userId: user.id } });
  await tx.marketAlert.deleteMany({ where: { userId: user.id } });
  await tx.supportTicket.deleteMany({ where: { userId: user.id } });
  await tx.hallInquiry.deleteMany({ where: { userId: user.id } });
  await tx.hallMessage.deleteMany({ where: { senderId: user.id } });
  await tx.hallPhoto.deleteMany({ where: { listing: { ownerId: user.id } } });
  await tx.hallListing.updateMany({ where: { ownerId: user.id }, data: { status: 'DELETED', draft: {}, searchText: '', inspectionNote: null, featuredUntil: null, urgentUntil: null, ladderUntil: null, version: { increment: 1 } } });
  if (documents.length) await tx.document.deleteMany({ where: { id: { in: documents.map(row => row.id) } } });
  await tx.vehicle.deleteMany({ where: { userId: user.id } });
  return { deletedUserId: user.id, removedFiles: [...documents, ...photos].map(row => row.storageKey) };
}
module.exports = { assertDeletable, eraseCustomer };
