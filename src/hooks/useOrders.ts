import { useMutation, useQuery } from '@/lib/query';
import { api, type OrderListParams } from '@/services';
import type { ID } from '@/types';

import { queryKeys } from './queryKeys';

const affected = [queryKeys.orders.all, queryKeys.dashboard.all, queryKeys.automation.all, queryKeys.payments.all];

export function useOrders(params: OrderListParams = {}) {
  return useQuery(queryKeys.orders.list(params), () => api.orders.list(params), { keepPreviousData: true });
}

export function useOrderCounts() {
  return useQuery(queryKeys.orders.counts(), () => api.orders.counts());
}

export function useOrder(id: ID) {
  return useQuery(queryKeys.orders.detail(id), () => api.orders.get(id));
}

export function useRetryActivation() {
  return useMutation(
    ({ id, destination }: { id: ID; destination?: string }) => api.orders.retryActivation(id, { destination }),
    { invalidate: affected }
  );
}

export function useVerifyActivation() {
  return useMutation((id: ID) => api.orders.verifyActivation(id), { invalidate: affected });
}

export function useCancelOrder() {
  return useMutation((id: ID) => api.orders.cancel(id), { invalidate: affected });
}

export function useResendConfirmation() {
  return useMutation((id: ID) => api.orders.resendConfirmation(id));
}
