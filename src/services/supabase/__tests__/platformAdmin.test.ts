import { PostgrestError } from '@supabase/supabase-js';

import type { TenantStatus } from '@/types';

import { AppError } from '../../errors';
import type { NormalizedAuditLogQuery, NormalizedTenantListParams } from '../../platformAdmin';
import { createSupabasePlatformAdminService, toAuditLogEntry, toPlatformAdminContext, toPlatformTenant } from '../platformAdmin';
import type { AuditLogRow, PlatformAdminContextRow, PlatformAdminGateway, PlatformTenantRow } from '../platformAdminGateway';

/*
 * The platform admin service is exercised against a fake gateway (no network).
 * These tests cover the app-side mapping only — authorization, RLS and the
 * audit trail are enforced and verified in the database
 * (supabase/tests/002_platform_admin.test.sql).
 */

const postgrest = (code: string, message = 'boom') => new PostgrestError({ code, message, details: '', hint: '' });

const tenantRow = (overrides: Partial<PlatformTenantRow> = {}): PlatformTenantRow => ({
  id: 'tenant-b',
  name: 'Loja Beta',
  slug: 'loja-beta',
  status: 'active',
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
  currency: 'MZN',
  timezone: 'Africa/Maputo',
  locale: 'pt-MZ',
  member_count: 3,
  owner_count: 1,
  admin_count: 1,
  operator_count: 1,
  ...overrides,
});

