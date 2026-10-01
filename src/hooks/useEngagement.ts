import { setQueryData, useMutation, useQuery } from '@/lib/query';
import { api } from '@/services';
import type { AppNotification, AutomationSettings, ID } from '@/types';

import { queryKeys } from './queryKeys';

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function useDashboard() {
  return useQuery(queryKeys.dashboard.summary(), () => api.dashboard.getSummary());
}

export function useActivity() {
  return useQuery(queryKeys.dashboard.activity(), () => api.dashboard.listActivity(8));
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery(queryKeys.notifications.list(), () => api.notifications.list());
}

export function useUnreadCount() {
  const { data } = useNotifications();
  return data?.filter((n) => !n.read).length ?? 0;
}

const markLocally = (predicate: (n: AppNotification) => boolean) =>
  setQueryData<AppNotification[]>(queryKeys.notifications.list(), (list) =>
    list?.map((n) => (predicate(n) ? { ...n, read: true } : n))
  );

export function useMarkNotificationRead() {
  return useMutation(
    (id: ID) => {
      markLocally((n) => n.id === id);
      return api.notifications.markRead(id);
    },
    { invalidate: [queryKeys.notifications.all] }
  );
}

export function useMarkAllNotificationsRead() {
  return useMutation(
    () => {
      markLocally(() => true);
      return api.notifications.markAllRead();
    },
    { invalidate: [queryKeys.notifications.all] }
  );
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

export function useWhatsAppConnection() {
  return useQuery(queryKeys.whatsapp.connection(), () => api.whatsapp.getConnection());
}

export function useWhatsAppGroups() {
  return useQuery(queryKeys.whatsapp.groups(), () => api.whatsapp.listGroups());
}

export function useSetGroupMonitored() {
  return useMutation(
    ({ id, monitored }: { id: ID; monitored: boolean }) => api.whatsapp.setGroupMonitored(id, monitored),
    { invalidate: [queryKeys.whatsapp.all] }
  );
}

export function useConversations() {
  return useQuery(queryKeys.whatsapp.conversations(), () => api.whatsapp.listConversations());
}

export function useConversation(id: ID) {
  return useQuery(queryKeys.whatsapp.conversation(id), () => api.whatsapp.getConversation(id));
}

// ─── Automation ──────────────────────────────────────────────────────────────

export function useAutomationSettings() {
  return useQuery(queryKeys.automation.settings(), () => api.automation.getSettings());
}

export function useUpdateAutomationSettings() {
  return useMutation(
    (patch: Partial<AutomationSettings>) => {
      // Optimistic: switches must feel instant.
      setQueryData<AutomationSettings>(queryKeys.automation.settings(), (current) =>
        current ? { ...current, ...patch } : current
      );
      return api.automation.updateSettings(patch);
    },
    { invalidate: [queryKeys.automation.all, queryKeys.dashboard.all] }
  );
}

export function useAutomationStats() {
  return useQuery(queryKeys.automation.stats(), () => api.automation.getStats());
}

export function useTasks() {
  return useQuery(queryKeys.automation.tasks(), () => api.automation.listTasks());
}

export function useTask(id: ID) {
  return useQuery(queryKeys.automation.task(id), () => api.automation.getTask(id), { enabled: Boolean(id) });
}
