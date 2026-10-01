import { TENANT_ID } from '@/mocks';
import type { AutomationSettings } from '@/types';
import { isSameDay } from '@/utils/format';

import { AppError } from '../errors';
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

/** What a real tenant sees until automation exists on the backend: everything off. */
const AUTOMATION_OFF: AutomationSettings = {
  enabled: false,
  autoOrders: false,
  autoConfirm: false,
  autoUssd: false,
  failover: false,
  smsMonitoring: false,
};

export const mockAutomationService: AutomationService = {
  getSettings: () => request((tenantId) => (tenantId === TENANT_ID ? db.automation : AUTOMATION_OFF)),

  updateSettings: (patch) =>
    request((tenantId) => {
      if (tenantId !== TENANT_ID) {
        throw new AppError('CONFLICT', 'A automação fica disponível numa próxima fase.', { reason: 'FEATURE_NOT_AVAILABLE' });
      }
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
