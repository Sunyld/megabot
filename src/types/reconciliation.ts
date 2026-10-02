import type { ID, ISODateString, TenantScoped } from './common';

/**
 * The financial core (migration 005). Three different things, never mixed:
 *
 *   PaymentProofRecord  — what the CUSTOMER says ("I paid"). Evidence only.
 *   PaymentEventRecord  — what REALLY reached a receiving account. Immutable fact.
 *   PaymentMatchRecord  — the deterministic DECISION linking them to an order.
 *
 * Only a CONFIRMED match (real event + every rule passing) moves an order to
 * PAID. AI-extracted data is stored for reference and never decides anything.
 */

/** Explicit wallet provider — never inferred from the transaction ID format. */
export type PaymentProvider = 'MPESA' | 'EMOLA';

export type PaymentAccountStatus = 'ACTIVE' | 'INACTIVE';

/** payment_accounts: where the tenant receives money. Never holds credentials (PIN, keys, tokens). */
export type PaymentAccountRecord = TenantScoped & {
  id: ID;
  provider: PaymentProvider;
  /** Holder name as the provider shows it. */
  accountName: string;
  /** Normalized: phones in E.164 (+258…), other identifiers (till / merchant codes) uppercase. */
  accountIdentifier: string;
  status: PaymentAccountStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

/** MANUAL = recorded in the app by the owner / admin; SMS and PROVIDER_API arrive in later phases. */
export type PaymentEventSource = 'MANUAL' | 'SMS' | 'PROVIDER_API';

/** payment_events: a real movement on a receiving account. Corrections are new events, never edits. */
export type PaymentEventRecord = TenantScoped & {
  id: ID;
  paymentAccountId: ID;
  provider: PaymentProvider;
  transactionId: string;
  amount: number;
  currency: string;
  /** As the provider shows it — may be masked ("84****001"). */
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  occurredAt: ISODateString;
  receivedAt: ISODateString;
  rawMessage: string | null;
  source: PaymentEventSource;
  /** Member who recorded a MANUAL event. */
  recordedBy: ID | null;
  createdAt: ISODateString;
};

/** Shared by proofs and matches. CONFIRMED / REJECTED / DUPLICATE / EXPIRED are final for a proof. */
export type ReconciliationStatus =
  | 'UNMATCHED'
  | 'PENDING_REVIEW'
  | 'MATCHED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'EXPIRED';

export type PaymentProofSource = 'MANUAL' | 'WHATSAPP';

/** payment_proofs: the customer's claim. Its status is set by the backend only. */
export type PaymentProofRecord = TenantScoped & {
  id: ID;
  orderId: ID | null;
  provider: PaymentProvider | null;
  transactionId: string | null;
  amount: number | null;
  currency: string | null;
  senderIdentifier: string | null;
  recipientIdentifier: string | null;
  rawMessage: string | null;
  source: PaymentProofSource;
  /** AI / parser output, for reference only — reconciliation never reads it. */
  extractedData: Record<string, unknown>;
  status: ReconciliationStatus;
  /** Machine reason of the status (NO_EVENT_YET, UNDERPAID…), see paymentRules. */
  statusReason: string | null;
  /** Human note when rejected. */
  reviewNote: string | null;
  submittedBy: ID | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

/** Deterministic criteria that held — not an AI confidence. */
export type MatchMethod = 'TRANSACTION_ID' | 'AMOUNT' | 'ACCOUNT' | 'SENDER' | 'TIME_WINDOW' | 'ORDER_CONTEXT' | 'MANUAL';

export type MatchCheckKey =
  | 'order'
  | 'provider'
  | 'transaction_id'
  | 'account'
  | 'currency'
  | 'amount'
  | 'proof_amount'
  | 'sender'
  | 'time_window'
  | 'duplicate';

export type MatchCheckResult = 'PASS' | 'FAIL' | 'SKIPPED';

/** payment_matches: one reconciliation decision (append-only). */
export type PaymentMatchRecord = TenantScoped & {
  id: ID;
  orderId: ID;
  paymentProofId: ID | null;
  paymentEventId: ID | null;
  status: ReconciliationStatus;
  methods: MatchMethod[];
  /** First failing rule (UNDERPAID, SENDER_MISMATCH…), or CONFIRMED_MANUALLY. */
  reason: string | null;
  checks: Partial<Record<MatchCheckKey, MatchCheckResult>>;
  failures: string[];
  orderAmount: number | null;
  eventAmount: number | null;
  currency: string | null;
  matchedAt: ISODateString;
  /** Member who decided / triggered it; `null` = automatic. */
  matchedBy: ID | null;
  createdAt: ISODateString;
};

export type CreatePaymentAccountInput = {
  provider: PaymentProvider;
  accountName: string;
  /** Phone ("84 123 4567") or any provider identifier (till / merchant code). */
  accountIdentifier: string;
};

export type UpdatePaymentAccountInput = {
  accountName?: string;
  status?: PaymentAccountStatus;
};

/** A real wallet movement typed in by the owner / admin (e.g. from the merchant's statement). */
export type RecordPaymentEventInput = {
  paymentAccountId: ID;
  transactionId: string;
  amount: number;
  /** Defaults to now; never in the future. */
  occurredAt?: ISODateString | null;
  /** Defaults to the tenant currency. */
  currency?: string | null;
  senderIdentifier?: string | null;
  recipientIdentifier?: string | null;
  rawMessage?: string | null;
};

/** What the customer sent. Needs a transaction ID or the original message. */
export type SubmitPaymentProofInput = {
  orderId?: ID | null;
  provider?: PaymentProvider | null;
  transactionId?: string | null;
  amount?: number | null;
  currency?: string | null;
  senderIdentifier?: string | null;
  recipientIdentifier?: string | null;
  rawMessage?: string | null;
  /** AI / parser output — stored, never used to confirm. */
  extractedData?: Record<string, unknown> | null;
};

/** Human decision on a review: links a REAL event to an order (owner / admin, audited). */
export type ConfirmPaymentInput = {
  orderId: ID;
  paymentEventId: ID;
  paymentProofId?: ID | null;
  note?: string | null;
};
