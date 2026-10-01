import type { Order, OrderCounts, OrderEvent, OrderFilter, OrderStatus } from '@/types';

import { AppError } from '../errors';
import {
  assertValidCreateOrderInput,
  canTransition,
  invalidTransition,
  normalizeCancelReason,
  ORDER_FILTER_STATUSES,
} from '../orderRules';
import type { OrdersService } from '../types';
import { db, notFound, ownedBy, request } from './db';
import { runActivationPipeline } from './pipeline';

const matchesFilter = (order: Order, filter: OrderFilter = 'all') =>
  filter === 'all' || ORDER_FILTER_STATUSES[filter].includes(order.status);

const matchesSearch = (order: Order, search?: string) => {
  const q = search?.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return [order.code, order.destination, order.transactionId, order.customer.name, order.productName]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().replace(/\s+/g, '').includes(q));
};

const find = (tenantId: string, id: string) =>
  db.orders.filter(ownedBy(tenantId)).find((o) => o.id === id) ?? notFound('Pedido');

const stamp = (order: Order, type: OrderEvent['type'], description?: string, transition?: Pick<OrderEvent, 'fromStatus' | 'toStatus'>) => {
  const at = new Date().toISOString();
  order.events.push({ id: `${order.code}-m${order.events.length}`, type, at, description, ...transition });
  order.updatedAt = at;
};

/** Same rules as the database: only valid transitions, each one recorded. */
function transition(order: Order, to: OrderStatus, reason?: string | null) {
  if (order.status === to) return order;
  if (!canTransition(order.status, to)) throw invalidTransition(order.status, to);
  const from = order.status;
  order.status = to;
  if (to === 'CANCELLED') order.cancelReason = reason ?? null;
  stamp(order, to === 'CANCELLED' ? 'cancelled' : to === 'EXPIRED' ? 'expired' : 'status_changed', reason ?? undefined, {
    fromStatus: from,
    toStatus: to,
  });
  return order;
}

/** "MB-YYYYMMDD-XXXXXXXX", like generate_order_reference (migration 004). */
function newReference(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const random = Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
  return `MB-${date}-${random}`;
}

/** Idempotency keys already used, per tenant (mock equivalent of the unique constraint). */
const keys = new Map<string, string>();

export const mockOrdersService: OrdersService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.orders
          .filter(ownedBy(tenantId))
          .filter((o) => matchesFilter(o, params.filter) && matchesSearch(o, params.search)),
      { list: true }
    ),

  counts: () =>
    request((tenantId) => {
      const orders = db.orders.filter(ownedBy(tenantId));
      const counts = { all: orders.length } as OrderCounts;
      (Object.keys(ORDER_FILTER_STATUSES) as Exclude<OrderFilter, 'all'>[]).forEach((filter) => {
        counts[filter] = orders.filter((o) => matchesFilter(o, filter)).length;
      });
      return counts;
    }, { empty: () => ({ all: 0, pending: 0, paid: 0, processing: 0, completed: 0, failed: 0 }) }),

  get: (id) => request((tenantId) => find(tenantId, id)),

  async create(input) {
    const valid = assertValidCreateOrderInput(input);
    return request((tenantId) => {
      const product = db.products.filter(ownedBy(tenantId)).find((p) => p.id === valid.productId) ?? notFound('Produto');

      const keyId = valid.idempotencyKey ? `${tenantId}:${valid.idempotencyKey}` : null;
      const existingId = keyId ? keys.get(keyId) : undefined;
      if (existingId) {
        const existing = find(tenantId, existingId);
        if (existing.productId !== valid.productId || existing.destination !== valid.customerPhone) {
          throw new AppError('CONFLICT', 'Esta chave de idempotência já foi usada noutro pedido.', { reason: 'IDEMPOTENCY_KEY_REUSED' });
        }
        return existing;
      }
      if (product.status !== 'ACTIVE' || product.archivedAt) {
        throw new AppError('CONFLICT', 'Este produto não está à venda.', { reason: 'PRODUCT_NOT_AVAILABLE' });
      }

      const now = new Date().toISOString();
      const code = newReference();
      const order: Order = {
        id: `ord_live_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        tenantId,
        code,
        productId: product.id,
        productName: product.name,
        price: product.price,
        currency: product.currency,
        dataAmount: product.dataAmount,
        dataUnit: product.dataUnit,
        destination: valid.customerPhone,
        customer: { name: valid.customerName ?? null, whatsapp: null },
        channel: null,
        status: 'PENDING',
        paymentId: null,
        transactionId: null,
        taskId: null,
        cancelReason: null,
        createdAt: now,
        updatedAt: now,
        events: [{ id: `${code}-m0`, type: 'created', at: now, toStatus: 'PENDING' }],
      };
      db.orders.unshift(order);
      if (keyId) keys.set(keyId, order.id);
      return order;
    });
  },

  markAwaitingPayment: (id) => request((tenantId) => transition(find(tenantId, id), 'AWAITING_PAYMENT')),

  async cancel(id, input = {}) {
    const reason = normalizeCancelReason(input.reason);
    return request((tenantId) => transition(find(tenantId, id), 'CANCELLED', reason));
  },

  retryActivation: (id, input = {}) =>
    request((tenantId) => {
      const order = find(tenantId, id);
      if (input.destination) {
        order.destination = input.destination.replace(/\D/g, '');
        stamp(order, 'destination_provided', 'Número corrigido pelo vendedor');
      }
      order.taskId = null;
      runActivationPipeline(order.id);
      return order;
    }),

  verifyActivation: (id) =>
    request((tenantId) => {
      const order = find(tenantId, id);
      runActivationPipeline(order.id, { verifyOnly: true });
      return order;
    }),

  resendConfirmation: (id) =>
    request((tenantId) => {
      find(tenantId, id);
    }),
};
