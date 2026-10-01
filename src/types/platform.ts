import type { ID, ISODateString, JsonObject } from './common';
import type { TenantStatus } from './session';

/*
 * Platform administration — MegaBot staff, a layer above tenants.
 *
 * Authorization chain: user → platform admin? → tenant membership → tenant role.
 * Platform access comes only from public.platform_admins (migration 002); a
 * tenant `owner`/`admin` is never a platform admin.
 */

/** Mirrors platform_admins.role. */
export type PlatformAdminRole = 'SUPER_ADMIN' | 'SUPPORT_ADMIN';

/** Mirrors platform_admins.status. */
export type PlatformAdminStatus = 'ACTIVE' | 'SUSPENDED';

/** Mirrors private.platform_role_permissions() (migration 002). */
export type PlatformPermission = 'tenants.read' | 'tenants.suspend' | 'audit_logs.read' | 'platform_admins.read';

/**
 * The signed-in user's platform access, as computed by the backend. The app
 * never derives it from email, user id or tenant role, and only uses it to
 * adapt the UI — the database authorizes every platform operation again.
 */
export type PlatformAdminContext = {
  /** True only for an ACTIVE platform admin. */
  isPlatformAdmin: boolean;
  role: PlatformAdminRole | null;
  status: PlatformAdminStatus | null;
  /** Empty unless ACTIVE. */
  permissions: PlatformPermission[];
};

export type TenantMemberCounts = {
  total: number;
  owners: number;
  admins: number;
  operators: number;
};

/** A tenant as seen by platform admins (cross-tenant, read-only overview). */
export type PlatformTenant = {
  id: ID;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  currency: string;
  timezone: string;
  locale: string;
  members: TenantMemberCounts;
};

export type PlatformTenantListParams = {
  status?: TenantStatus;
  /** Matches name or slug (literal, case-insensitive). */
  search?: string;
  limit?: number;
  offset?: number;
};

export type TenantStatusChangeInput = {
  /** Optional note stored in the audit log (max 500 chars). Never put secrets here. */
  reason?: string;
};

/** Actions written by migration 002. Stored as text, so new actions need no migration. */
export type KnownAuditAction =
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'platform_admin.granted'
  | 'platform_admin.revoked'
  | 'platform_admin.suspended'
  | 'platform_admin.reactivated'
  | 'platform_admin.role_changed'
  | 'platform_admin.updated';

/** One entry of the append-only audit trail (public.audit_logs). */
export type AuditLogEntry = {
  id: ID;
  /** `null` for system actions (database owner, migrations, jobs). */
  actorUserId: ID | null;
  tenantId: ID | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: JsonObject;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: ISODateString;
};

export type AuditLogQuery = {
  tenantId?: ID;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /** Only entries strictly older than this timestamp (pagination cursor). */
  before?: ISODateString;
  limit?: number;
};
