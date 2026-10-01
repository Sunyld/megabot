import { useMutation, useQuery } from '@/lib/query';
import { api, type OrderListParams } from '@/services';
import type { CreateOrderInput, ID } from '@/types';

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

/** Registers an order. Keep the same `idempotencyKey` when retrying the same request. */
export function useCreateOrder() {
  return useMutation((input: CreateOrderInput) => api.orders.create(input), { invalidate: affected });
}

export function useMarkOrderAwaitingPayment() {
  return useMutation((id: ID) => api.orders.markAwaitingPayment(id), { invalidate: affected });
}

export function useCancelOrder() {
  return useMutation(({ id, reason }: { id: ID; reason?: string }) => api.orders.cancel(id, { reason }), {
    invalidate: affected,
  });
}

export function useResendConfirmation() {
  return useMutation((id: ID) => api.orders.resendConfirmation(id));
}
