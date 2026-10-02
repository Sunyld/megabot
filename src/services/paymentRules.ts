/**
 * Payment reconciliation rules shared by every backend. They mirror migration
 * 005 (private.normalize_transaction_id, normalize_account_identifier,
 * sender_identifiers_compatible, payment_match_window, evaluate_payment_match,
 * payment_metadata_is_safe). The database applies them again and is the only
 * authority that confirms a payment; the app uses them for input feedback,
 * the mock backend and to explain decisions.
 *
 * Rules, not AI: a payment is confirmed only when a REAL wallet event matches
 * the order on provider, transaction ID (when claimed), receiving account,
 * currency, EXACT amount, compatible sender and time window.
 */
import type {
  CreatePaymentAccountInput,
  ISODateString,
  MatchCheckKey,
  MatchCheckResult,
  MatchMethod,
  OrderStatus,
  PaymentAccountStatus,
  PaymentEventRecord,
  PaymentProofRecord,
  PaymentProvider,
  ReconciliationStatus,
  RecordPaymentEventInput,
  SubmitPaymentProofInput,
  UpdatePaymentAccountInput,
} from '@/types';

import { AppError } from './errors';
import { normalizePhone } from './orderRules';

export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = ['MPESA', 'EMOLA'];

export const isPaymentProvider = (value: unknown): value is PaymentProvider =>
  typeof value === 'string' && (PAYMENT_PROVIDERS as readonly string[]).includes(value);

export const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = [
  'UNMATCHED',
  'PENDING_REVIEW',
  'MATCHED',
  'CONFIRMED',
  'REJECTED',
  'DUPLICATE',
  'EXPIRED',
];

export const isReconciliationStatus = (value: unknown): value is ReconciliationStatus =>
  typeof value === 'string' && (RECONCILIATION_STATUSES as readonly string[]).includes(value);

/** A proof in one of these statuses never changes again. */
export const FINAL_PROOF_STATUSES: readonly ReconciliationStatus[] = ['CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED'];

/** Proofs still waiting for a decision (they keep the order in VERIFYING). */
export const OPEN_PROOF_STATUSES: readonly ReconciliationStatus[] = ['UNMATCHED', 'PENDING_REVIEW', 'MATCHED'];

/** Orders that can still receive a payment. */
export const PAYABLE_ORDER_STATUSES: readonly OrderStatus[] = ['PENDING', 'AWAITING_PAYMENT', 'VERIFYING'];

/** Failures a person may accept after checking (manual confirmation); everything else stays blocking. */
export const MANUAL_OVERRIDABLE_FAILURES: readonly string[] = ['OUTSIDE_TIME_WINDOW', 'SENDER_MISMATCH'];

export const PAYMENT_RULES = {
  accountNameMin: 2,
  accountNameMax: 120,
  identifierMax: 64,
  rawMessageMax: 2000,
  noteMax: 500,
  amountMax: 9_999_999_999.99,
  /** Clock tolerance for "occurred at" (minutes in the future). */
  futureToleranceMinutes: 10,
  /** Limit of a configured time window (7 days). */
  windowMaxMinutes: 10_080,
  metadataMaxBytes: 8192,
} as const;

