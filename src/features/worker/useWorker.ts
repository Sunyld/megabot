import { useSyncExternalStore } from 'react';

import { getWorkerRuntime } from './instance';

/** The worker's state for the worker screen (no token, ever). */
export function useWorker() {
  const runtime = getWorkerRuntime();
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return { state, runtime };
}
