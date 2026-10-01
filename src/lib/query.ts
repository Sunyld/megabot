import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A deliberately small data-fetching cache (stale-while-revalidate).
 *
 * Screens never call services directly: they use domain hooks (useOrders,
 * usePayments…) built on `useQuery`. Swapping the mock services for Supabase
 * does not touch this layer — and it can later be replaced by TanStack Query
 * with the same hook signatures if the app outgrows it.
 */

export type QueryKey = readonly (string | number | boolean | null | undefined | Record<string, unknown>)[];

export type QueryStatus = 'pending' | 'success' | 'error';

export type QuerySnapshot<T> = {
  status: QueryStatus;
  data: T | undefined;
  error: unknown;
  isFetching: boolean;
  isRefreshing: boolean;
  updatedAt: number | undefined;
};

type Entry<T> = {
  snapshot: QuerySnapshot<T>;
  listeners: Set<() => void>;
  fetcher?: () => Promise<T>;
  inFlight?: Promise<void>;
  stale: boolean;
};

const cache = new Map<string, Entry<unknown>>();

const hashKey = (key: QueryKey) => JSON.stringify(key);

const emptySnapshot: QuerySnapshot<never> = {
  status: 'pending',
  data: undefined,
  error: undefined,
  isFetching: false,
  isRefreshing: false,
  updatedAt: undefined,
};

function getEntry<T>(hash: string): Entry<T> {
  let entry = cache.get(hash) as Entry<T> | undefined;
  if (!entry) {
    entry = { snapshot: emptySnapshot, listeners: new Set(), stale: true };
    cache.set(hash, entry as Entry<unknown>);
  }
  return entry;
}

function update<T>(entry: Entry<T>, patch: Partial<QuerySnapshot<T>>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((listener) => listener());
}

function run<T>(entry: Entry<T>, { refresh = false } = {}): Promise<void> {
  if (entry.inFlight || !entry.fetcher) return entry.inFlight ?? Promise.resolve();
  const fetcher = entry.fetcher;
  update(entry, { isFetching: true, isRefreshing: refresh });

  entry.inFlight = fetcher()
    .then((data) => {
      entry.stale = false;
      update(entry, {
        status: 'success',
        data,
        error: undefined,
        isFetching: false,
        isRefreshing: false,
        updatedAt: Date.now(),
      });
    })
    .catch((error: unknown) => {
      update(entry, {
        // Keep showing previous data if we have it; surface the error alongside.
        status: entry.snapshot.data === undefined ? 'error' : 'success',
        error,
        isFetching: false,
        isRefreshing: false,
      });
    })
    .finally(() => {
      entry.inFlight = undefined;
    });

  return entry.inFlight;
}

/** Registers the latest fetcher for a key and loads it if stale. */
function activate<T>(hash: string, fetcher: () => Promise<T>, enabled: boolean) {
  const entry = getEntry<T>(hash);
  entry.fetcher = fetcher;
  if (enabled && (entry.stale || entry.snapshot.status === 'error')) {
    void run(entry);
  }
}

export type UseQueryOptions = {
  enabled?: boolean;
  /** Keep showing the previous key's data while a new key loads (filters, search). */
  keepPreviousData?: boolean;
};

export type UseQueryResult<T> = QuerySnapshot<T> & {
  isLoading: boolean;
  isError: boolean;
  isPlaceholder: boolean;
  refetch: () => Promise<void>;
};

export function useQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  { enabled = true, keepPreviousData = false }: UseQueryOptions = {}
): UseQueryResult<T> {
  const hash = hashKey(key);
  const entry = getEntry<T>(hash);

  const snapshot = useSyncExternalStore(
    (listener) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    () => entry.snapshot,
    () => entry.snapshot
  );

  useEffect(() => {
    activate(hash, fetcher, enabled);
    // `fetcher` is intentionally not a dependency: the key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, enabled]);

  // Remember the last resolved data (adjusting state during render, not in an effect).
  const [previous, setPrevious] = useState<T | undefined>(undefined);
  if (keepPreviousData && snapshot.data !== undefined && snapshot.data !== previous) {
    setPrevious(snapshot.data);
  }

  const isPlaceholder = keepPreviousData && snapshot.data === undefined && previous !== undefined;
  const data = isPlaceholder ? previous : snapshot.data;

  return {
    ...snapshot,
    data,
    status: isPlaceholder ? 'success' : snapshot.status,
    isLoading: snapshot.status === 'pending' && !isPlaceholder,
    isError: snapshot.status === 'error',
    isPlaceholder,
    refetch: () => run(entry, { refresh: true }),
  };
}

const matches = (hash: string, prefix: QueryKey) => {
  const target = hashKey(prefix);
  return hash === target || hash.startsWith(target.slice(0, -1) + ',');
};

/** Marks matching queries stale and refetches the ones currently on screen. */
export function invalidateQueries(prefix: QueryKey = []) {
  const all = prefix.length === 0;
  cache.forEach((entry, hash) => {
    if (!all && !matches(hash, prefix)) return;
    entry.stale = true;
    if (entry.listeners.size > 0) void run(entry);
  });
}

/** Optimistic / direct cache writes. */
export function setQueryData<T>(key: QueryKey, updater: (current: T | undefined) => T | undefined) {
  const entry = getEntry<T>(hashKey(key));
  const next = updater(entry.snapshot.data);
  if (next === undefined) return;
  update(entry, { status: 'success', data: next, error: undefined });
}

export function getQueryData<T>(key: QueryKey): T | undefined {
  return (cache.get(hashKey(key)) as Entry<T> | undefined)?.snapshot.data;
}

/** Drops everything (e.g. on sign-out, so no tenant data survives the session). */
export function clearQueryCache() {
  cache.clear();
}

export type UseMutationOptions<TInput, TResult> = {
  onSuccess?: (result: TResult, input: TInput) => void;
  onError?: (error: unknown, input: TInput) => void;
  /** Query prefixes to invalidate after success. */
  invalidate?: QueryKey[];
};

export function useMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  { onSuccess, onError, invalidate = [] }: UseMutationOptions<TInput, TResult> = {}
) {
  const [state, setState] = useState<{ isPending: boolean; error: unknown }>({
    isPending: false,
    error: undefined,
  });

  const mutateAsync = async (input: TInput) => {
    setState({ isPending: true, error: undefined });
    try {
      const result = await mutationFn(input);
      setState({ isPending: false, error: undefined });
      invalidate.forEach((key) => invalidateQueries(key));
      onSuccess?.(result, input);
      return result;
    } catch (error) {
      setState({ isPending: false, error });
      onError?.(error, input);
      throw error;
    }
  };

  const mutate = (input: TInput) => {
    mutateAsync(input).catch(() => {
      /* surfaced through state / onError */
    });
  };

  return { mutate, mutateAsync, ...state };
}
