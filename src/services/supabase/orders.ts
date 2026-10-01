/**
 * Orders on Supabase (migration 004): rows ↔ domain and database errors →
 * AppErrors. Authorization, snapshots, idempotency and the state machine live
 * in the database; this layer only maps and pre-validates.
 */
import type { DataUnit, ID, Order, OrderCounts, OrderEvent, OrderEventType, OrderFilter, OrderStatus } from '@/types';

import { serviceContext } from '../context';
import { AppError, type AppErrorCode, type AppErrorReason } from '../errors';
import {
  assertValidCreateOrderInput,
  featureNotAvailable,
  isOrderStatus,
  normalizeCancelReason,
  ORDER_FILTER_STATUSES,
} from '../orderRules';
import type { OrdersService } from '../types';
import { postgrestReason, toAppError } from './errors';
import type { OrderEventRow, OrderRow, OrdersGateway } from './ordersGateway';

const LIST_LIMIT = 200;

/** Unknown statuses (newer backend) surface as needing attention; the database still guards transitions. */
const toStatus = (value: string): OrderStatus => (isOrderStatus(value) ? value : 'FAILED');

const toDataUnit = (value: string | null): DataUnit | null => (value === 'MB' || value === 'GB' ? value : null);

const EVENT_TYPES: Record<string, OrderEventType> = {
  'order.created': 'created',
  'order.status_changed': 'status_changed',
  'order.cancelled': 'cancelled',
  'order.expired': 'expired',
};

export function toOrderEvent(row: OrderEventRow): OrderEvent {
  const metadata = row.metadata;
  const reason =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && typeof metadata.reason === 'string'
      ? metadata.reason
      : undefined;
  return {
    id: row.id,
    type: EVENT_TYPES[row.event_type] ?? 'status_changed',
    at: row.created_at,
    description: reason,
    fromStatus: row.from_status && isOrderStatus(row.from_status) ? row.from_status : null,
    toStatus: toStatus(row.to_status),
    actorUserId: row.actor_user_id,
  };
}

export function toOrder(row: OrderRow, events: OrderEventRow[] = []): Order {
  const dataUnit = toDataUnit(row.data_unit_snapshot);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.public_reference,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    price: Number(row.product_price_snapshot),
    currency: row.currency_snapshot,
    dataAmount: row.data_amount_snapshot === null || dataUnit === null ? null : Number(row.data_amount_snapshot),
    dataUnit: row.data_amount_snapshot === null ? null : dataUnit,
    destination: row.customer_phone,
    customer: { name: row.customer_name, whatsapp: null },
    channel: null,
    status: toStatus(row.status),
    paymentId: null,
    transactionId: null,
    taskId: null,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.map(toOrderEvent),
  };
}

const REASONS: Record<string, { code: AppErrorCode; reason?: AppErrorReason }> = {
  TENANT_SUSPENDED: { code: 'PERMISSION_DENIED', reason: 'TENANT_SUSPENDED' },
  PRODUCT_NOT_FOUND: { code: 'NOT_FOUND' },
  ORDER_NOT_FOUND: { code: 'NOT_FOUND' },
  PRODUCT_NOT_AVAILABLE: { code: 'CONFLICT', reason: 'PRODUCT_NOT_AVAILABLE' },
  INVALID_PHONE: { code: 'VALIDATION_ERROR', reason: 'INVALID_PHONE' },
  INVALID_CUSTOMER_NAME: { code: 'VALIDATION_ERROR' },
  INVALID_REASON: { code: 'VALIDATION_ERROR' },
  INVALID_IDEMPOTENCY_KEY: { code: 'VALIDATION_ERROR' },
  INVALID_TRANSITION: { code: 'CONFLICT', reason: 'INVALID_TRANSITION' },
  IDEMPOTENCY_KEY_REUSED: { code: 'CONFLICT', reason: 'IDEMPOTENCY_KEY_REUSED' },
  IMMUTABLE_ORDER: { code: 'CONFLICT' },
};

