import { useMutation, useQuery } from '@/lib/query';
import { api } from '@/services';
import type { AuditLogQuery, ID, PlatformTenantListParams } from '@/types';

import { queryKeys } from './queryKeys';

/*
 * Platform administration (MegaBot staff). Screens gate their UI with
 * `hasPlatformPermission(context, …)`; the backend authorizes every call again.
 */

export function usePlatformAdminContext() {
  return useQuery(queryKeys.platform.context(), () => api.platformAdmin.getPlatformAdminContext());
}

export function usePlatformTenants(params: PlatformTenantListParams = {}, { enabled = true } = {}) {
  return useQuery(queryKeys.platform.tenants(params), () => api.platformAdmin.listTenants(params), {
    enabled,
    keepPreviousData: true,
  });
}

export function usePlatformTenant(id: ID) {
  return useQuery(queryKeys.platform.tenant(id), () => api.platformAdmin.getTenant(id));
}

type TenantStatusChange = { id: ID; reason?: string };

const statusChangeInvalidates = [queryKeys.platform.tenantsAll, queryKeys.platform.auditLogsAll];

export function useSuspendTenant() {
  return useMutation(({ id, reason }: TenantStatusChange) => api.platformAdmin.suspendTenant(id, { reason }), {
    invalidate: statusChangeInvalidates,
  });
}

export function useReactivateTenant() {
  return useMutation(({ id, reason }: TenantStatusChange) => api.platformAdmin.reactivateTenant(id, { reason }), {
    invalidate: statusChangeInvalidates,
  });
}

export function usePlatformTenantProducts(tenantId: ID) {
  return useQuery(queryKeys.platform.tenantProducts(tenantId), () => api.platformAdmin.listTenantProducts(tenantId));
}

/** Read-only, explicit platform RPC (permission tenants.read) — never the tenant tables directly. */
export function usePlatformTenantDevices(tenantId: ID) {
  return useQuery(queryKeys.platform.tenantDevices(tenantId), () => api.platformAdmin.listTenantDevices(tenantId));
}

export function usePlatformTenantActivationTasks(tenantId: ID) {
  return useQuery(queryKeys.platform.tenantTasks(tenantId), () => api.platformAdmin.listTenantActivationTasks(tenantId));
}

export function useAuditLogs(query: AuditLogQuery = {}, { enabled = true } = {}) {
  return useQuery(queryKeys.platform.auditLogs(query), () => api.platformAdmin.getAuditLogs(query), { enabled });
}