/** Customer-facing explanation of a reconciliation reason (status_reason / match reason). */
export const RECONCILIATION_REASON_TEXT: Record<string, string> = {
  NO_EVENT_YET: 'Ainda não existe um movimento real da carteira com este ID de transação.',
  TRANSACTION_ID_REQUIRED: 'O comprovativo não indica o fornecedor e o ID da transação — não é possível verificá-lo.',
  AMBIGUOUS_EVENT: 'Existem vários movimentos com este ID de transação. Decida manualmente.',
  ORDER_REQUIRED: 'O movimento existe, mas o comprovativo não está associado a um pedido.',
  MULTIPLE_CANDIDATES: 'Vários pedidos têm este valor. Escolha o pedido certo.',
  SENDER_NOT_VERIFIED: 'Um pedido corresponde ao valor, mas o remetente não pôde ser confirmado.',
  EVENT_ALREADY_USED: 'Este movimento já confirmou outro pedido.',
  ORDER_ALREADY_PAID: 'O pedido já está pago com outro movimento.',
  ORDER_NOT_PAYABLE: 'O pedido já não pode receber pagamentos (cancelado, expirado ou concluído).',
  PROVIDER_MISMATCH: 'O fornecedor do comprovativo é diferente do movimento real (M-Pesa ≠ e-Mola).',
  TRANSACTION_ID_MISMATCH: 'O ID da transação do comprovativo é diferente do movimento real.',
  ACCOUNT_INACTIVE: 'O dinheiro entrou numa conta desativada.',
  ACCOUNT_MISMATCH: 'A conta de destino indicada não é a conta que recebeu o movimento.',
  CURRENCY_MISMATCH: 'A moeda do movimento é diferente da do pedido.',
  UNDERPAID: 'O valor recebido é inferior ao valor do pedido.',
  OVERPAID: 'O valor recebido é superior ao valor do pedido.',
  PROOF_AMOUNT_MISMATCH: 'O valor indicado no comprovativo é diferente do movimento real.',
  SENDER_MISMATCH: 'O remetente do movimento não corresponde ao do comprovativo.',
  OUTSIDE_TIME_WINDOW: 'O movimento ocorreu fora da janela de tempo do pedido.',
  TENANT_MISMATCH: 'Registos de empresas diferentes.',
  REJECTED_MANUALLY: 'Rejeitado manualmente.',
  CONFIRMED_MANUALLY: 'Confirmado manualmente com base no movimento real da carteira.',
};

export const reconciliationReasonText = (reason: string | null | undefined): string | undefined =>
  reason ? (RECONCILIATION_REASON_TEXT[reason] ?? 'Os dados não coincidem.') : undefined;

// ─── Normalization (same as the SQL helpers) ──────────────────────────────────

/** "pp261001.1111.a00001" → "PP261001.1111.A00001"; `null` when not a plausible ID. */
export function normalizeTransactionId(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{3,63}$/.test(value) ? value : null;
}

/** Phone → E.164; other identifiers (till / merchant codes) → uppercase alphanumerics. */
export function normalizeAccountIdentifier(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/[\s().-]/g, '');
  if (!value) return null;
  const phone = normalizePhone(value);
  if (phone) return phone;
  const upper = value.toUpperCase();
  return /^\+?[A-Z0-9]{3,64}$/.test(upper) ? upper : null;
}

