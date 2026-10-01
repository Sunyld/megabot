import type { ID, ISODateString, PaymentMethod, TenantScoped } from './common';

/**
 * - confirmed: deterministic rules matched the customer's proof with a wallet event.
 * - pending:   proof received, waiting for the wallet event (SMS) to arrive.
 * - review:    data mismatch — needs a human decision.
 * - rejected:  invalid / duplicated / manually rejected.
 */
export type PaymentStatus = 'confirmed' | 'pending' | 'review' | 'rejected';

export type PaymentFilter = 'all' | PaymentStatus;

export type ReconciliationCheckKey =
  | 'transaction_id'
  | 'amount'
  | 'account'
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
  rawText: string;
  receivedAt: ISODateString;
  extractedBy: 'ai' | 'parser';
  /** 0..1 extraction confidence. */
  confidence: number;
  fields: ExtractedProof;
};

/** Wallet confirmation captured by an Android device (SMS reader). */
export type WalletEvent = {
  rawText: string;
  receivedAt: ISODateString;
  deviceId: ID;
  deviceName: string;
  simSlot: 1 | 2;
};

export type Payment = TenantScoped & {
  id: ID;
  transactionId: string;
  amount: number;
  method: PaymentMethod;
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
