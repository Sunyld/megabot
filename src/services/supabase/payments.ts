/**
 * Financial core on Supabase (migration 005): rows ↔ domain, database errors →
 * AppErrors, and the Payments screens' read model ("payment cases").
 * Authorization, idempotency, immutability and the reconciliation decision
 * itself live in the database; this layer only maps and pre-validates.
 */
import type {
  ID,
  MatchCheckKey,
  MatchCheckResult,
  MatchMethod,
  Payment,
  PaymentAccount,
  PaymentAccountRecord,
  PaymentEventRecord,
  PaymentEventSource,
  PaymentMatchRecord,
  PaymentMethod,
  PaymentProofRecord,
  PaymentProvider,
  PaymentStatus,
  ReconciliationCheck,
  ReconciliationCheckKey,
} from '@/types';
import { isSameDay } from '@/utils/format';

import { serviceContext } from '../context';
import { AppError, type AppErrorCode, type AppErrorReason } from '../errors';
import {
  assertValidAccountInput,
  assertValidAccountUpdate,
  assertValidEventInput,
  assertValidProofInput,
  isPaymentProvider,
  isReconciliationStatus,
  normalizeReviewNote,
  RECONCILIATION_REASON_TEXT,
  reconciliationReasonText,
} from '../paymentRules';
import type {
  PaymentAccountsService,
  PaymentEventsService,
  PaymentMatchesService,
  PaymentProofsService,
  PaymentsService,
} from '../types';
import { postgrestReason, toAppError } from './errors';
import type {
  OrderRefRow,
  PaymentAccountRow,
  PaymentEventRow,
  PaymentMatchRow,
  PaymentProofRow,
  PaymentsGateway,
} from './paymentsGateway';

const LIST_LIMIT = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value);

// ─── Rows → domain ──────────────────────────────────────────────────────────────

const EVENT_SOURCES: readonly PaymentEventSource[] = ['MANUAL', 'SMS', 'PROVIDER_API'];
const MATCH_METHODS: readonly MatchMethod[] = ['TRANSACTION_ID', 'AMOUNT', 'ACCOUNT', 'SENDER', 'TIME_WINDOW', 'ORDER_CONTEXT', 'MANUAL'];
const CHECK_KEYS: readonly MatchCheckKey[] = [
  'order',
  'provider',
  'transaction_id',
  'account',
  'currency',
  'amount',
  'proof_amount',
  'sender',
  'time_window',
  'duplicate',
];
const CHECK_RESULTS: readonly MatchCheckResult[] = ['PASS', 'FAIL', 'SKIPPED'];

/** Rows of a provider this app version does not know are left out (never shown under a wrong provider). */
export function toPaymentAccount(row: PaymentAccountRow): PaymentAccountRecord | null {
  if (!isPaymentProvider(row.provider)) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    accountName: row.account_name,
    accountIdentifier: row.account_identifier,
    status: row.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPaymentEvent(row: PaymentEventRow): PaymentEventRecord | null {
  if (!isPaymentProvider(row.provider)) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    paymentAccountId: row.payment_account_id,
    provider: row.provider,
    transactionId: row.transaction_id,
    amount: Number(row.amount),
    currency: row.currency,
    senderIdentifier: row.sender_identifier,
    recipientIdentifier: row.recipient_identifier,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    rawMessage: row.raw_message,
    source: (EVENT_SOURCES as readonly string[]).includes(row.source) ? (row.source as PaymentEventSource) : 'MANUAL',
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  };
}

