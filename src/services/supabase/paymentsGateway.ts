/**
 * Thin adapter between the payment services and supabase-js. Reads go to the
 * tables (RLS: members of the tenant); every write is an RPC command
 * (migration 005) — the API has no INSERT/UPDATE grant on the financial tables.
 */
import type { Database, Json, MegabotSupabaseClient } from '@/lib/supabase';

type Tables = Database['public']['Tables'];

export type PaymentAccountRow = Tables['payment_accounts']['Row'];
export type PaymentEventRow = Tables['payment_events']['Row'];
export type PaymentProofRow = Tables['payment_proofs']['Row'];
export type PaymentMatchRow = Tables['payment_matches']['Row'];
/** Just what the payments screens show about the order. */
export type OrderRefRow = Pick<Tables['orders']['Row'], 'id' | 'public_reference' | 'product_price_snapshot' | 'currency_snapshot'>;

export type EventListQuery = { paymentAccountId: string | null; ids: string[] | null; limit: number };
export type ProofListQuery = { orderId: string | null; status: string | null; ids: string[] | null; limit: number };
export type MatchListQuery = { orderId: string | null; paymentEventId: string | null; paymentProofId: string | null; limit: number };

export type CreateAccountArgs = { tenantId: string; provider: string; accountName: string; accountIdentifier: string };
export type UpdateAccountArgs = { id: string; accountName: string | null; status: string | null };

export type RecordEventArgs = {
  paymentAccountId: string;
  transactionId: string;
  amount: number;
  occurredAt: string | null;
  currency: string | null;
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  rawMessage: string | null;
};

export type SubmitProofArgs = {
  tenantId: string;
  orderId: string | null;
  provider: string | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  rawMessage: string | null;
  extractedData: Json | null;
};

export type ConfirmArgs = { orderId: string; paymentEventId: string; paymentProofId: string | null; note: string | null };

export interface PaymentsGateway {
  listAccounts(tenantId: string): Promise<PaymentAccountRow[]>;
  createAccount(args: CreateAccountArgs): Promise<PaymentAccountRow[]>;
  updateAccount(args: UpdateAccountArgs): Promise<PaymentAccountRow[]>;
  listEvents(tenantId: string, query: EventListQuery): Promise<PaymentEventRow[]>;
  recordEvent(args: RecordEventArgs): Promise<PaymentEventRow[]>;
  listProofs(tenantId: string, query: ProofListQuery): Promise<PaymentProofRow[]>;
  submitProof(args: SubmitProofArgs): Promise<PaymentProofRow[]>;
  reconcileProof(id: string): Promise<PaymentProofRow[]>;
  rejectProof(id: string, reason: string): Promise<PaymentProofRow[]>;
  listMatches(tenantId: string, query: MatchListQuery): Promise<PaymentMatchRow[]>;
  confirmManually(args: ConfirmArgs): Promise<PaymentMatchRow[]>;
  listOrderRefs(tenantId: string, ids: string[]): Promise<OrderRefRow[]>;
}

const ACCOUNT_COLUMNS = 'id, tenant_id, provider, account_name, account_identifier, status, metadata, created_at, updated_at';
const EVENT_COLUMNS =
  'id, tenant_id, payment_account_id, provider, transaction_id, amount, currency, sender_identifier, recipient_identifier, occurred_at, received_at, raw_message, source, recorded_by, metadata, created_at';
const PROOF_COLUMNS =
  'id, tenant_id, order_id, provider, transaction_id, amount, currency, sender_identifier, recipient_identifier, raw_message, source, extracted_data, status, status_reason, review_note, submitted_by, created_at, updated_at';
const MATCH_COLUMNS =
  'id, tenant_id, order_id, payment_proof_id, payment_event_id, match_status, match_methods, reason, details, matched_at, matched_by, metadata, created_at';

/** Optional RPC arguments are omitted (not sent as null) so the SQL defaults apply. */
const optional = <K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> =>
  value === null ? {} : ({ [key]: value } as Record<K, V>);

