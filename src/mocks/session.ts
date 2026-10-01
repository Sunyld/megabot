import type { PlatformSession, SessionUser, Tenant, TenantSession, User } from '@/types';

import { TENANT_ID } from './helpers';

export const mockTenant: Tenant = {
  id: TENANT_ID,
  name: 'MegaBot Demo',
  slug: 'megabot-demo',
  status: 'active',
  plan: 'pro',
  currency: 'MZN',
  timezone: 'Africa/Maputo',
  locale: 'pt-MZ',
};

export const mockUser: User = {
  id: 'usr_01',
  name: 'Carlos Mabunda',
  email: 'demo@megabot.app',
  phone: '+258 84 555 0218',
  role: 'owner',
};

export const DEMO_CREDENTIALS = { email: 'demo@megabot.app', password: 'megabot' };

/** Demo platform admin (SUPER_ADMIN) with no tenant — mock mode only. */
export const DEMO_PLATFORM_CREDENTIALS = { email: 'admin@megabot.app', password: 'megabot' };

export const mockPlatformUser: SessionUser = {
  id: 'usr_platform_01',
  name: 'Equipa MegaBot',
  email: DEMO_PLATFORM_CREDENTIALS.email,
  phone: '',
};

const weekFromNow = () => new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

/** Demo session; sign-up passes the typed names so the UI reflects them. */
export function createMockSession(overrides: { name?: string; email?: string; businessName?: string } = {}): TenantSession {
  return {
    kind: 'tenant',
    user: { ...mockUser, name: overrides.name ?? mockUser.name, email: overrides.email ?? mockUser.email },
    tenant: { ...mockTenant, name: overrides.businessName ?? mockTenant.name },
    platformAdmin: null,
    expiresAt: weekFromNow(),
  };
}

export function createMockPlatformSession(): PlatformSession {
  return {
    kind: 'platform',
    user: mockPlatformUser,
    tenant: null,
    platformAdmin: {
      isPlatformAdmin: true,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      permissions: ['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read'],
    },
    expiresAt: weekFromNow(),
  };
}