export function toPaymentProof(row: PaymentProofRow): PaymentProofRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    provider: isPaymentProvider(row.provider) ? row.provider : null,
    transactionId: row.transaction_id,
    amount: toNumberOrNull(row.amount),
    currency: row.currency,
    senderIdentifier: row.sender_identifier,
    recipientIdentifier: row.recipient_identifier,
    rawMessage: row.raw_message,
    source: row.source === 'WHATSAPP' ? 'WHATSAPP' : 'MANUAL',
    extractedData: isRecord(row.extracted_data) ? row.extracted_data : {},
    // Unknown (newer) statuses surface as needing a person, never as confirmed.
    status: isReconciliationStatus(row.status) ? row.status : 'PENDING_REVIEW',
    statusReason: row.status_reason,
    reviewNote: row.review_note,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPaymentMatch(row: PaymentMatchRow): PaymentMatchRecord {
  const details = isRecord(row.details) ? row.details : {};
  const checks: PaymentMatchRecord['checks'] = {};
  if (isRecord(details.checks)) {
    for (const [key, value] of Object.entries(details.checks)) {
      if ((CHECK_KEYS as readonly string[]).includes(key) && (CHECK_RESULTS as readonly unknown[]).includes(value)) {
        checks[key as MatchCheckKey] = value as MatchCheckResult;
      }
    }
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    paymentProofId: row.payment_proof_id,
    paymentEventId: row.payment_event_id,
    status: isReconciliationStatus(row.match_status) ? row.match_status : 'PENDING_REVIEW',
    methods: (row.match_methods ?? []).filter((m): m is MatchMethod => (MATCH_METHODS as readonly string[]).includes(m)),
    reason: row.reason,
    checks,
    failures: Array.isArray(details.failures) ? details.failures.filter((f): f is string => typeof f === 'string') : [],
    orderAmount: toNumberOrNull(details.order_amount),
    eventAmount: toNumberOrNull(details.event_amount),
    currency: typeof details.currency === 'string' ? details.currency : null,
    matchedAt: row.matched_at,
    matchedBy: row.matched_by,
    createdAt: row.created_at,
  };
}

const known = <T>(values: (T | null)[]): T[] => values.filter((value): value is T => value !== null);

// ─── Errors ─────────────────────────────────────────────────────────────────────

const REASONS: Record<string, { code: AppErrorCode; reason?: AppErrorReason }> = {
  TENANT_SUSPENDED: { code: 'PERMISSION_DENIED', reason: 'TENANT_SUSPENDED' },
  PAYMENT_WRITE_DENIED: { code: 'PERMISSION_DENIED', reason: 'PAYMENT_WRITE_DENIED' },
  PAYMENT_NOT_CONFIRMED: { code: 'PERMISSION_DENIED' },
  ACCOUNT_NOT_FOUND: { code: 'NOT_FOUND' },
  EVENT_NOT_FOUND: { code: 'NOT_FOUND' },
  PROOF_NOT_FOUND: { code: 'NOT_FOUND' },
  ORDER_NOT_FOUND: { code: 'NOT_FOUND' },
  INVALID_PROVIDER: { code: 'VALIDATION_ERROR' },
  INVALID_ACCOUNT_NAME: { code: 'VALIDATION_ERROR' },
  INVALID_ACCOUNT_IDENTIFIER: { code: 'VALIDATION_ERROR' },
  INVALID_STATUS: { code: 'VALIDATION_ERROR' },
  INVALID_TRANSACTION_ID: { code: 'VALIDATION_ERROR' },
  INVALID_AMOUNT: { code: 'VALIDATION_ERROR' },
  INVALID_CURRENCY: { code: 'VALIDATION_ERROR' },
  INVALID_OCCURRED_AT: { code: 'VALIDATION_ERROR' },
  INVALID_EXTRACTED_DATA: { code: 'VALIDATION_ERROR' },
  INVALID_REASON: { code: 'VALIDATION_ERROR' },
  EVIDENCE_REQUIRED: { code: 'VALIDATION_ERROR' },
  ACCOUNT_EXISTS: { code: 'CONFLICT', reason: 'PAYMENT_ACCOUNT_EXISTS' },
  EVENT_CONFLICT: { code: 'CONFLICT', reason: 'PAYMENT_EVENT_CONFLICT' },
  PROOF_FINAL: { code: 'CONFLICT', reason: 'PROOF_ALREADY_DECIDED' },
  IMMUTABLE_ACCOUNT: { code: 'CONFLICT' },
  IMMUTABLE_PROOF: { code: 'CONFLICT' },
};

