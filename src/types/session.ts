import type { ID, ISODateString } from './common';
import type { PlatformAdminContext } from './platform';

/** Mirrors tenant_users.role. */
export type UserRole = 'owner' | 'admin' | 'operator';

/** The authenticated person, independent of any tenant. */
export type SessionUser = {
  id: ID;
  name: string;
  email: string;
  phone: string;
};

/** A tenant member: the person plus their role in the active tenant. */
export type User = SessionUser & {
  /** Role in the active tenant. */
  role: UserRole;
};

/** Mirrors tenants.status. */
export type TenantStatus = 'active' | 'suspended';

export type TenantPlan = 'starter' | 'pro' | 'business';

export type Tenant = {
  id: ID;
  name: string;
  slug: string;
  status: TenantStatus;
  /** Subscription plan — `null` until billing exists (later phase). */
  plan: TenantPlan | null;
  /** From tenant_settings. */
  currency: string;
  timezone: string;
  locale: string;
};

/**
 * Tenant app: who (user + role in the tenant), where (tenant + its settings)
 * and until when. Tokens stay inside the auth client's storage and are
 * deliberately not copied into app state.
 */
export type TenantSession = {
  kind: 'tenant';
  user: User;
  tenant: Tenant;
  platformAdmin: null;
  expiresAt: ISODateString;
};

/**
 * Platform area: an ACTIVE platform admin (platform_admins), who may belong to
 * no tenant at all. Never derived from tenant roles.
 */
export type PlatformSession = {
  kind: 'platform';
  user: SessionUser;
  tenant: null;
  platformAdmin: PlatformAdminContext;
  expiresAt: ISODateString;
};

/** The signed-in context. Exactly one of: tenant app or platform area. */
export type Session = TenantSession | PlatformSession;

export type SignInCredentials = {
  email: string;
  password: string;
};

export type SignUpInput = {
  name: string;
  /** Creates the seller's tenant together with the account. */
  businessName: string;
  email: string;
  password: string;
};
