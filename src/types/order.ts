import type { ID, ISODateString, TenantScoped } from './common';
import type { DataUnit } from './product';

/**
 * Mirrors orders.status (migration 004). The backend enforces the transitions:
 *   PENDING → AWAITING_PAYMENT → (VERIFYING →) PAID → READY_FOR_ACTIVATION → ACTIVATING → COMPLETED
 *   with FAILED (retry → READY_FOR_ACTIVATION), CANCELLED and EXPIRED as exits.
 * VERIFYING = payment proof received, still being verified.
 */
export type OrderStatus =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'VERIFYING'
  | 'PAID'
  | 'READY_FOR_ACTIVATION'
  | 'ACTIVATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

/** UI filter buckets for the orders list. */
export type OrderFilter = 'all' | 'pending' | 'paid' | 'processing' | 'completed' | 'failed';

export type OrderEventType =
  | 'created'
  | 'status_changed'
  | 'destination_provided'
  | 'payment_proof_received'
  | 'payment_confirmed'
  | 'payment_review'
  | 'task_created'
  | 'device_selected'
  | 'failover'
  | 'ussd_executed'
  | 'verification_started'
  | 'activated'
  | 'customer_notified'
  | 'failed'
  | 'cancelled'
  | 'expired';

/** Append-only history entry of an order (backend-owned: order_events). */
export type OrderEvent = {
  id: ID;
  type: OrderEventType;
  at: ISODateString;
  description?: string;
  /** Status transition recorded with the event, when there was one. */
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus;
  /** `null` for system actions. */
  actorUserId?: ID | null;
};

export type OrderChannel = {
  type: 'group' | 'direct';
  name: string;
};

export type Order = TenantScoped & {
  id: ID;
  /** Public reference shown to sellers and customers, e.g. MB-20261001-3F9A2C1B. */
  code: string;
  productId: ID;
  /** Product snapshot taken when the order was created — later product changes don't affect it. */
  productName: string;
  price: number;
  currency: string;
  dataAmount: number | null;
  dataUnit: DataUnit | null;
  /** Number that receives the package (orders.customer_phone, E.164). `null` only while a customer hasn't given it. */
  destination: string | null;
  customer: {
    name: string | null;
    whatsapp: string | null;
  };
  /** WhatsApp group / chat the order came from; `null` for orders created in the app. */
  channel: OrderChannel | null;
  status: OrderStatus;
  /** Payment / activation links — filled by later phases (payments, activation tasks). */
  paymentId: ID | null;
  /** Wallet transaction ID — the primary reconciliation reference. */
  transactionId: string | null;
  taskId: ID | null;
  failureReason?: string;
  cancelReason?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  events: OrderEvent[];
};

export type OrderCounts = Record<OrderFilter, number>;

/** A seller registering an order in the app. Prices and product data come from the backend (snapshot). */
export type CreateOrderInput = {
  productId: ID;
  /** Any common format: "84 123 4567", "+258841234567"… normalized to E.164. */
  customerPhone: string;
  customerName?: string | null;
  /** Same key = same order, even if the request is sent twice. */
  idempotencyKey?: string;
};
