import type { ID, ISODateString } from './common';

/** Mirrors tenant_users.role. */
export type UserRole = 'owner' | 'admin' | 'operator';

export type User = {
  id: ID;
  name: string;
  email: string;
  phone: string;
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
 * The signed-in context the app runs with: who (user + role in the tenant),
 * where (tenant + its settings) and until when. Tokens stay inside the auth
 * client's storage and are deliberately not copied into app state.
 */
export type Session = {
  user: User;
  tenant: Tenant;
  expiresAt: ISODateString;
};

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
