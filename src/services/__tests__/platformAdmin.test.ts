import type { PlatformAdminContext } from '@/types';

import { serviceContext } from '../context';
import { AppError } from '../errors';
import { createMockPlatformAdminService } from '../mock/platformAdmin';
import { setSimulation } from '../mock/simulation';
import {
  hasPlatformPermission,
  noPlatformAccess,
  normalizeAuditLogQuery,
  normalizeReason,
  normalizeTenantListParams,
} from '../platformAdmin';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('hasPlatformPermission', () => {
  const active: PlatformAdminContext = {
    isPlatformAdmin: true,
    role: 'SUPPORT_ADMIN',
    status: 'ACTIVE',
    permissions: ['tenants.read', 'tenants.suspend', 'audit_logs.read'],
  };

  it('grants only the permissions computed by the backend', () => {
    expect(hasPlatformPermission(active, 'tenants.read')).toBe(true);
    expect(hasPlatformPermission(active, 'platform_admins.read')).toBe(false);
  });

  it('denies everything without a context, for non-admins and for suspended admins', () => {
    expect(hasPlatformPermission(null, 'tenants.read')).toBe(false);
    expect(hasPlatformPermission(undefined, 'tenants.read')).toBe(false);
    expect(hasPlatformPermission(noPlatformAccess(), 'tenants.read')).toBe(false);
    expect(hasPlatformPermission({ ...active, isPlatformAdmin: false, status: 'SUSPENDED' }, 'tenants.read')).toBe(false);
  });
});

describe('platform input rules', () => {
  it('normalizes tenant list parameters', () => {
    expect(normalizeTenantListParams()).toEqual({ status: null, search: null, limit: 50, offset: 0 });
    expect(normalizeTenantListParams({ search: '   ', limit: 0, offset: 2.7 })).toEqual({ status: null, search: null, limit: 1, offset: 2 });
    expect(() => normalizeTenantListParams({ search: 'x'.repeat(81) })).toThrow(AppError);
  });

  it('trims the reason and enforces its length', () => {
    expect(normalizeReason(undefined)).toBeNull();
    expect(normalizeReason('  ')).toBeNull();
    expect(normalizeReason(' Fraude ')).toBe('Fraude');
    expect(normalizeReason('x'.repeat(500))).toHaveLength(500);
    expect(() => normalizeReason('x'.repeat(501))).toThrow(AppError);
  });

  it('normalizes audit queries', () => {
    expect(normalizeAuditLogQuery({ limit: 9999, action: ' tenant.suspended ' })).toMatchObject({ limit: 200, action: 'tenant.suspended', tenantId: null });
    expect(() => normalizeAuditLogQuery({ before: 'not a date' })).toThrow(AppError);
  });
});

describe('mock platform admin service', () => {
  beforeAll(() => {
    setSimulation({ latency: 'instant', failRequests: false, offline: false, emptyData: false });
    serviceContext.setTenant('tnt_bytestore');
  });
  afterAll(() => {
    serviceContext.setTenant(null);
    setSimulation({ latency: 'realistic' });
  });

  it('gives a SUPER_ADMIN every platform permission', async () => {
    const service = createMockPlatformAdminService({ role: 'SUPER_ADMIN' });
    const context = await service.getPlatformAdminContext();
    expect(context).toMatchObject({ isPlatformAdmin: true, role: 'SUPER_ADMIN', status: 'ACTIVE' });
    expect(context.permissions).toEqual(expect.arrayContaining(['tenants.read', 'tenants.suspend', 'audit_logs.read', 'platform_admins.read']));
  });

  it('lists tenants with filters and member counts', async () => {
    const service = createMockPlatformAdminService({ role: 'SUPPORT_ADMIN' });
    const all = await service.listTenants();
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((tenant) => tenant.members.total >= tenant.members.owners)).toBe(true);
    const suspended = await service.listTenants({ status: 'suspended' });
    expect(suspended.length).toBeGreaterThan(0);
    expect(suspended.every((tenant) => tenant.status === 'suspended')).toBe(true);
    expect(await service.listTenants({ search: 'BEIRA' })).toHaveLength(1);
  });

  it('suspends and reactivates, appending audit entries', async () => {
    const service = createMockPlatformAdminService({ role: 'SUPPORT_ADMIN', actorUserId: 'support-1' });
    const suspended = await service.suspendTenant('tnt_recargas_matola', { reason: 'Teste' });
    expect(suspended.status).toBe('suspended');
    expect((await failure(service.suspendTenant('tnt_recargas_matola'))).reason).toBe('TENANT_ALREADY_SUSPENDED');

    const reactivated = await service.reactivateTenant('tnt_recargas_matola');
    expect(reactivated.status).toBe('active');
    expect((await failure(service.reactivateTenant('tnt_recargas_matola'))).reason).toBe('TENANT_ALREADY_ACTIVE');

    const logs = await service.getAuditLogs({ tenantId: 'tnt_recargas_matola' });
    expect(logs.map((entry) => entry.action)).toEqual(['tenant.reactivated', 'tenant.suspended']);
    expect(logs[1]).toMatchObject({ actorUserId: 'support-1', metadata: { previous_status: 'active', status: 'suspended', reason: 'Teste' } });
    expect(logs[0].metadata).not.toHaveProperty('reason');
  });

  it('returns copies: callers cannot mutate the stored tenants', async () => {
    const service = createMockPlatformAdminService({ role: 'SUPER_ADMIN' });
    const tenant = await service.getTenant('tnt_dados_nampula');
    tenant.status = 'suspended';
    expect((await service.getTenant('tnt_dados_nampula')).status).toBe('active');
  });

  it('reports unknown tenants as NOT_FOUND', async () => {
    const service = createMockPlatformAdminService({ role: 'SUPER_ADMIN' });
    expect((await failure(service.getTenant('tnt_nope'))).code).toBe('NOT_FOUND');
    expect((await failure(service.suspendTenant('tnt_nope'))).code).toBe('NOT_FOUND');
  });

  it.each([
    ['a normal user', { role: null }],
    ['a suspended admin', { role: 'SUPER_ADMIN', status: 'SUSPENDED' }],
  ] as const)('denies tenant operations to %s and hides audit logs', async (_label, options) => {
    const service = createMockPlatformAdminService(options);
    expect((await service.getPlatformAdminContext()).isPlatformAdmin).toBe(false);
    expect(await failure(service.listTenants())).toMatchObject({ code: 'PERMISSION_DENIED', reason: 'PLATFORM_ACCESS_DENIED' });
    expect((await failure(service.getTenant('tnt_bytestore'))).code).toBe('PERMISSION_DENIED');
    expect((await failure(service.suspendTenant('tnt_bytestore'))).code).toBe('PERMISSION_DENIED');
    expect(await service.getAuditLogs()).toEqual([]);
  });
});