export function createPaymentsGateway(getClient: () => MegabotSupabaseClient): PaymentsGateway {
  return {
    async listAccounts(tenantId) {
      const { data, error } = await getClient()
        .from('payment_accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },

    async createAccount({ tenantId, provider, accountName, accountIdentifier }) {
      const { data, error } = await getClient().rpc('create_payment_account', {
        p_tenant_id: tenantId,
        p_provider: provider,
        p_account_name: accountName,
        p_account_identifier: accountIdentifier,
      });
      if (error) throw error;
      return data ?? [];
    },

    async updateAccount({ id, accountName, status }) {
      const { data, error } = await getClient().rpc('update_payment_account', {
        p_account_id: id,
        ...optional('p_account_name', accountName),
        ...optional('p_status', status),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listEvents(tenantId, { paymentAccountId, ids, limit }) {
      let request = getClient()
        .from('payment_events')
        .select(EVENT_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (paymentAccountId) request = request.eq('payment_account_id', paymentAccountId);
      if (ids) request = request.in('id', ids);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async recordEvent(args) {
      const { data, error } = await getClient().rpc('record_payment_event', {
        p_payment_account_id: args.paymentAccountId,
        p_transaction_id: args.transactionId,
        p_amount: args.amount,
        ...optional('p_occurred_at', args.occurredAt),
        ...optional('p_currency', args.currency),
        ...optional('p_sender_identifier', args.senderIdentifier),
        ...optional('p_recipient_identifier', args.recipientIdentifier),
        ...optional('p_raw_message', args.rawMessage),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listProofs(tenantId, { orderId, status, ids, limit }) {
      let request = getClient()
        .from('payment_proofs')
        .select(PROOF_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (orderId) request = request.eq('order_id', orderId);
      if (status) request = request.eq('status', status);
      if (ids) request = request.in('id', ids);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async submitProof(args) {
      const { data, error } = await getClient().rpc('submit_payment_proof', {
        // Without an order the proof belongs to the caller's tenant (checked by the database).
        ...(args.orderId ? { p_order_id: args.orderId } : { p_tenant_id: args.tenantId }),
        ...optional('p_provider', args.provider),
        ...optional('p_transaction_id', args.transactionId),
        ...optional('p_amount', args.amount),
        ...optional('p_currency', args.currency),
        ...optional('p_sender_identifier', args.senderIdentifier),
        ...optional('p_recipient_identifier', args.recipientIdentifier),
        ...optional('p_raw_message', args.rawMessage),
        ...optional('p_extracted_data', args.extractedData),
      });
      if (error) throw error;
      return data ?? [];
    },

    async reconcileProof(id) {
      const { data, error } = await getClient().rpc('reconcile_payment_proof', { p_proof_id: id });
      if (error) throw error;
      return data ?? [];
    },

    async rejectProof(id, reason) {
      const { data, error } = await getClient().rpc('reject_payment_proof', { p_proof_id: id, p_reason: reason });
      if (error) throw error;
      return data ?? [];
    },

    async listMatches(tenantId, { orderId, paymentEventId, paymentProofId, limit }) {
      let request = getClient()
        .from('payment_matches')
        .select(MATCH_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (orderId) request = request.eq('order_id', orderId);
      if (paymentEventId) request = request.eq('payment_event_id', paymentEventId);
      if (paymentProofId) request = request.eq('payment_proof_id', paymentProofId);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },

    async confirmManually({ orderId, paymentEventId, paymentProofId, note }) {
      const { data, error } = await getClient().rpc('confirm_payment_manually', {
        p_order_id: orderId,
        p_payment_event_id: paymentEventId,
        ...optional('p_payment_proof_id', paymentProofId),
        ...optional('p_note', note),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listOrderRefs(tenantId, ids) {
      if (!ids.length) return [];
      const { data, error } = await getClient()
        .from('orders')
        .select('id, public_reference, product_price_snapshot, currency_snapshot')
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (error) throw error;
      return data;
    },
  };
}
