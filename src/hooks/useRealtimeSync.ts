import { useEffect } from 'react';

import { invalidateQueries, type QueryKey } from '@/lib/query';
import { realtime, type RealtimeChannel } from '@/services';

import { queryKeys } from './queryKeys';

const channelKeys: Record<RealtimeChannel, QueryKey[]> = {
  orders: [queryKeys.orders.all, queryKeys.dashboard.all],
  payments: [queryKeys.payments.all, queryKeys.dashboard.all],
  tasks: [queryKeys.automation.all],
  devices: [queryKeys.devices.all],
  sims: [queryKeys.sims.all],
  products: [queryKeys.products.all],
  notifications: [queryKeys.notifications.all],
  whatsapp: [queryKeys.whatsapp.all],
  automation: [queryKeys.automation.all],
};

/** Keeps cached queries fresh when the backend reports changes. Mount once. */
export function useRealtimeSync() {
  useEffect(
    () =>
      realtime.subscribe((channel) => {
        channelKeys[channel].forEach((key) => invalidateQueries(key));
      }),
    []
  );
}
