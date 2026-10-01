/**
 * Change notifications from the backend. The mock backend emits here when
 * something changes in the background (an activation finishing, etc.); with
 * Supabase this will be backed by Realtime channels on the same table names.
 */
export type RealtimeChannel =
  | 'orders'
  | 'payments'
  | 'tasks'
  | 'devices'
  | 'sims'
  | 'products'
  | 'notifications'
  | 'whatsapp'
  | 'automation';

type Listener = (channel: RealtimeChannel) => void;

const listeners = new Set<Listener>();

export const realtime = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  emit(...channels: RealtimeChannel[]) {
    channels.forEach((channel) => listeners.forEach((listener) => listener(channel)));
  },
};
