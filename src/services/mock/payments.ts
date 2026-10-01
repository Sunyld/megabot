import { sellerWallets } from '@/mocks';
import type { Payment, PaymentMethod } from '@/types';
import { isSameDay } from '@/utils/format';

import type { PaymentsService } from '../types';
import { db, notFound, ownedBy, request } from './db';
import { runActivationPipeline } from './pipeline';

const find = (tenantId: string, id: string) =>
  db.payments.filter(ownedBy(tenantId)).find((p) => p.id === id) ?? notFound('Pagamento');

const matchesSearch = (payment: Payment, search?: string) => {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return [payment.transactionId, payment.orderCode, payment.payerName, payment.payerNumber]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
};

export const mockPaymentsService: PaymentsService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.payments
          .filter(ownedBy(tenantId))
          .filter((p) => (params.filter && params.filter !== 'all' ? p.status === params.filter : true))
          .filter((p) => matchesSearch(p, params.search)),
      { list: true }
    ),

  summary: () =>
    request((tenantId) => {
      const today = db.payments.filter(ownedBy(tenantId)).filter((p) => isSameDay(p.receivedAt, Date.now()));
      const count = (status: Payment['status']) => today.filter((p) => p.status === status).length;
      return {
        received: today.length,
        confirmed: count('confirmed'),
        pending: count('pending'),
        review: count('review'),
        rejected: count('rejected'),
        confirmedAmount: today.filter((p) => p.status === 'confirmed').reduce((sum, p) => sum + p.amount, 0),
      };
    }, { empty: () => ({ received: 0, confirmed: 0, pending: 0, review: 0, rejected: 0, confirmedAmount: 0 }) }),

  get: (id) => request((tenantId) => find(tenantId, id)),

  approve: (id) =>
    request((tenantId) => {
      const payment = find(tenantId, id);
      payment.status = 'confirmed';
      payment.confirmedBy = 'manual';
      const order = db.orders.find((o) => o.id === payment.orderId);
      if (order) {
        order.events.push({
          id: `${order.code}-approve`,
          type: 'payment_confirmed',
          at: new Date().toISOString(),
          description: 'Aprovado manualmente pelo vendedor',
        });
        runActivationPipeline(order.id);
      }
      return payment;
    }),

  listAccounts: () =>
    request(() =>
      (['emola', 'mpesa'] as PaymentMethod[]).map((method) => {
        const wallet = sellerWallets[method];
        return {
          method,
          account: wallet.account,
          holderName: 'ARLINDO DA MARGARIDA ABDUL AMANDIO AUGUSTO',
          monitoredBy: { deviceId: wallet.deviceId, deviceName: wallet.deviceName, simSlot: wallet.simSlot },
        };
      })
    ),

  reject: (id, reason) =>
    request((tenantId) => {
      const payment = find(tenantId, id);
      payment.status = 'rejected';
      payment.reviewReason = reason;
      const order = db.orders.find((o) => o.id === payment.orderId);
      if (order) {
        order.status = 'cancelled';
        order.events.push({
          id: `${order.code}-reject`,
          type: 'cancelled',
          at: new Date().toISOString(),
          description: `Pagamento rejeitado — ${reason}`,
        });
      }
      return payment;
    }),
};
