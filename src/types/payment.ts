import type { ID, ISODateString, PaymentMethod, TenantScoped } from './common';

/**
 * View model of the Payments screens: one "payment case" = a customer's proof
 * and/or a real wallet event, with the reconciliation result. In Supabase mode
 * it is built from payment_proofs / payment_events / payment_matches (005).
 *
 * - confirmed: a REAL wallet event matched the order (rules or a human decision).
 * - pending:   proof received, the real wallet event has not arrived yet.
 * - review:    data mismatch — needs a human decision.
 * - rejected:  invalid / duplicated / manually rejected.
 * A proof alone is never "confirmed".
 */
export type PaymentStatus = 'confirmed' | 'pending' | 'review' | 'rejected';

export type PaymentFilter = 'all' | PaymentStatus;

export type ReconciliationCheckKey =
  | 'order'
  | 'provider'
  | 'transaction_id'
  | 'amount'
  | 'account'
  | 'sender'
  | 'datetime'
  | 'duplicate';

export type ReconciliationCheck = {
  key: ReconciliationCheckKey;
  expected?: string;
  actual?: string;
  result: 'match' | 'mismatch' | 'missing';
};

/** Fields extracted from the customer's proof message (AI-assisted, never authoritative). */
export type ExtractedProof = {
  transactionId: string | null;
  amount: number | null;
  account: string | null;
  datetime: ISODateString | null;
  destination: string | null;
};

export type PaymentProof = {
  rawText: string | null;
  receivedAt: ISODateString;
  /** Who read the fields: AI / parser (never authoritative) or typed in by a person. */
  extractedBy: 'ai' | 'parser' | 'manual';
  /** 0..1 extraction confidence; `null` when typed in. */
  confidence: number | null;
  fields: ExtractedProof;
};

/** Real wallet movement: read by an Android device (SMS), typed in by the owner, or from a provider API. */
export type WalletEvent = {
  rawText: string | null;
  receivedAt: ISODateString;
  source: 'sms' | 'manual' | 'provider_api';
  /** Device / SIM that read the SMS (`null` for other sources). */
  deviceId: ID | null;
  deviceName: string | null;
  simSlot: 1 | 2 | null;
};

export type Payment = TenantScoped & {
  id: ID;
  /** `null` when the customer only sent a message without a readable ID. */
  transactionId: string | null;
  amount: number;
  /** `null` when the customer did not say which wallet. */
  method: PaymentMethod | null;
  status: PaymentStatus;
  payerName: string | null;
  payerNumber: string | null;
  /** Seller's receiving wallet account. */
  account: string;
  paidAt: ISODateString;
  receivedAt: ISODateString;
  orderId: ID | null;
  orderCode: string | null;
  proof: PaymentProof | null;
  walletEvent: WalletEvent | null;
  checks: ReconciliationCheck[];
  reviewReason?: string;
  confirmedBy?: 'rules' | 'manual';
};

/** A wallet account where the seller receives payments. */
export type PaymentAccount = {
  method: PaymentMethod;
  account: string;
  holderName: string;
  /** Device/SIM that reads this wallet's confirmation SMS. */
  monitoredBy: { deviceId: ID; deviceName: string; simSlot: 1 | 2 } | null;
};

export type PaymentsSummary = {
  received: number;
  confirmed: number;
  pending: number;
  review: number;
  rejected: number;
  confirmedAmount: number;
};
