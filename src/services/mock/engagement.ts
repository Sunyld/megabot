import { isSameDay } from '@/utils/format';

import type { AutomationService, NotificationsService, WhatsAppService } from '../types';
import { db, notFound, ownedBy, request } from './db';

export const mockNotificationsService: NotificationsService = {
  list: () =>
    request(
      (tenantId) =>
        db.notifications.filter(ownedBy(tenantId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      { list: true }
    ),

  markRead: (id) =>
    request((tenantId) => {
      const notification = db.notifications.filter(ownedBy(tenantId)).find((n) => n.id === id);
      if (notification) notification.read = true;
    }),

  markAllRead: () =>
    request((tenantId) => {
      db.notifications.filter(ownedBy(tenantId)).forEach((n) => {
        n.read = true;
      });
    }),
};

export const mockWhatsAppService: WhatsAppService = {
  getConnection: () =>
    request((tenantId) => {
      if (db.whatsapp.tenantId !== tenantId) notFound('Ligação WhatsApp');
      return {
        ...db.whatsapp,
        groupsMonitored: db.groups.filter(ownedBy(tenantId)).filter((g) => g.monitored).length,
      };
    }),

  listGroups: () => request((tenantId) => db.groups.filter(ownedBy(tenantId)), { list: true }),

  setGroupMonitored: (id, monitored) =>
    request((tenantId) => {
      const group = db.groups.filter(ownedBy(tenantId)).find((g) => g.id === id) ?? notFound('Grupo');
      group.monitored = monitored;
      return group;
    }),

  listConversations: () => request((tenantId) => db.conversations.filter(ownedBy(tenantId)), { list: true }),

  getConversation: (id) =>
    request((tenantId) => {
      const conversation =
        db.conversations.filter(ownedBy(tenantId)).find((c) => c.id === id) ?? notFound('Conversa');
      conversation.unread = 0;
      return conversation;
    }),
};

export const mockAutomationService: AutomationService = {
  getSettings: () => request(() => db.automation),

  updateSettings: (patch) =>
    request(() => {
      Object.assign(db.automation, patch);
      return db.automation;
    }),

  getStats: () =>
    request((tenantId) => {
      const today = db.tasks.filter(ownedBy(tenantId)).filter((t) => isSameDay(t.createdAt, Date.now()));
      const success = today.filter((t) => t.status === 'SUCCESS');
      const finished = today.filter((t) => t.status === 'SUCCESS' || t.status === 'FAILED');
      const durations = success
        .map((t) => t.attempts.find((a) => a.result === 'success')?.durationMs ?? 0)
        .filter(Boolean);
      return {
        tasksToday: today.length,
        successRate: finished.length ? success.length / finished.length : 1,
        avgActivationSeconds: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length / 1000 : 0,
        failoversToday: today.filter((t) => t.attempts.some((a) => a.result.startsWith('skipped'))).length,
        unknownToday: today.filter((t) => t.status === 'UNKNOWN' || t.status === 'VERIFYING').length,
      };
    }),

  listTasks: () => request((tenantId) => db.tasks.filter(ownedBy(tenantId)), { list: true }),

  getTask: (id) =>
    request((tenantId) => db.tasks.filter(ownedBy(tenantId)).find((t) => t.id === id) ?? notFound('Tarefa')),
};
