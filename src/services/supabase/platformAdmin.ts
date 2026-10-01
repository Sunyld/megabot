/**
 * Platform administration on Supabase (migration 002): maps RPC / table rows
 * to domain types and Supabase errors to AppErrors. No authorization decision
 * is made here — the database checks every call; unexpected values from the
 * backend fail closed (no access, tenant treated as suspended).
 */
import type { Json } from '@/lib/supabase';
import type {
  AuditLogEntry,
  ID,
  JsonObject,
  JsonValue,
  PlatformAdminContext,
  PlatformAdminRole,
  PlatformAdminStatus,
  PlatformPermission,
  PlatformTenant,
  TenantStatus,
  TenantStatusChangeInput,
} from '@/types';

import type { AppError } from '../errors';
import {
  noPlatformAccess,
  normalizeAuditLogQuery,
  normalizeReason,
  normalizeTenantListParams,
  platformAccessDenied,
  tenantNotFound,
  tenantStatusConflict,
} from '../platformAdmin';
import type { PlatformAdminService } from '../types';
import { toAppError } from './errors';
import type { AuditLogRow, PlatformAdminContextRow, PlatformAdminGateway, PlatformTenantRow } from './platformAdminGateway';
import { toProduct } from './products';
import { DEFAULT_TENANT_SETTINGS, isTenantStatus } from './tenancy';

const PLATFORM_PERMISSIONS: readonly string[] = [
  'tenants.read',
  'tenants.suspend',
  'audit_logs.read',
  'platform_admins.read',
] satisfies PlatformPermission[];

const isPlatformPermission = (value: string): value is PlatformPermission => PLATFORM_PERMISSIONS.includes(value);

const isPlatformAdminRole = (value: string): value is PlatformAdminRole =>
  value === 'SUPER_ADMIN' || value === 'SUPPORT_ADMIN';

const isPlatformAdminStatus = (value: string): value is PlatformAdminStatus =>
  value === 'ACTIVE' || value === 'SUSPENDED';

/** Unknown roles or statuses mean no access (fail closed). */
export function toPlatformAdminContext(rows: PlatformAdminContextRow[]): PlatformAdminContext {
  const row = rows[0];
  if (!row || !isPlatformAdminRole(row.role) || !isPlatformAdminStatus(row.status)) return noPlatformAccess();
  const active = row.status === 'ACTIVE';
  return {
    isPlatformAdmin: active,
    role: row.role,
    status: row.status,
    permissions: active ? (row.permissions ?? []).filter(isPlatformPermission) : [],
  };
}

export function toPlatformTenant(row: PlatformTenantRow): PlatformTenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    // Unknown statuses are treated as suspended: fail closed.
    status: isTenantStatus(row.status) ? row.status : 'suspended',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currency: row.currency ?? DEFAULT_TENANT_SETTINGS.currency,
    timezone: row.timezone ?? DEFAULT_TENANT_SETTINGS.timezone,
    locale: row.locale ?? DEFAULT_TENANT_SETTINGS.locale,
    members: {
      total: row.member_count,
      owners: row.owner_count,
      admins: row.admin_count,
      operators: row.operator_count,
    },
  };
}

function toJsonValue(value: Json | undefined): JsonValue {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === 'object') return toJsonObject(value);
  return value;
}

function toJsonObject(value: Json): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = toJsonValue(item);
  }
  return result;
}

export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    tenantId: row.tenant_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: toJsonObject(row.metadata),
    ipAddress: typeof row.ip_address === 'string' ? row.ip_address : null,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

/**
 * Database errors → platform messages: 42501 (not a platform admin / missing
 * permission), P0002 (unknown tenant), 55000 (already in the target status).
 */
function toPlatformError(error: unknown, options: { tenant?: boolean; target?: TenantStatus } = {}): AppError {
  const appError = toAppError(error);
  switch (appError.code) {
    case 'PERMISSION_DENIED':
      return platformAccessDenied(appError.detail);
    case 'NOT_FOUND':
      return options.tenant ? tenantNotFound(appError.detail) : appError;
    case 'CONFLICT':
      return options.target ? tenantStatusConflict(options.target, appError.detail) : appError;
    default:
      return appError;
  }
}

export function createSupabasePlatformAdminService(gateway: PlatformAdminGateway): PlatformAdminService {
  async function changeStatus(id: ID, target: TenantStatus, input: TenantStatusChangeInput | undefined) {
    const reason = normalizeReason(input?.reason);
    try {
      const [row] = await gateway.setTenantStatus(id, target, reason);
      if (!row) throw tenantNotFound();
      return toPlatformTenant(row);
    } catch (error) {
      throw toPlatformError(error, { tenant: true, target });
    }
  }

  return {
    async getPlatformAdminContext() {
      try {
        return toPlatformAdminContext(await gateway.fetchContext());
      } catch (error) {
        throw toPlatformError(error);
      }
    },

    async listTenants(params) {
      const normalized = normalizeTenantListParams(params);
      try {
        return (await gateway.listTenants(normalized)).map(toPlatformTenant);
      } catch (error) {
        throw toPlatformError(error);
      }
    },

    async getTenant(id) {
      try {
        const [row] = await gateway.getTenant(id);
        if (!row) throw tenantNotFound();
        return toPlatformTenant(row);
      } catch (error) {
        throw toPlatformError(error, { tenant: true });
      }
    },

    suspendTenant: (id, input) => changeStatus(id, 'suspended', input),

    reactivateTenant: (id, input) => changeStatus(id, 'active', input),

    async getAuditLogs(query) {
      const normalized = normalizeAuditLogQuery(query);
      try {
        return (await gateway.listAuditLogs(normalized)).map(toAuditLogEntry);
      } catch (error) {
        throw toPlatformError(error);
      }
    },

    async listTenantProducts(tenantId) {
      try {
        return (await gateway.listTenantProducts(tenantId)).map(toProduct);
      } catch (error) {
        throw toPlatformError(error, { tenant: true });
      }
    },
  };
}
