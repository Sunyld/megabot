import type { ID, ISODateString, TenantScoped } from './common';

export type OrderStatus =
  | 'awaiting_destination'
  | 'awaiting_payment'
  | 'payment_review'
  | 'paid'
  | 'processing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** UI filter buckets for the orders list. */
export type OrderFilter = 'all' | 'pending' | 'paid' | 'processing' | 'completed' | 'failed';

export type OrderEventType =
  | 'created'
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
  | 'cancelled';

/** Append-only audit log entry for an order (backend-owned). */
export type OrderEvent = {
  id: ID;
  type: OrderEventType;
  at: ISODateString;
  description?: string;
};

export type OrderChannel = {
  type: 'group' | 'direct';
  name: string;
};

export type Order = TenantScoped & {
  id: ID;
  /** Human-facing reference shown to sellers and customers, e.g. ORD-92831. */
  code: string;
  productId: ID;
  productName: string;
  price: number;
  /** Number that must receive the package. `null` until the customer provides it. */
  destination: string | null;
  customer: {
    name: string;
    whatsapp: string;
  };
  channel: OrderChannel;
  status: OrderStatus;
  paymentId: ID | null;
  /** Wallet transaction ID — the primary reconciliation reference. */
  transactionId: string | null;
  taskId: ID | null;
  failureReason?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  events: OrderEvent[];
};

export type OrderCounts = Record<OrderFilter, number>;
