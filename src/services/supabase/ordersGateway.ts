/**
 * Thin adapter between the orders service and supabase-js. Reads go to the
 * tables (RLS: members of the tenant); every write is an RPC command
 * (migration 004) — the API has no INSERT/UPDATE grant on orders.
 */
import type { Database, MegabotSupabaseClient } from '@/lib/supabase';
import type { OrderStatus } from '@/types';

type Tables = Database['public']['Tables'];

export type OrderRow = Tables['orders']['Row'];
export type OrderEventRow = Tables['order_events']['Row'];
export type OrderStatusCountRow = Database['public']['Functions']['order_status_counts']['Returns'][number];

export type OrderListQuery = { statuses: OrderStatus[] | null; search: string | null; limit: number };

export type CreateOrderArgs = {
  productId: string;
  customerPhone: string;
  customerName: string | null;
  idempotencyKey: string | null;
};

export interface OrdersGateway {
  list(tenantId: string, query: OrderListQuery): Promise<OrderRow[]>;
  get(tenantId: string, id: string): Promise<OrderRow | null>;
  listEvents(tenantId: string, orderId: string): Promise<OrderEventRow[]>;
  counts(tenantId: string): Promise<OrderStatusCountRow[]>;
  create(args: CreateOrderArgs): Promise<OrderRow[]>;
  markAwaitingPayment(id: string): Promise<OrderRow[]>;
  cancel(id: string, reason: string | null): Promise<OrderRow[]>;
}

const ORDER_COLUMNS =
  'id, tenant_id, product_id, public_reference, customer_name, customer_phone, product_name_snapshot, product_price_snapshot, currency_snapshot, data_amount_snapshot, data_unit_snapshot, validity_hours_snapshot, operator_snapshot, status, status_changed_at, cancel_reason, idempotency_key, created_at, updated_at';

const EVENT_COLUMNS = 'id, tenant_id, order_id, event_type, actor_user_id, from_status, to_status, metadata, created_at';

/**
 * Search term safe to embed in a PostgREST `or` filter: letters, digits, "+",
 * "-" and spaces only. Phone-like input drops spaces ("84 000 0001" matches
 * the stored "+258840000001").
 */
export function toSearchTerm(search: string): string {
  const cleaned = search.replace(/[^\p{L}\p{N}+\- ]/gu, '').trim().slice(0, 60);
  return /^[\d\s+]+$/.test(cleaned) ? cleaned.replace(/\s+/g, '') : cleaned;
}

export function createOrdersGateway(getClient: () => MegabotSupabaseClient): OrdersGateway {
  return {
    async list(tenantId, { statuses, search, limit }) {
      let request = getClient()
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (statuses) request = request.in('status', statuses);
      const term = search ? toSearchTerm(search) : '';
      if (term) {
        request = request.or(`public_reference.ilike.*${term}*,customer_phone.ilike.*${term}*,customer_name.ilike.*${term}*`);
      }
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async get(tenantId, id) {
      const { data, error } = await getClient()
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async listEvents(tenantId, orderId) {
      const { data, error } = await getClient()
        .from('order_events')
        .select(EVENT_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },

    async counts(tenantId) {
      const { data, error } = await getClient().rpc('order_status_counts', { p_tenant_id: tenantId });
      if (error) throw error;
      return data ?? [];
    },

    async create({ productId, customerPhone, customerName, idempotencyKey }) {
      const { data, error } = await getClient().rpc('create_order', {
        p_product_id: productId,
        p_customer_phone: customerPhone,
        ...(customerName ? { p_customer_name: customerName } : {}),
        ...(idempotencyKey ? { p_idempotency_key: idempotencyKey } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },

    async markAwaitingPayment(id) {
      const { data, error } = await getClient().rpc('mark_order_awaiting_payment', { p_order_id: id });
      if (error) throw error;
      return data ?? [];
    },

    async cancel(id, reason) {
      const { data, error } = await getClient().rpc('cancel_order', {
        p_order_id: id,
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },
  };
}
