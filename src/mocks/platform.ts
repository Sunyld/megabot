import type { AuditLogEntry, PlatformTenant } from '@/types';

import { ago, TENANT_ID } from './helpers';
import { mockTenant, mockUser } from './session';

/**
 * Demo data for the platform administration layer (cross-tenant view).
 * The demo tenant (MegaBot Demo) is one of several sellers on the platform.
 */
export const mockPlatformTenants: PlatformTenant[] = [
  {
    id: TENANT_ID,
    name: mockTenant.name,
    slug: mockTenant.slug,
    status: 'active',
    createdAt: ago({ days: 92 }),
    updatedAt: ago({ days: 3 }),
    currency: 'MZN',
    timezone: 'Africa/Maputo',
    locale: 'pt-MZ',
    members: { total: 3, owners: 1, admins: 1, operators: 1 },
  },
  {
    id: 'tnt_recargas_matola',
    name: 'Recargas Matola',
    slug: 'recargas-matola',
    status: 'active',
    createdAt: ago({ days: 61 }),
    updatedAt: ago({ days: 12 }),
    currency: 'MZN',
    timezone: 'Africa/Maputo',
    locale: 'pt-MZ',
    members: { total: 2, owners: 1, admins: 0, operators: 1 },
  },
  {
    id: 'tnt_netplus_beira',
    name: 'NetPlus Beira',
    slug: 'netplus-beira',
    status: 'suspended',
    createdAt: ago({ days: 40 }),
    updatedAt: ago({ days: 2, hours: 4 }),
    currency: 'MZN',
    timezone: 'Africa/Maputo',
    locale: 'pt-MZ',
    members: { total: 1, owners: 1, admins: 0, operators: 0 },
  },
  {
    id: 'tnt_dados_nampula',
    name: 'Dados Express Nampula',
    slug: 'dados-express-nampula',
    status: 'active',
    createdAt: ago({ days: 9 }),
    updatedAt: ago({ days: 9 }),
    currency: 'MZN',
    timezone: 'Africa/Maputo',
    locale: 'pt-MZ',
    members: { total: 4, owners: 1, admins: 1, operators: 2 },
  },
];

export const mockAuditLogs: AuditLogEntry[] = [
  {
    id: 'aud_002',
    actorUserId: mockUser.id,
    tenantId: 'tnt_netplus_beira',
    action: 'tenant.suspended',
    resourceType: 'tenant',
    resourceId: 'tnt_netplus_beira',
    metadata: { previous_status: 'active', status: 'suspended', reason: 'Pedido do titular da conta' },
    ipAddress: null,
    userAgent: null,
    createdAt: ago({ days: 2, hours: 4 }),
  },
  {
    id: 'aud_001',
    actorUserId: null,
    tenantId: null,
    action: 'platform_admin.granted',
    resourceType: 'platform_admin',
    resourceId: mockUser.id,
    metadata: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    ipAddress: null,
    userAgent: null,
    createdAt: ago({ days: 90 }),
  },
];
