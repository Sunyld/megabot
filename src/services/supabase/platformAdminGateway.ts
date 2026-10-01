/**
 * Thin adapter between the platform admin service and supabase-js. It only
 * calls the platform_* RPCs / audit_logs and forwards raw rows and errors;
 * mapping, validation and messages live in platformAdmin.ts, which is tested
 * against a fake gateway.
 *
 * Authorization is entirely server-side (migration 002): the RPCs check the
 * caller's platform permission and audit_logs is filtered by RLS.
 */
import type { Database, MegabotSupabaseClient } from '@/lib/supabase';
import type { TenantStatus } from '@/types';

import type { NormalizedAuditLogQuery, NormalizedTenantListParams } from '../platformAdmin';

type Functions = Database['public']['Functions'];

export type PlatformAdminContextRow = Functions['platform_admin_context']['Returns'][number];
export type PlatformTenantRow = Functions['platform_list_tenants']['Returns'][number];
export type AuditLogRow = Database['public']['Tables']['audit_logs']['Row'];

export interface PlatformAdminGateway {
  /** 0 rows for non-admins, 1 row otherwise. */
  fetchContext(): Promise<PlatformAdminContextRow[]>;
  listTenants(params: NormalizedTenantListParams): Promise<PlatformTenantRow[]>;
  getTenant(id: string): Promise<PlatformTenantRow[]>;
  setTenantStatus(id: string, status: TenantStatus, reason: string | null): Promise<PlatformTenantRow[]>;
  /** Rows allowed by RLS (none for non-admins), newest first. */
  listAuditLogs(query: NormalizedAuditLogQuery): Promise<AuditLogRow[]>;
}

const AUDIT_LOG_COLUMNS =
  'id, actor_user_id, tenant_id, action, resource_type, resource_id, metadata, ip_address, user_agent, created_at';

export function createPlatformAdminGateway(getClient: () => MegabotSupabaseClient): PlatformAdminGateway {
  return {
    async fetchContext() {
      const { data, error } = await getClient().rpc('platform_admin_context');
      if (error) throw error;
      return data ?? [];
    },

    async listTenants({ status, search, limit, offset }) {
      const { data, error } = await getClient().rpc('platform_list_tenants', {
        p_limit: limit,
        p_offset: offset,
        ...(status ? { p_status: status } : {}),
        ...(search ? { p_search: search } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },

    async getTenant(id) {
      const { data, error } = await getClient().rpc('platform_get_tenant', { p_tenant_id: id });
      if (error) throw error;
      return data ?? [];
    },

    async setTenantStatus(id, status, reason) {
      const { data, error } = await getClient().rpc('platform_set_tenant_status', {
        p_tenant_id: id,
        p_status: status,
        ...(reason ? { p_reason: reason } : {}),
      });
      if (error) throw error;
      return data ?? [];
    },

    async listAuditLogs(query) {
      let request = getClient()
        .from('audit_logs')
        .select(AUDIT_LOG_COLUMNS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(query.limit);
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId);
      if (query.action) request = request.eq('action', query.action);
      if (query.resourceType) request = request.eq('resource_type', query.resourceType);
      if (query.resourceId) request = request.eq('resource_id', query.resourceId);
      if (query.before) request = request.lt('created_at', query.before);

      const { data, error } = await request;
      if (error) throw error;
      return data;
    },
  };
}
