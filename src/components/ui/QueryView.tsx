import type { ReactNode } from 'react';

import type { UseQueryResult } from '@/lib/query';

import { ErrorState } from './States';

export type QueryViewProps<T> = {
  query: UseQueryResult<T>;
  /** Skeleton shown on first load. */
  loading: ReactNode;
  /** Returns true when the data should render the empty state. */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
};

/**
 * Renders the right state for a query — loading, error (incl. offline),
 * empty or success — so every screen handles all of them consistently.
 */
export function QueryView<T>({ query, loading, isEmpty, empty, children }: QueryViewProps<T>) {
  if (query.data === undefined) {
    if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
    return <>{loading}</>;
  }
  if (isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
