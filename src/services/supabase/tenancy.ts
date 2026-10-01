/**
 * Pure tenant-resolution logic (no network): which membership becomes the
 * session's tenant, and how database rows map to domain types.
 *
 * Isolation itself is enforced by RLS in the database (auth.uid() →
 * tenant_users); this only chooses among the memberships the database already
 * allowed the user to see. The resulting tenant id is a convenience for the UI,
 * never a security boundary.
 */
import type { Tenant, TenantStatus, User, UserRole } from '@/types';

export type MembershipRecord = {
  role: string;
  created_at: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    settings: { currency: string; timezone: string; locale: string } | null;
  } | null;
};

export type ResolvedMembership = { role: UserRole; tenant: Tenant };

const ROLE_RANK: Record<UserRole, number> = { owner: 0, admin: 1, operator: 2 };

export const isUserRole = (value: string): value is UserRole =>
  value === 'owner' || value === 'admin' || value === 'operator';

export const isTenantStatus = (value: string): value is TenantStatus =>
  value === 'active' || value === 'suspended';

/** Same defaults as tenant_settings (migration 001). */
export const DEFAULT_TENANT_SETTINGS = { currency: 'MZN', timezone: 'Africa/Maputo', locale: 'pt-MZ' } as const;

export function toTenant(record: NonNullable<MembershipRecord['tenant']>): Tenant {
  const settings = record.settings ?? DEFAULT_TENANT_SETTINGS;
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    // Unknown statuses are treated as suspended: fail closed.
    status: isTenantStatus(record.status) ? record.status : 'suspended',
    plan: null,
    currency: settings.currency,
    timezone: settings.timezone,
    locale: settings.locale,
  };
}

/**
 * Picks the tenant the app opens:
 *  1. active tenants first — highest role (owner > admin > operator), then oldest membership;
 *  2. otherwise a suspended tenant (the app then shows the suspended state);
 *  3. `null` when the user belongs to no tenant.
 */
export function selectMembership(records: MembershipRecord[]): ResolvedMembership | null {
  const candidates = records
    .flatMap((record) => {
      if (!record.tenant || !isUserRole(record.role)) return [];
      return [{ role: record.role, createdAt: record.created_at, tenant: toTenant(record.tenant) }];
    })
    .sort(
      (a, b) =>
        Number(a.tenant.status === 'suspended') - Number(b.tenant.status === 'suspended') ||
        ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
        a.createdAt.localeCompare(b.createdAt)
    );

  const best = candidates[0];
  return best ? { role: best.role, tenant: best.tenant } : null;
}

export type AuthUserLike = {
  id: string;
  email?: string | null;
  phone?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

const metadataText = (user: AuthUserLike, key: string): string => {
  const value = user.user_metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

export function toSessionUser(user: AuthUserLike, role: UserRole): User {
  const email = user.email ?? '';
  return {
    id: user.id,
    name: metadataText(user, 'name') || email.split('@')[0] || 'Vendedor',
    email,
    phone: user.phone ?? '',
    role,
  };
}

/** Display name stored at sign-up (user_metadata.name), if any. */
export function readDisplayName(user: AuthUserLike): string | null {
  return metadataText(user, 'name') || null;
}
