import { useMutation, useQuery } from '@/lib/query';
import { api, type PaymentEventListParams, type PaymentMatchListParams, type PaymentProofListParams } from '@/services';
import type {
  ConfirmPaymentInput,
  CreatePaymentAccountInput,
  ID,
  RecordPaymentEventInput,
  SubmitPaymentProofInput,
  UpdatePaymentAccountInput,
} from '@/types';

import { queryKeys } from './queryKeys';

/*
 * Financial core (migration 005). Proofs, real events and decisions stay
 * separate all the way to the screens: a proof is never shown as a payment.
 * Any reconciliation can change orders and the payments screens' read model.
 */
const affected = [
  queryKeys.reconciliation.all,
  queryKeys.payments.all,
  queryKeys.orders.all,
  queryKeys.dashboard.all,
  queryKeys.automation.all,
];

// ── Receiving accounts ──

export function usePaymentAccountRecords() {
  return useQuery(queryKeys.reconciliation.accounts(), () => api.paymentAccounts.list());
}

export function useCreatePaymentAccount() {
  return useMutation((input: CreatePaymentAccountInput) => api.paymentAccounts.create(input), {
    invalidate: [queryKeys.reconciliation.all, queryKeys.payments.all],
  });
}

export function useUpdatePaymentAccount() {
  return useMutation(({ id, input }: { id: ID; input: UpdatePaymentAccountInput }) => api.paymentAccounts.update(id, input), {
    invalidate: [queryKeys.reconciliation.all, queryKeys.payments.all],
  });
}

// ── Real wallet events ──

export function usePaymentEvents(params: PaymentEventListParams = {}) {
  return useQuery(queryKeys.reconciliation.events(params), () => api.paymentEvents.list(params));
}

export function usePaymentEvent(id: ID) {
  return useQuery(queryKeys.reconciliation.event(id), () => api.paymentEvents.get(id));
}

/** Owner / admin: registers a real movement (idempotent) and reconciles it. */
export function useRecordPaymentEvent() {
  return useMutation((input: RecordPaymentEventInput) => api.paymentEvents.record(input), { invalidate: affected });
}

// ── Customer proofs ──

export function usePaymentProofs(params: PaymentProofListParams = {}) {
  return useQuery(queryKeys.reconciliation.proofs(params), () => api.paymentProofs.list(params));
}

export function usePaymentProof(id: ID) {
  return useQuery(queryKeys.reconciliation.proof(id), () => api.paymentProofs.get(id));
}

export function useSubmitPaymentProof() {
  return useMutation((input: SubmitPaymentProofInput) => api.paymentProofs.submit(input), { invalidate: affected });
}

export function useReconcilePaymentProof() {
  return useMutation((id: ID) => api.paymentProofs.reconcile(id), { invalidate: affected });
}

export function useRejectPaymentProof() {
  return useMutation(({ id, reason }: { id: ID; reason: string }) => api.paymentProofs.reject(id, reason), {
    invalidate: affected,
  });
}

// ── Decisions ──

export function usePaymentMatches(params: PaymentMatchListParams = {}) {
  return useQuery(queryKeys.reconciliation.matches(params), () => api.paymentMatches.list(params));
}

/** Owner / admin decision on a review, against a REAL event (audited). */
export function useConfirmPaymentManually() {
  return useMutation((input: ConfirmPaymentInput) => api.paymentMatches.confirmManually(input), { invalidate: affected });
}