/** Digits of a sender as the provider shows it; mask characters (*, X, •, #) become "?". */
export function senderDigits(raw: string | null | undefined): string | null {
  let value = (raw ?? '')
    .toUpperCase()
    .replace(/[*X•#]/g, '?')
    .replace(/[^0-9?]/g, '');
  if (value.startsWith('00')) value = value.slice(2);
  if (value.startsWith('258') && value.length >= 12) value = value.slice(3);
  return value || null;
}

/**
 * true: ≥ 3 visible digits compared (right-aligned) and none differ.
 * false: a visible digit differs. null: not enough evidence either way.
 */
export function sendersCompatible(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = senderDigits(a);
  const y = senderDigits(b);
  if (!x || !y) return null;
  let comparable = 0;
  for (let i = 1; i <= Math.min(x.length, y.length); i++) {
    const cx = x[x.length - i];
    const cy = y[y.length - i];
    if (cx !== '?' && cy !== '?') {
      if (cx !== cy) return false;
      comparable++;
    }
  }
  return comparable >= 3 ? true : null;
}

// ─── Time window (tenant_settings.payments.match_window) ──────────────────────

export type MatchWindow = { beforeMinutes: number; afterMinutes: number };

export const DEFAULT_MATCH_WINDOWS: Readonly<Record<PaymentProvider, MatchWindow>> = {
  MPESA: { beforeMinutes: 60, afterMinutes: 2880 },
  EMOLA: { beforeMinutes: 60, afterMinutes: 2880 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const windowValue = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= PAYMENT_RULES.windowMaxMinutes
    ? Math.floor(value)
    : fallback;

/**
 * Minutes before / after the order's creation in which its payment may occur:
 * `{ "match_window": { "MPESA": { "before_minutes": 60, "after_minutes": 2880 } } }`.
 * Invalid or out-of-range values fall back to the provider default.
 */
export function resolveMatchWindow(paymentsSettings: unknown, provider: PaymentProvider): MatchWindow {
  const fallback = DEFAULT_MATCH_WINDOWS[provider];
  const config = isRecord(paymentsSettings) && isRecord(paymentsSettings.match_window) ? paymentsSettings.match_window[provider] : null;
  if (!isRecord(config)) return { ...fallback };
  return {
    beforeMinutes: windowValue(config.before_minutes, fallback.beforeMinutes),
    afterMinutes: windowValue(config.after_minutes, fallback.afterMinutes),
  };
}

// ─── Evaluation (same decision table as private.evaluate_payment_match) ───────

export type MatchOrderFacts = {
  id: string;
  tenantId: string;
  status: OrderStatus;
  price: number;
  currency: string;
  createdAt: ISODateString;
};

export type MatchEventFacts = Pick<
  PaymentEventRecord,
  'id' | 'tenantId' | 'provider' | 'transactionId' | 'amount' | 'currency' | 'senderIdentifier' | 'recipientIdentifier' | 'occurredAt'
>;

export type MatchProofFacts = Pick<
  PaymentProofRecord,
  'id' | 'tenantId' | 'provider' | 'transactionId' | 'amount' | 'currency' | 'senderIdentifier' | 'recipientIdentifier'
>;

export type MatchContext = {
  /** The receiving account of the event. */
  account: { status: PaymentAccountStatus; accountIdentifier: string } | null;
  /** The event already has a CONFIRMED match. */
  eventAlreadyUsed: boolean;
  /** The order already has a CONFIRMED match. */
  orderAlreadyPaid: boolean;
  window: MatchWindow;
};

export type MatchDecision = 'CONFIRMED' | 'PENDING_REVIEW' | 'DUPLICATE' | 'REJECTED';

export type PaymentEvaluation = {
  decision: MatchDecision;
  /** First failure (or the duplicate / tenant reason); `null` when confirmed. */
  reason: string | null;
  failures: string[];
  methods: MatchMethod[];
  checks: Partial<Record<MatchCheckKey, MatchCheckResult>>;
  orderAmount: number;
  eventAmount: number;
  currency: string;
};

/** Money compared in cents: never floating point equality. */
const cents = (value: number) => Math.round(value * 100);

export function evaluatePaymentMatch(
  order: MatchOrderFacts,
  event: MatchEventFacts,
  proof: MatchProofFacts | null,
  context: MatchContext
): PaymentEvaluation {
  const base = { orderAmount: order.price, eventAmount: event.amount, currency: event.currency };

  if (event.tenantId !== order.tenantId || (proof && proof.tenantId !== order.tenantId)) {
    return { ...base, decision: 'REJECTED', reason: 'TENANT_MISMATCH', failures: ['TENANT_MISMATCH'], methods: [], checks: {} };
  }
  if (context.eventAlreadyUsed) {
    return {
      ...base,
      decision: 'DUPLICATE',
      reason: 'EVENT_ALREADY_USED',
      failures: ['EVENT_ALREADY_USED'],
      methods: [],
      checks: { duplicate: 'FAIL' },
    };
  }

  const failures: string[] = [];
  const methods: MatchMethod[] = [];
  const checks: Partial<Record<MatchCheckKey, MatchCheckResult>> = {};
  const fail = (key: MatchCheckKey, failure: string) => {
    checks[key] = 'FAIL';
    failures.push(failure);
  };
  const pass = (key: MatchCheckKey, method?: MatchMethod) => {
    checks[key] = 'PASS';
    if (method) methods.push(method);
  };

  // Order
  if (context.orderAlreadyPaid) fail('order', 'ORDER_ALREADY_PAID');
  else if (!PAYABLE_ORDER_STATUSES.includes(order.status)) fail('order', 'ORDER_NOT_PAYABLE');
  else pass('order', 'ORDER_CONTEXT');

  // Provider and transaction ID — only when the customer claimed them.
  if (proof) {
    if (proof.provider !== event.provider) fail('provider', 'PROVIDER_MISMATCH');
    else pass('provider');
    if (proof.transactionId !== event.transactionId) fail('transaction_id', 'TRANSACTION_ID_MISMATCH');
    else pass('transaction_id', 'TRANSACTION_ID');
  }

  // Receiving account: active, and the one named by the customer / the provider message.
  const accountIdentifier = context.account?.accountIdentifier ?? null;
  if (context.account?.status !== 'ACTIVE') fail('account', 'ACCOUNT_INACTIVE');
  else if (
    (proof?.recipientIdentifier && normalizeAccountIdentifier(proof.recipientIdentifier) !== accountIdentifier) ||
    (event.recipientIdentifier && normalizeAccountIdentifier(event.recipientIdentifier) !== accountIdentifier)
  ) {
    fail('account', 'ACCOUNT_MISMATCH');
  } else pass('account', 'ACCOUNT');

  // Currency and EXACT amount — no tolerance, no overpayment policy.
  if (event.currency !== order.currency) {
    fail('currency', 'CURRENCY_MISMATCH');
    checks.amount = 'FAIL';
  } else if (cents(event.amount) < cents(order.price)) {
    checks.currency = 'PASS';
    fail('amount', 'UNDERPAID');
  } else if (cents(event.amount) > cents(order.price)) {
    checks.currency = 'PASS';
    fail('amount', 'OVERPAID');
  } else {
    checks.currency = 'PASS';
    pass('amount', 'AMOUNT');
  }
  if ((proof?.amount != null && cents(proof.amount) !== cents(event.amount)) || (proof?.currency != null && proof.currency !== event.currency)) {
    fail('proof_amount', 'PROOF_AMOUNT_MISMATCH');
  }

  // Sender (masked numbers compare on visible digits).
  const sender = sendersCompatible(proof?.senderIdentifier, event.senderIdentifier);
  if (sender === false) fail('sender', 'SENDER_MISMATCH');
  else if (sender === true) pass('sender', 'SENDER');
  else checks.sender = 'SKIPPED';

  // Time window around the order's creation.
  const occurred = Date.parse(event.occurredAt);
  const created = Date.parse(order.createdAt);
  const minute = 60_000;
  if (occurred < created - context.window.beforeMinutes * minute || occurred > created + context.window.afterMinutes * minute) {
    fail('time_window', 'OUTSIDE_TIME_WINDOW');
  } else pass('time_window', 'TIME_WINDOW');

  return {
    ...base,
    decision: failures.length === 0 ? 'CONFIRMED' : 'PENDING_REVIEW',
    reason: failures[0] ?? null,
    failures,
    methods,
    checks,
  };
}

/** Failures that block a manual confirmation (a person may only accept a time-window or sender doubt). */
export const blockingFailures = (evaluation: PaymentEvaluation): string[] =>
  evaluation.decision === 'DUPLICATE' || evaluation.decision === 'REJECTED'
    ? [evaluation.reason ?? 'EVENT_ALREADY_USED']
    : evaluation.failures.filter((failure) => !MANUAL_OVERRIDABLE_FAILURES.includes(failure));

// ─── Payment data never carries credentials ───────────────────────────────────

const CREDENTIAL_KEY = /(password|passwd|secret|token|apikey|privatekey|authorization|cookie|jwt|credential|servicerole)/;
const PAYMENT_KEY_WORD = /(^|[^a-z])(m?pin|otp|passcode|cvv|private|signing)([^a-z]|$)/;
const PAYMENT_KEY_JOINED = /(pincode|mpin|passcode|accesskey|clientsecret|signingkey|privkey|privatekey)/;
const TOKEN_VALUE = /^(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sb_secret_)/;

function unsafeNode(value: unknown): boolean {
  if (typeof value === 'string') return TOKEN_VALUE.test(value);
  if (Array.isArray(value)) return value.some(unsafeNode);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const lower = key.toLowerCase();
    const joined = lower.replace(/[^a-z0-9]/g, '');
    return CREDENTIAL_KEY.test(joined) || PAYMENT_KEY_WORD.test(lower) || PAYMENT_KEY_JOINED.test(joined) || unsafeNode(child);
  });
}

/** Same rule as private.payment_metadata_is_safe: small object, no PIN / OTP / keys / tokens. */
export function isSafePaymentMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (new TextEncoder().encode(JSON.stringify(value)).length > PAYMENT_RULES.metadataMaxBytes) return false;
  return !unsafeNode(value);
}

// ─── Input validation (feedback before the network; the database re-checks) ───

const invalid = (message: string) => new AppError('VALIDATION_ERROR', message);

const trimmedOrNull = (value: string | null | undefined) => value?.trim() || null;

export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= PAYMENT_RULES.amountMax &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  );
}