/** Our SQL functions tag errors with a hint + pt message; everything else goes through toAppError. */
export function toPaymentError(error: unknown): AppError {
  const tagged = postgrestReason(error);
  if (!tagged) return toAppError(error);
  const detail = `${tagged.hint} | ${tagged.message}`;
  const known = REASONS[tagged.hint];
  if (known) return new AppError(known.code, tagged.message, { reason: known.reason, detail });
  // A manual confirmation refused by a deterministic rule (UNDERPAID, EVENT_ALREADY_USED…).
  if (RECONCILIATION_REASON_TEXT[tagged.hint]) {
    return new AppError('CONFLICT', `Não é possível confirmar: ${RECONCILIATION_REASON_TEXT[tagged.hint]}`, {
      reason: 'PAYMENT_NOT_CONFIRMABLE',
      detail,
    });
  }
  return toAppError(error);
}

// ─── Payments screens read model ("payment cases") ──────────────────────────────

/** UI-only reason: money arrived but no open order has this amount. */
const NO_MATCHING_ORDER = 'Nenhum pedido em aberto corresponde a este movimento.';

const methodOf = (provider: PaymentProvider | null): PaymentMethod | null =>
  provider === 'MPESA' ? 'mpesa' : provider === 'EMOLA' ? 'emola' : null;

const money = (amount: number | null, currency: string | null) =>
  amount === null ? undefined : `${amount.toFixed(2)} ${currency ?? ''}`.trim();

const RESULT: Record<MatchCheckResult, ReconciliationCheck['result']> = { PASS: 'match', FAIL: 'mismatch', SKIPPED: 'missing' };

