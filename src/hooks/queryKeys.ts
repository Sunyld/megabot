import type { OrderListParams, PaymentListParams } from '@/services';
import type { AuditLogQuery, ID, PlatformTenantListParams } from '@/types';

/** Centralized query keys — prefixes are used for invalidation. */
export const queryKeys = {
  dashboard: {
    all: ['dashboard'] as const,
    summary: () => ['dashboard', 'summary'] as const,
    activity: () => ['dashboard', 'activity'] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (params: OrderListParams) => ['orders', 'list', params] as const,
    counts: () => ['orders', 'counts'] as const,
    detail: (id: ID) => ['orders', 'detail', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (params: PaymentListParams) => ['payments', 'list', params] as const,
    summary: () => ['payments', 'summary'] as const,
    accounts: () => ['payments', 'accounts'] as const,
    detail: (id: ID) => ['payments', 'detail', id] as const,
  },
  products: {
    all: ['products'] as const,
    list: () => ['products', 'list'] as const,
    detail: (id: ID) => ['products', 'detail', id] as const,
  },
  devices: {
    all: ['devices'] as const,
    list: () => ['devices', 'list'] as const,
    summary: () => ['devices', 'summary'] as const,
    detail: (id: ID) => ['devices', 'detail', id] as const,
  },
  sims: {
    all: ['sims'] as const,
    list: (deviceId?: ID) => ['sims', 'list', deviceId ?? null] as const,
    detail: (id: ID) => ['sims', 'detail', id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: () => ['notifications', 'list'] as const,
  },
  whatsapp: {
    all: ['whatsapp'] as const,
    connection: () => ['whatsapp', 'connection'] as const,
    groups: () => ['whatsapp', 'groups'] as const,
    conversations: () => ['whatsapp', 'conversations'] as const,
    conversation: (id: ID) => ['whatsapp', 'conversation', id] as const,
  },
  automation: {
    all: ['automation'] as const,
    settings: () => ['automation', 'settings'] as const,
    stats: () => ['automation', 'stats'] as const,
    tasks: () => ['automation', 'tasks'] as const,
    task: (id: ID) => ['automation', 'task', id] as const,
  },
  platform: {
    all: ['platform'] as const,
    context: () => ['platform', 'context'] as const,
    tenantsAll: ['platform', 'tenants'] as const,
    tenants: (params: PlatformTenantListParams) => ['platform', 'tenants', 'list', params] as const,
    tenant: (id: ID) => ['platform', 'tenants', 'detail', id] as const,
    auditLogsAll: ['platform', 'auditLogs'] as const,
    auditLogs: (query: AuditLogQuery) => ['platform', 'auditLogs', query] as const,
  },
};