/** Our SQL functions tag errors with a hint + pt message; everything else goes through toAppError. */
function toOrderError(error: unknown): AppError {
  const tagged = postgrestReason(error);
  const known = tagged ? REASONS[tagged.hint] : undefined;
  if (tagged && known) {
    const message = tagged.hint === 'INVALID_TRANSITION' ? 'Esta ação não é possível no estado atual do pedido.' : tagged.message;
    return new AppError(known.code, message, { reason: known.reason, detail: `${tagged.hint} | ${tagged.message}` });
  }
  return toAppError(error);
}

export function createSupabaseOrdersService(
  gateway: OrdersGateway,
  getTenantId: () => ID | null = () => serviceContext.getTenant()
): OrdersService {
  const tenantId = () => {
    const id = getTenantId();
    if (!id) throw new AppError('AUTH_ERROR', 'Sessão expirada. Entre novamente.', { reason: 'SESSION_EXPIRED' });
    return id;
  };

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toOrderError(error);
    }
  }

  /** Commands return the order row; the history is loaded with it. */
  async function withEvents(rows: OrderRow[]): Promise<Order> {
    const [row] = rows;
    if (!row) throw new AppError('NOT_FOUND', 'Pedido não encontrado.');
    return toOrder(row, await gateway.listEvents(row.tenant_id, row.id));
  }

  return {
    async list(params = {}) {
      const tenant = tenantId();
      const filter: OrderFilter = params.filter ?? 'all';
      return run(async () =>
        (
          await gateway.list(tenant, {
            statuses: filter === 'all' ? null : ORDER_FILTER_STATUSES[filter],
            search: params.search?.trim() || null,
            limit: LIST_LIMIT,
          })
        ).map((row) => toOrder(row))
      );
    },

    async counts() {
      const tenant = tenantId();
      return run(async () => {
        const totals = new Map((await gateway.counts(tenant)).map((row) => [row.status, row.total]));
        const sum = (statuses: OrderStatus[]) => statuses.reduce((total, status) => total + (totals.get(status) ?? 0), 0);
        const counts: OrderCounts = {
          all: [...totals.values()].reduce((total, value) => total + value, 0),
          pending: sum(ORDER_FILTER_STATUSES.pending),
          paid: sum(ORDER_FILTER_STATUSES.paid),
          processing: sum(ORDER_FILTER_STATUSES.processing),
          completed: sum(ORDER_FILTER_STATUSES.completed),
          failed: sum(ORDER_FILTER_STATUSES.failed),
        };
        return counts;
      });
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => {
        const [row, events] = await Promise.all([gateway.get(tenant, id), gateway.listEvents(tenant, id)]);
        if (!row) throw new AppError('NOT_FOUND', 'Pedido não encontrado.');
        return toOrder(row, events);
      });
    },

    async create(input) {
      const valid = assertValidCreateOrderInput(input);
      tenantId();
      return run(async () =>
        withEvents(
          await gateway.create({
            productId: valid.productId,
            customerPhone: valid.customerPhone,
            customerName: valid.customerName ?? null,
            idempotencyKey: valid.idempotencyKey ?? null,
          })
        )
      );
    },

    async markAwaitingPayment(id) {
      tenantId();
      return run(async () => withEvents(await gateway.markAwaitingPayment(id)));
    },

    async cancel(id, input = {}) {
      const reason = normalizeCancelReason(input.reason);
      tenantId();
      return run(async () => withEvents(await gateway.cancel(id, reason)));
    },

    // Owned by the activation / WhatsApp phases — not on the backend yet.
    retryActivation: async () => Promise.reject(featureNotAvailable('Repetir a ativação')),
    verifyActivation: async () => Promise.reject(featureNotAvailable('A verificação com a operadora')),
    resendConfirmation: async () => Promise.reject(featureNotAvailable('Reenviar a confirmação')),
  };
}