function optionalIdentifier(value: string | null | undefined, label: string): string | null {
  const trimmed = trimmedOrNull(value);
  if (trimmed && trimmed.length > PAYMENT_RULES.identifierMax) {
    throw invalid(`${label} deve ter no máximo ${PAYMENT_RULES.identifierMax} caracteres.`);
  }
  return trimmed;
}

function optionalRawMessage(value: string | null | undefined): string | null {
  const trimmed = trimmedOrNull(value);
  if (trimmed && trimmed.length > PAYMENT_RULES.rawMessageMax) {
    throw invalid(`A mensagem deve ter no máximo ${PAYMENT_RULES.rawMessageMax} caracteres.`);
  }
  return trimmed;
}

function optionalCurrency(value: string | null | undefined): string | null {
  const currency = trimmedOrNull(value)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw invalid('Moeda inválida (use o código de 3 letras, ex.: MZN).');
  return currency;
}

export function assertValidAccountInput(input: CreatePaymentAccountInput): CreatePaymentAccountInput {
  if (!isPaymentProvider(input.provider)) throw invalid('Escolha o fornecedor (M-Pesa ou e-Mola).');
  const accountName = input.accountName?.trim() ?? '';
  if (accountName.length < PAYMENT_RULES.accountNameMin || accountName.length > PAYMENT_RULES.accountNameMax) {
    throw invalid(`O nome do titular deve ter entre ${PAYMENT_RULES.accountNameMin} e ${PAYMENT_RULES.accountNameMax} caracteres.`);
  }
  if (!normalizeAccountIdentifier(input.accountIdentifier)) {
    throw invalid('Número ou código da conta inválido.');
  }
  return { provider: input.provider, accountName, accountIdentifier: input.accountIdentifier.trim() };
}

