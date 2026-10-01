import { useMutation, useQuery } from '@/lib/query';
import { api, type PaymentListParams } from '@/services';
import type { ID } from '@/types';

import { queryKeys } from './queryKeys';

const affected = [queryKeys.payments.all, queryKeys.orders.all, queryKeys.dashboard.all, queryKeys.automation.all];

export function usePayments(params: PaymentListParams = {}) {
  return useQuery(queryKeys.payments.list(params), () => api.payments.list(params), { keepPreviousData: true });
}

export function usePaymentsSummary() {
  return useQuery(queryKeys.payments.summary(), () => api.payments.summary());
}

export function usePayment(id: ID) {
  return useQuery(queryKeys.payments.detail(id), () => api.payments.get(id));
}

export function usePaymentAccounts() {
  return useQuery(queryKeys.payments.accounts(), () => api.payments.listAccounts());
}

export function useApprovePayment() {
  return useMutation((id: ID) => api.payments.approve(id), { invalidate: affected });
}

export function useRejectPayment() {
  return useMutation(({ id, reason }: { id: ID; reason: string }) => api.payments.reject(id, reason), {
    invalidate: affected,
  });
}
