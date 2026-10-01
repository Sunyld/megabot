import type { Order, OrderCounts, OrderFilter, OrderStatus } from '@/types';

import type { OrdersService } from '../types';
import { db, notFound, ownedBy, request } from './db';
import { runActivationPipeline } from './pipeline';

export const orderFilterStatuses: Record<Exclude<OrderFilter, 'all'>, OrderStatus[]> = {
  pending: ['awaiting_destination', 'awaiting_payment', 'payment_review'],
  paid: ['paid'],
  processing: ['processing', 'verifying'],
  completed: ['completed'],
  failed: ['failed'],
};

const matchesFilter = (order: Order, filter: OrderFilter = 'all') =>
  filter === 'all' || orderFilterStatuses[filter].includes(order.status);

const matchesSearch = (order: Order, search?: string) => {
  const q = search?.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return [order.code, order.destination, order.transactionId, order.customer.name, order.productName]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().replace(/\s+/g, '').includes(q));
};

const find = (tenantId: string, id: string) =>
  db.orders.filter(ownedBy(tenantId)).find((o) => o.id === id) ?? notFound('Pedido');

const stamp = (order: Order, type: Order['events'][number]['type'], description?: string) => {
  const at = new Date().toISOString();
  order.events.push({ id: `${order.code}-m${order.events.length}`, type, at, description });
  order.updatedAt = at;
};

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
      (Object.keys(orderFilterStatuses) as Exclude<OrderFilter, 'all'>[]).forEach((filter) => {
        counts[filter] = orders.filter((o) => matchesFilter(o, filter)).length;
      });
      return counts;
    }, { empty: () => ({ all: 0, pending: 0, paid: 0, processing: 0, completed: 0, failed: 0 }) }),

  get: (id) => request((tenantId) => find(tenantId, id)),

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

  cancel: (id) =>
    request((tenantId) => {
      const order = find(tenantId, id);
      order.status = 'cancelled';
      stamp(order, 'cancelled', 'Cancelado pelo vendedor');
      return order;
    }),

  resendConfirmation: (id) =>
    request((tenantId) => {
      find(tenantId, id);
    }),
};