export function assertValidAccountUpdate(input: UpdatePaymentAccountInput): UpdatePaymentAccountInput {
  const out: UpdatePaymentAccountInput = {};
  if (input.accountName !== undefined) {
    const accountName = input.accountName.trim();
    if (accountName.length < PAYMENT_RULES.accountNameMin || accountName.length > PAYMENT_RULES.accountNameMax) {
      throw invalid(`O nome do titular deve ter entre ${PAYMENT_RULES.accountNameMin} e ${PAYMENT_RULES.accountNameMax} caracteres.`);
    }
    out.accountName = accountName;
  }
  if (input.status !== undefined) {
    if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') throw invalid('Estado inválido.');
    out.status = input.status;
  }
  return out;
}

export type ValidRecordPaymentEventInput = {
  paymentAccountId: string;
  transactionId: string;
  amount: number;
  occurredAt: ISODateString | null;
  currency: string | null;
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  rawMessage: string | null;
};

export function assertValidEventInput(input: RecordPaymentEventInput, now = Date.now()): ValidRecordPaymentEventInput {
  if (!input.paymentAccountId) throw invalid('Escolha a conta que recebeu o dinheiro.');
  const transactionId = normalizeTransactionId(input.transactionId);
  if (!transactionId) throw invalid('ID de transação inválido.');
  if (!isValidAmount(input.amount)) throw invalid('Valor inválido (maior que zero, no máximo 2 casas decimais).');
  let occurredAt: ISODateString | null = null;
  if (input.occurredAt) {
    const at = Date.parse(input.occurredAt);
    if (Number.isNaN(at)) throw invalid('Data do movimento inválida.');
    if (at > now + PAYMENT_RULES.futureToleranceMinutes * 60_000) throw invalid('A data do movimento não pode estar no futuro.');
    occurredAt = new Date(at).toISOString();
  }
  return {
    paymentAccountId: input.paymentAccountId,
    transactionId,
    amount: input.amount,
    occurredAt,
    currency: optionalCurrency(input.currency),
    senderIdentifier: optionalIdentifier(input.senderIdentifier, 'O remetente'),
    recipientIdentifier: optionalIdentifier(input.recipientIdentifier, 'O destinatário'),
    rawMessage: optionalRawMessage(input.rawMessage),
  };
}