const auditRow = (overrides: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 'log-1',
  actor_user_id: 'admin-1',
  tenant_id: 'tenant-b',
  action: 'tenant.suspended',
  resource_type: 'tenant',
  resource_id: 'tenant-b',
  metadata: { previous_status: 'active', status: 'suspended', reason: 'Fraude', nested: { list: [1, 'a', null] } },
  ip_address: '41.220.1.2',
  user_agent: 'MegaBot/1.0',
  created_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

function createFakeGateway() {
  const mocks = {
    fetchContext: jest.fn(() =>
      Promise.resolve<PlatformAdminContextRow[]>([
        { role: 'SUPER_ADMIN', status: 'ACTIVE', permissions: ['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read'] },
      ])
    ),
    listTenants: jest.fn((params: NormalizedTenantListParams) => Promise.resolve([tenantRow()])),
    getTenant: jest.fn((id: string) => Promise.resolve([tenantRow({ id })])),
    setTenantStatus: jest.fn((id: string, status: TenantStatus, reason: string | null) =>
      Promise.resolve([tenantRow({ id, status })])
    ),
    listAuditLogs: jest.fn((query: NormalizedAuditLogQuery) => Promise.resolve([auditRow()])),
  };
  const gateway: PlatformAdminGateway = mocks;
  return { gateway, mocks };
}

const setup = () => {
  const fake = createFakeGateway();
  return { ...fake, service: createSupabasePlatformAdminService(fake.gateway) };
};

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('toPlatformAdminContext', () => {
  it('returns no access when the backend has no platform_admins row (normal users, tenant admins)', () => {
    expect(toPlatformAdminContext([])).toEqual({ isPlatformAdmin: false, role: null, status: null, permissions: [] });
  });

  it('maps an active admin with the permissions computed by the backend', () => {
    expect(toPlatformAdminContext([{ role: 'SUPPORT_ADMIN', status: 'ACTIVE', permissions: ['tenants.read', 'audit_logs.read'] }])).toEqual({
      isPlatformAdmin: true,
      role: 'SUPPORT_ADMIN',
      status: 'ACTIVE',
      permissions: ['tenants.read', 'audit_logs.read'],
    });
  });

  it('gives a suspended admin no permissions, whatever the backend sends', () => {
    const context = toPlatformAdminContext([{ role: 'SUPER_ADMIN', status: 'SUSPENDED', permissions: ['tenants.read'] }]);
    expect(context).toMatchObject({ isPlatformAdmin: false, status: 'SUSPENDED', permissions: [] });
  });

  it('fails closed on unknown roles, statuses or permissions', () => {
    expect(toPlatformAdminContext([{ role: 'GOD_MODE', status: 'ACTIVE', permissions: ['tenants.read'] }]).isPlatformAdmin).toBe(false);
    expect(toPlatformAdminContext([{ role: 'SUPER_ADMIN', status: 'PENDING', permissions: ['tenants.read'] }]).isPlatformAdmin).toBe(false);
    expect(toPlatformAdminContext([{ role: 'SUPER_ADMIN', status: 'ACTIVE', permissions: ['tenants.read', 'everything'] }]).permissions).toEqual([
      'tenants.read',
    ]);
  });
});

describe('row mapping', () => {
  it('maps tenant overview rows with member counts per role', () => {
    expect(toPlatformTenant(tenantRow())).toEqual({
      id: 'tenant-b',
      name: 'Loja Beta',
      slug: 'loja-beta',
      status: 'active',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      currency: 'MZN',
      timezone: 'Africa/Maputo',
      locale: 'pt-MZ',
      members: { total: 3, owners: 1, admins: 1, operators: 1 },
    });
  });

  it('treats unknown tenant statuses as suspended and fills missing settings', () => {
    const tenant = toPlatformTenant(tenantRow({ status: 'archived', currency: null, timezone: null, locale: null }));
    expect(tenant).toMatchObject({ status: 'suspended', currency: 'MZN', timezone: 'Africa/Maputo', locale: 'pt-MZ' });
  });

  it('maps audit rows, keeping JSONB metadata and nullable tenant / actor', () => {
    expect(toAuditLogEntry(auditRow())).toEqual({
      id: 'log-1',
      actorUserId: 'admin-1',
      tenantId: 'tenant-b',
      action: 'tenant.suspended',
      resourceType: 'tenant',
      resourceId: 'tenant-b',
      metadata: { previous_status: 'active', status: 'suspended', reason: 'Fraude', nested: { list: [1, 'a', null] } },
      ipAddress: '41.220.1.2',
      userAgent: 'MegaBot/1.0',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    const system = toAuditLogEntry(auditRow({ actor_user_id: null, tenant_id: null, metadata: ['not', 'an', 'object'], ip_address: null }));
    expect(system).toMatchObject({ actorUserId: null, tenantId: null, metadata: {}, ipAddress: null });
  });
});

describe('createSupabasePlatformAdminService', () => {
  it('lists tenants with normalized parameters', async () => {
    const { service, mocks } = setup();
    const tenants = await service.listTenants({ status: 'suspended', search: '  beta ', limit: 1000, offset: -5 });
    expect(mocks.listTenants).toHaveBeenCalledWith({ status: 'suspended', search: 'beta', limit: 200, offset: 0 });
    expect(tenants).toHaveLength(1);
    expect(tenants[0].members.total).toBe(3);
  });

  it('rejects an over-long search without calling the backend', async () => {
    const { service, mocks } = setup();
    const error = await failure(service.listTenants({ search: 'x'.repeat(81) }));
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(mocks.listTenants).not.toHaveBeenCalled();
  });

  it('maps a denied platform call (42501) to PLATFORM_ACCESS_DENIED', async () => {
    const { service, mocks } = setup();
    mocks.listTenants.mockRejectedValueOnce(postgrest('42501', 'Acesso reservado à administração da plataforma.'));
    const error = await failure(service.listTenants());
    expect(error).toMatchObject({ code: 'PERMISSION_DENIED', reason: 'PLATFORM_ACCESS_DENIED' });
    expect(error.detail).toMatch(/42501/);
  });

  it('maps an unknown tenant to NOT_FOUND', async () => {
    const { service, mocks } = setup();
    mocks.getTenant.mockRejectedValueOnce(postgrest('P0002', 'Empresa não encontrada.'));
    expect(await failure(service.getTenant('nope'))).toMatchObject({ code: 'NOT_FOUND', message: 'Empresa não encontrada.' });
    mocks.getTenant.mockResolvedValueOnce([]);
    expect((await failure(service.getTenant('nope'))).code).toBe('NOT_FOUND');
  });

  it('suspends with a trimmed reason and returns the updated tenant', async () => {
    const { service, mocks } = setup();
    const tenant = await service.suspendTenant('tenant-b', { reason: '  Fraude  ' });
    expect(mocks.setTenantStatus).toHaveBeenCalledWith('tenant-b', 'suspended', 'Fraude');
    expect(tenant.status).toBe('suspended');
  });

  it('reactivates without a reason', async () => {
    const { service, mocks } = setup();
    const tenant = await service.reactivateTenant('tenant-b');
    expect(mocks.setTenantStatus).toHaveBeenCalledWith('tenant-b', 'active', null);
    expect(tenant.status).toBe('active');
  });

  it('explains a repeated transition (55000)', async () => {
    const { service, mocks } = setup();
    mocks.setTenantStatus.mockRejectedValueOnce(postgrest('55000', 'A empresa já está suspensa.'));
    expect(await failure(service.suspendTenant('tenant-b'))).toMatchObject({
      code: 'CONFLICT',
      reason: 'TENANT_ALREADY_SUSPENDED',
      message: 'Esta empresa já está suspensa.',
    });
    mocks.setTenantStatus.mockRejectedValueOnce(postgrest('55000', 'A empresa já está ativa.'));
    expect((await failure(service.reactivateTenant('tenant-b'))).reason).toBe('TENANT_ALREADY_ACTIVE');
  });

  it('rejects an over-long reason without calling the backend', async () => {
    const { service, mocks } = setup();
    expect((await failure(service.suspendTenant('tenant-b', { reason: 'x'.repeat(501) }))).code).toBe('VALIDATION_ERROR');
    expect(mocks.setTenantStatus).not.toHaveBeenCalled();
  });

  it('reads audit logs with filters and a page size', async () => {
    const { service, mocks } = setup();
    const logs = await service.getAuditLogs({ tenantId: 'tenant-b', action: 'tenant.suspended', before: '2026-10-01T12:00:00.000Z' });
    expect(mocks.listAuditLogs).toHaveBeenCalledWith({
      tenantId: 'tenant-b',
      action: 'tenant.suspended',
      resourceType: null,
      resourceId: null,
      before: '2026-10-01T12:00:00.000Z',
      limit: 50,
    });
    expect(logs[0].metadata.reason).toBe('Fraude');
  });

  it('rejects an invalid pagination cursor', async () => {
    const { service } = setup();
    expect((await failure(service.getAuditLogs({ before: 'ontem' }))).code).toBe('VALIDATION_ERROR');
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    const { service, mocks } = setup();
    mocks.fetchContext.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await failure(service.getPlatformAdminContext())).code).toBe('NETWORK_ERROR');
  });
});