/** The decision that explains a case: the confirmation if any, else the latest one. */
const decisive = (matches: PaymentMatchRecord[]) =>
  matches.find((m) => m.status === 'CONFIRMED') ?? [...matches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

function toChecks(
  match: PaymentMatchRecord | undefined,
  proof: PaymentProofRecord | null,
  event: PaymentEventRecord | null,
  account: PaymentAccountRecord | null
): ReconciliationCheck[] {
  if (!match || !event) return [];
  const c = match.checks;
  const checks: ReconciliationCheck[] = [];
  const add = (key: ReconciliationCheckKey, result: MatchCheckResult | undefined, expected?: string, actual?: string) => {
    // SKIPPED = not enough evidence (e.g. masked sender): shown as nothing rather than a pass.
    if (result && result !== 'SKIPPED') checks.push({ key, result: RESULT[result], expected, actual });
  };
  add('order', c.order);
  add('provider', c.provider, proof?.provider ?? undefined, event.provider);
  add('transaction_id', c.transaction_id, proof?.transactionId ?? undefined, event.transactionId);
  add('account', c.account, proof?.recipientIdentifier ?? account?.accountIdentifier, account?.accountIdentifier);
  const amountResult = [c.amount, c.currency, c.proof_amount].includes('FAIL') ? 'FAIL' : c.amount;
  add('amount', amountResult, money(match.orderAmount, match.currency), money(event.amount, event.currency));
  add('sender', c.sender, proof?.senderIdentifier ?? undefined, event.senderIdentifier ?? undefined);
  add('datetime', c.time_window);
  add('duplicate', c.duplicate ?? (match.status === 'DUPLICATE' ? 'FAIL' : 'PASS'));
  return checks;
}

type CaseParts = {
  id: ID;
  tenantId: ID;
  proof: PaymentProofRecord | null;
  event: PaymentEventRecord | null;
  matches: PaymentMatchRecord[];
  account: PaymentAccountRecord | null;
  orders: Map<ID, OrderRefRow>;
};

export function toPaymentCase({ id, tenantId, proof, event, matches, account, orders }: CaseParts): Payment {
  const match = decisive(matches);
  const confirmed = matches.find((m) => m.status === 'CONFIRMED');
  let status: PaymentStatus;
  if (confirmed || proof?.status === 'CONFIRMED') status = 'confirmed';
  else if (proof && ['REJECTED', 'DUPLICATE', 'EXPIRED'].includes(proof.status)) status = 'rejected';
  else if (proof?.status === 'UNMATCHED') status = 'pending';
  else status = 'review';

  // The order of an event-only case is known only when one order is involved.
  const candidateOrders = [...new Set(matches.map((m) => m.orderId))];
  const orderId = proof?.orderId ?? confirmed?.orderId ?? (candidateOrders.length === 1 ? candidateOrders[0] : null);
  const order = orderId ? orders.get(orderId) : undefined;

  let reviewReason: string | undefined;
  if (status !== 'confirmed') {
    if (proof?.status === 'REJECTED' && proof.reviewNote) reviewReason = proof.reviewNote;
    else if (proof) reviewReason = reconciliationReasonText(proof.statusReason ?? match?.reason);
    else reviewReason = match ? reconciliationReasonText(match.reason) : NO_MATCHING_ORDER;
  }

  const provider = event?.provider ?? proof?.provider ?? null;
  const receivedAt = proof?.createdAt ?? event?.receivedAt ?? new Date(0).toISOString();
  return {
    id,
    tenantId,
    transactionId: proof?.transactionId ?? event?.transactionId ?? null,
    amount: event?.amount ?? proof?.amount ?? (order ? Number(order.product_price_snapshot) : 0),
    method: methodOf(provider),
    status,
    payerName: null,
    payerNumber: event?.senderIdentifier ?? proof?.senderIdentifier ?? null,
    account: account?.accountIdentifier ?? proof?.recipientIdentifier ?? '',
    paidAt: event?.occurredAt ?? receivedAt,
    receivedAt,
    orderId: orderId ?? null,
    orderCode: order?.public_reference ?? null,
    proof: proof
      ? {
          rawText: proof.rawMessage,
          receivedAt: proof.createdAt,
          // Proofs typed in the app are declarations, not AI readings.
          extractedBy: proof.source === 'WHATSAPP' ? 'ai' : 'manual',
          confidence:
            proof.source === 'WHATSAPP' && typeof proof.extractedData.confidence === 'number' ? proof.extractedData.confidence : null,
          fields: {
            transactionId: proof.transactionId,
            amount: proof.amount,
            account: proof.recipientIdentifier,
            datetime: null,
            destination: null,
          },
        }
      : null,
    walletEvent: event
      ? {
          rawText: event.rawMessage,
          receivedAt: event.receivedAt,
          source: event.source === 'SMS' ? 'sms' : event.source === 'PROVIDER_API' ? 'provider_api' : 'manual',
          deviceId: null,
          deviceName: null,
          simSlot: null,
        }
      : null,
    checks: toChecks(confirmed ?? match, proof, event, account),
    reviewReason,
    confirmedBy: confirmed ? (confirmed.methods.includes('MANUAL') ? 'manual' : 'rules') : undefined,
  };
}

// ─── Services ───────────────────────────────────────────────────────────────────

export type SupabasePaymentServices = {
  payments: PaymentsService;
  paymentAccounts: PaymentAccountsService;
  paymentEvents: PaymentEventsService;
  paymentProofs: PaymentProofsService;
  paymentMatches: PaymentMatchesService;
};

export function createSupabasePaymentServices(
  gateway: PaymentsGateway,
  getTenantId: () => ID | null = () => serviceContext.getTenant()
): SupabasePaymentServices {
  const tenantId = () => {
    const id = getTenantId();
    if (!id) throw new AppError('AUTH_ERROR', 'Sessão expirada. Entre novamente.', { reason: 'SESSION_EXPIRED' });
    return id;
  };

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toPaymentError(error);
    }
  }

  const first = <T>(rows: T[], entity: string): T => {
    const [row] = rows;
    if (!row) throw new AppError('NOT_FOUND', `${entity} não encontrado.`);
    return row;
  };

  const accountOf = (row: PaymentAccountRow) => {
    const account = toPaymentAccount(row);
    if (!account) throw new AppError('NOT_FOUND', 'Conta de pagamento não encontrada.');
    return account;
  };
  const eventOf = (row: PaymentEventRow) => {
    const event = toPaymentEvent(row);
    if (!event) throw new AppError('NOT_FOUND', 'Movimento não encontrado.');
    return event;
  };

  const noFilter = { orderId: null, paymentEventId: null, paymentProofId: null };

  // ── Payment cases ──

  async function orderRefs(tenant: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    return new Map((await gateway.listOrderRefs(tenant, unique)).map((row) => [row.id, row]));
  }

  async function loadCases(tenant: string): Promise<Payment[]> {
    const [proofRows, eventRows, matchRows, accountRows] = await Promise.all([
      gateway.listProofs(tenant, { orderId: null, status: null, ids: null, limit: LIST_LIMIT }),
      gateway.listEvents(tenant, { paymentAccountId: null, ids: null, limit: LIST_LIMIT }),
      gateway.listMatches(tenant, { ...noFilter, limit: LIST_LIMIT * 3 }),
      gateway.listAccounts(tenant),
    ]);
    const proofs = proofRows.map(toPaymentProof);
    const matches = matchRows.map(toPaymentMatch);
    const events = new Map(known(eventRows.map(toPaymentEvent)).map((e) => [e.id, e]));
    // Events decided for a recent proof but older than the event page.
    const missing = [...new Set(matches.map((m) => m.paymentEventId).filter((id): id is string => !!id && !events.has(id)))];
    if (missing.length) {
      known((await gateway.listEvents(tenant, { paymentAccountId: null, ids: missing, limit: missing.length })).map(toPaymentEvent)).forEach(
        (e) => events.set(e.id, e)
      );
    }
    const accounts = new Map(known(accountRows.map(toPaymentAccount)).map((a) => [a.id, a]));
    const orders = await orderRefs(tenant, [...proofs.map((p) => p.orderId), ...matches.map((m) => m.orderId)]);

    const claimed = new Set<string>();
    const cases = proofs.map((proof) => {
      const own = matches.filter((m) => m.paymentProofId === proof.id);
      const eventId = decisive(own.filter((m) => m.paymentEventId))?.paymentEventId;
      const event = eventId ? (events.get(eventId) ?? null) : null;
      if (event) claimed.add(event.id);
      return toPaymentCase({
        id: proof.id,
        tenantId: tenant,
        proof,
        event,
        matches: own,
        account: event ? (accounts.get(event.paymentAccountId) ?? null) : null,
        orders,
      });
    });
    for (const event of events.values()) {
      if (claimed.has(event.id) || matches.some((m) => m.paymentEventId === event.id && m.paymentProofId)) continue;
      cases.push(
        toPaymentCase({
          id: event.id,
          tenantId: tenant,
          proof: null,
          event,
          matches: matches.filter((m) => m.paymentEventId === event.id),
          account: accounts.get(event.paymentAccountId) ?? null,
          orders,
        })
      );
    }
    return cases.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  type LoadedCase = { payment: Payment; proof: PaymentProofRecord | null; event: PaymentEventRecord | null };

  async function loadCase(tenant: string, id: ID): Promise<LoadedCase> {
    const [proofRow] = await gateway.listProofs(tenant, { orderId: null, status: null, ids: [id], limit: 1 });
    const proof = proofRow ? toPaymentProof(proofRow) : null;
    let event: PaymentEventRecord | null = null;
    let matches: PaymentMatchRecord[];
    if (proof) {
      matches = (await gateway.listMatches(tenant, { ...noFilter, paymentProofId: proof.id, limit: LIST_LIMIT })).map(toPaymentMatch);
      const eventId = decisive(matches.filter((m) => m.paymentEventId))?.paymentEventId;
      if (eventId) {
        const [row] = await gateway.listEvents(tenant, { paymentAccountId: null, ids: [eventId], limit: 1 });
        event = row ? toPaymentEvent(row) : null;
      }
    } else {
      const [row] = await gateway.listEvents(tenant, { paymentAccountId: null, ids: [id], limit: 1 });
      event = row ? toPaymentEvent(row) : null;
      if (!event) throw new AppError('NOT_FOUND', 'Pagamento não encontrado.');
      matches = (await gateway.listMatches(tenant, { ...noFilter, paymentEventId: event.id, limit: LIST_LIMIT })).map(toPaymentMatch);
    }
    const [accountRows, orders] = await Promise.all([
      event ? gateway.listAccounts(tenant) : Promise.resolve([]),
      orderRefs(tenant, [proof?.orderId ?? null, ...matches.map((m) => m.orderId)]),
    ]);
    const account = event ? (known(accountRows.map(toPaymentAccount)).find((a) => a.id === event.paymentAccountId) ?? null) : null;
    return { payment: toPaymentCase({ id, tenantId: tenant, proof, event, matches, account, orders }), proof, event };
  }

  const payments: PaymentsService = {
    async list(params = {}) {
      const tenant = tenantId();
      const q = params.search?.trim().toLowerCase().replace(/\s+/g, '');
      return run(async () =>
        (await loadCases(tenant))
          .filter((p) => !params.filter || params.filter === 'all' || p.status === params.filter)
          .filter(
            (p) =>
              !q ||
              [p.transactionId, p.orderCode, p.payerNumber]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().replace(/\s+/g, '').includes(q))
          )
      );
    },

    async summary() {
      const tenant = tenantId();
      return run(async () => {
        const today = (await loadCases(tenant)).filter((p) => isSameDay(p.receivedAt, Date.now()));
        const count = (status: PaymentStatus) => today.filter((p) => p.status === status).length;
        return {
          received: today.length,
          confirmed: count('confirmed'),
          pending: count('pending'),
          review: count('review'),
          rejected: count('rejected'),
          confirmedAmount: today.filter((p) => p.status === 'confirmed').reduce((sum, p) => sum + p.amount, 0),
        };
      });
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => (await loadCase(tenant, id)).payment);
    },

    async approve(id) {
      const tenant = tenantId();
      return run(async () => {
        const { payment, proof, event } = await loadCase(tenant, id);
        if (payment.status !== 'review') {
          throw new AppError('CONFLICT', 'Só pagamentos em revisão podem ser confirmados manualmente.');
        }
        if (!event) {
          throw new AppError(
            'CONFLICT',
            'Ainda não existe um movimento real da carteira para este comprovativo — um comprovativo sozinho não confirma o pagamento.',
            { reason: 'PAYMENT_NOT_CONFIRMABLE' }
          );
        }
        if (!payment.orderId) {
          throw new AppError('CONFLICT', 'Este movimento corresponde a vários pedidos (ou a nenhum). A confirmação manual precisa de um único pedido.', {
            reason: 'PAYMENT_NOT_CONFIRMABLE',
          });
        }
        await gateway.confirmManually({ orderId: payment.orderId, paymentEventId: event.id, paymentProofId: proof?.id ?? null, note: null });
        return (await loadCase(tenant, id)).payment;
      });
    },

    async reject(id, reason) {
      const note = normalizeReviewNote(reason, { required: true }) as string;
      const tenant = tenantId();
      return run(async () => {
        const { proof } = await loadCase(tenant, id);
        if (!proof) {
          throw new AppError('CONFLICT', 'Um movimento real da carteira não pode ser rejeitado: fica no histórico financeiro.');
        }
        await gateway.rejectProof(proof.id, note);
        return (await loadCase(tenant, id)).payment;
      });
    },

    async listAccounts() {
      const tenant = tenantId();
      return run(async () =>
        known((await gateway.listAccounts(tenant)).map(toPaymentAccount))
          .filter((a) => a.status === 'ACTIVE')
          .map(
            (a): PaymentAccount => ({
              method: methodOf(a.provider) as PaymentMethod,
              account: a.accountIdentifier,
              holderName: a.accountName,
              monitoredBy: null,
            })
          )
      );
    },
  };

  // ── Financial core ──

  const paymentAccounts: PaymentAccountsService = {
    async list() {
      const tenant = tenantId();
      return run(async () => known((await gateway.listAccounts(tenant)).map(toPaymentAccount)));
    },

    async create(input) {
      const valid = assertValidAccountInput(input);
      const tenant = tenantId();
      return run(async () => accountOf(first(await gateway.createAccount({ tenantId: tenant, ...valid }), 'Conta de pagamento')));
    },

    async update(id, input) {
      const valid = assertValidAccountUpdate(input);
      tenantId();
      return run(async () =>
        accountOf(
          first(
            await gateway.updateAccount({ id, accountName: valid.accountName ?? null, status: valid.status ?? null }),
            'Conta de pagamento'
          )
        )
      );
    },
  };

  const paymentEvents: PaymentEventsService = {
    async list(params = {}) {
      const tenant = tenantId();
      return run(async () =>
        known(
          (await gateway.listEvents(tenant, { paymentAccountId: params.paymentAccountId ?? null, ids: null, limit: LIST_LIMIT })).map(
            toPaymentEvent
          )
        )
      );
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => eventOf(first(await gateway.listEvents(tenant, { paymentAccountId: null, ids: [id], limit: 1 }), 'Movimento')));
    },

    async record(input) {
      const valid = assertValidEventInput(input);
      tenantId();
      return run(async () => eventOf(first(await gateway.recordEvent(valid), 'Movimento')));
    },
  };

  const paymentProofs: PaymentProofsService = {
    async list(params = {}) {
      const tenant = tenantId();
      return run(async () =>
        (
          await gateway.listProofs(tenant, { orderId: params.orderId ?? null, status: params.status ?? null, ids: null, limit: LIST_LIMIT })
        ).map(toPaymentProof)
      );
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () =>
        toPaymentProof(first(await gateway.listProofs(tenant, { orderId: null, status: null, ids: [id], limit: 1 }), 'Comprovativo'))
      );
    },

    async submit(input) {
      const valid = assertValidProofInput(input);
      const tenant = tenantId();
      return run(async () =>
        toPaymentProof(
          first(
            await gateway.submitProof({
              tenantId: tenant,
              ...valid,
              extractedData: valid.extractedData as PaymentProofRow['extracted_data'] | null,
            }),
            'Comprovativo'
          )
        )
      );
    },

    async reconcile(id) {
      tenantId();
      return run(async () => toPaymentProof(first(await gateway.reconcileProof(id), 'Comprovativo')));
    },

    async reject(id, reason) {
      const note = normalizeReviewNote(reason, { required: true }) as string;
      tenantId();
      return run(async () => toPaymentProof(first(await gateway.rejectProof(id, note), 'Comprovativo')));
    },
  };

  const paymentMatches: PaymentMatchesService = {
    async list(params = {}) {
      const tenant = tenantId();
      return run(async () =>
        (
          await gateway.listMatches(tenant, {
            orderId: params.orderId ?? null,
            paymentEventId: params.paymentEventId ?? null,
            paymentProofId: params.paymentProofId ?? null,
            limit: LIST_LIMIT,
          })
        ).map(toPaymentMatch)
      );
    },

    async confirmManually(input) {
      const note = normalizeReviewNote(input.note, { required: false });
      tenantId();
      return run(async () =>
        toPaymentMatch(
          first(
            await gateway.confirmManually({
              orderId: input.orderId,
              paymentEventId: input.paymentEventId,
              paymentProofId: input.paymentProofId ?? null,
              note,
            }),
            'Correspondência'
          )
        )
      );
    },
  };

  return { payments, paymentAccounts, paymentEvents, paymentProofs, paymentMatches };
}