export type ValidSubmitPaymentProofInput = {
  orderId: string | null;
  provider: PaymentProvider | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  rawMessage: string | null;
  extractedData: Record<string, unknown> | null;
};

export function assertValidProofInput(input: SubmitPaymentProofInput): ValidSubmitPaymentProofInput {
  if (input.provider != null && !isPaymentProvider(input.provider)) throw invalid('Fornecedor inválido.');
  const rawTransactionId = trimmedOrNull(input.transactionId);
  const transactionId = rawTransactionId ? normalizeTransactionId(rawTransactionId) : null;
  if (rawTransactionId && !transactionId) throw invalid('ID de transação inválido.');
  if (input.amount != null && !isValidAmount(input.amount)) throw invalid('Valor inválido (maior que zero, no máximo 2 casas decimais).');
  const rawMessage = optionalRawMessage(input.rawMessage);
  if (!transactionId && !rawMessage) throw invalid('Indique o ID da transação ou cole a mensagem do comprovativo.');
  if (input.extractedData != null && !isSafePaymentMetadata(input.extractedData)) {
    throw invalid('Os dados extraídos contêm campos não permitidos (PIN, códigos ou chaves).');
  }
  return {
    orderId: input.orderId ?? null,
    provider: input.provider ?? null,
    transactionId,
    amount: input.amount ?? null,
    currency: optionalCurrency(input.currency),
    senderIdentifier: optionalIdentifier(input.senderIdentifier, 'O remetente'),
    recipientIdentifier: optionalIdentifier(input.recipientIdentifier, 'A conta de destino'),
    rawMessage,
    extractedData: input.extractedData ?? null,
  };
}

/** Reason of a rejection / note of a manual decision: required for rejections, ≤ 500 chars. */
export function normalizeReviewNote(note: string | null | undefined, { required }: { required: boolean }): string | null {
  const value = trimmedOrNull(note);
  if (required && !value) throw invalid('Indique o motivo.');
  if (value && value.length > PAYMENT_RULES.noteMax) throw invalid(`O motivo deve ter no máximo ${PAYMENT_RULES.noteMax} caracteres.`);
  return value;
}
