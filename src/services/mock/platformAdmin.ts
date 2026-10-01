import { mockAuditLogs, mockPlatformTenants, mockUser } from '@/mocks';
import type {
  ID,
  PlatformAdminContext,
  PlatformAdminRole,
  PlatformAdminStatus,
  PlatformPermission,
  TenantStatus,
} from '@/types';

import {
  hasPlatformPermission,
  noPlatformAccess,
  normalizeAuditLogQuery,
  normalizeReason,
  normalizeTenantListParams,
  platformAccessDenied,
  tenantNotFound,
  tenantStatusConflict,
} from '../platformAdmin';
import type { PlatformAdminService } from '../types';
import { request } from './db';

/** Mirrors private.platform_role_permissions() (migration 002). */
const ROLE_PERMISSIONS: Record<PlatformAdminRole, PlatformPermission[]> = {
  SUPER_ADMIN: ['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read'],
  SUPPORT_ADMIN: ['tenants.read', 'tenants.suspend', 'audit_logs.read'],
};

export type MockPlatformAdminOptions = {
  /** `null` — the demo user is not a platform admin. */
  role: PlatformAdminRole | null;
  status?: PlatformAdminStatus;
  actorUserId?: ID;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * In-memory platform administration with the same rules as the database:
 * permission checked on every call, transitions validated, every status
 * change appended to the audit trail.
 */
export function createMockPlatformAdminService({
  role,
  status = 'ACTIVE',
  actorUserId = mockUser.id,
}: MockPlatformAdminOptions): PlatformAdminService {
  const tenants = clone(mockPlatformTenants);
  const auditLogs = clone(mockAuditLogs);
  let sequence = auditLogs.length;

  const context: PlatformAdminContext = role
    ? {
        isPlatformAdmin: status === 'ACTIVE',
        role,
        status,
        permissions: status === 'ACTIVE' ? [...ROLE_PERMISSIONS[role]] : [],
      }
    : noPlatformAccess();

  const authorize = (permission: PlatformPermission) => {
    if (!hasPlatformPermission(context, permission)) throw platformAccessDenied();
  };

  const findTenant = (id: ID) => {
    const tenant = tenants.find((candidate) => candidate.id === id);
    if (!tenant) throw tenantNotFound();
    return tenant;
  };

  async function setStatus(id: ID, target: TenantStatus, reasonInput: string | undefined) {
    const reason = normalizeReason(reasonInput);
    return request(() => {
      authorize('tenants.suspend');
      const tenant = findTenant(id);
      if (tenant.status === target) throw tenantStatusConflict(target);

      const previous = tenant.status;
      const now = new Date().toISOString();
      tenant.status = target;
      tenant.updatedAt = now;

      sequence += 1;
      auditLogs.unshift({
        id: `aud_${String(sequence).padStart(3, '0')}`,
        actorUserId,
        tenantId: id,
        action: target === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
        resourceType: 'tenant',
        resourceId: id,
        metadata: reason
          ? { previous_status: previous, status: target, reason }
          : { previous_status: previous, status: target },
        ipAddress: null,
        userAgent: null,
        createdAt: now,
      });
      return tenant;
    });
  }

  return {
    getPlatformAdminContext: () => request(() => context),

    async listTenants(params) {
      const { status: wanted, search, limit, offset } = normalizeTenantListParams(params);
      const needle = search?.toLowerCase();
      return request(
        () => {
          authorize('tenants.read');
          return tenants
            .filter(
              (tenant) =>
                (!wanted || tenant.status === wanted) &&
                (!needle || tenant.name.toLowerCase().includes(needle) || tenant.slug.includes(needle))
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(offset, offset + limit);
        },
        { list: true }
      );
    },

    getTenant: (id) =>
      request(() => {
        authorize('tenants.read');
        return findTenant(id);
      }),

    suspendTenant: (id, input) => setStatus(id, 'suspended', input?.reason),

    reactivateTenant: (id, input) => setStatus(id, 'active', input?.reason),

    async getAuditLogs(query) {
      const q = normalizeAuditLogQuery(query);
      return request(
        () => {
          // Like RLS on audit_logs: no error, just no rows for non-admins.
          if (!hasPlatformPermission(context, 'audit_logs.read')) return [];
          return auditLogs
            .filter(
              (entry) =>
                (!q.tenantId || entry.tenantId === q.tenantId) &&
                (!q.action || entry.action === q.action) &&
                (!q.resourceType || entry.resourceType === q.resourceType) &&
                (!q.resourceId || entry.resourceId === q.resourceId) &&
                (!q.before || entry.createdAt < q.before)
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, q.limit);
        },
        { list: true }
      );
    },
  };
}

/** Demo mode: the demo user is a SUPER_ADMIN so platform screens can be showcased. */
export const mockPlatformAdminService = createMockPlatformAdminService({ role: 'SUPER_ADMIN' });
