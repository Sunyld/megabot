import { useMutation, useQuery } from '@/lib/query';
import { api } from '@/services';
import type { ActivationTaskListParams, ID } from '@/types';

import { queryKeys } from './queryKeys';

/*
 * Activation engine (migration 006). Tasks are created and moved by the
 * backend; people only retry a FAILED task or settle an UNKNOWN one.
 */
const affected = [queryKeys.activation.all, queryKeys.automation.all, queryKeys.orders.all, queryKeys.devices.all, queryKeys.sims.all, queryKeys.dashboard.all];

export function useActivationTasks(params: ActivationTaskListParams = {}) {
  return useQuery(queryKeys.activation.tasks(params), () => api.activationTasks.list(params));
}

/** Task + attempts + history + order / device / SIM. */
export function useActivationTask(id: ID) {
  return useQuery(queryKeys.activation.task(id), () => api.activationTasks.get(id));
}

export function useDispatchActivationTasks() {
  return useMutation((_: void) => api.activationTasks.dispatch(), { invalidate: affected });
}

export function useRetryActivationTask() {
  return useMutation(({ id, note }: { id: ID; note?: string }) => api.activationTasks.retry(id, note), { invalidate: affected });
}

export function useResolveActivationTask() {
  return useMutation(
    ({ id, outcome, note }: { id: ID; outcome: 'SUCCESS' | 'FAILED'; note: string }) => api.activationTasks.resolve(id, outcome, note),
    { invalidate: affected }
  );
}
