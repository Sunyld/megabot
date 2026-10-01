import type { Session, Tenant, User } from '@/types';

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

/** Demo session; sign-up passes the typed names so the UI reflects them. */
export function createMockSession(overrides: { name?: string; email?: string; businessName?: string } = {}): Session {
  return {
    user: { ...mockUser, name: overrides.name ?? mockUser.name, email: overrides.email ?? mockUser.email },
    tenant: { ...mockTenant, name: overrides.businessName ?? mockTenant.name },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
  };
}
