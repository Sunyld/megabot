import type { ID } from '@/types';

/**
 * Request context shared by all services (the tenant of the signed-in user).
 * Set by the session layer on sign-in / sign-out. With Supabase this becomes
 * the JWT claim that Row Level Security checks.
 */
let currentTenantId: ID | null = null;

export const serviceContext = {
  setTenant(id: ID | null) {
    currentTenantId = id;
  },
  getTenant(): ID | null {
    return currentTenantId;
  },
};
