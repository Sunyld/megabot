import { PostgrestError } from '@supabase/supabase-js';

import type { ProductInput } from '@/types';

import { AppError } from '../../errors';
import { createSupabaseProductsService, toProduct, toProductRow } from '../products';
import type { ProductInsertRow, ProductRow, ProductsGateway, ProductUpdateRow } from '../productsGateway';

/*
 * The products service against a fake gateway (no network). Tenant isolation,
 * roles, suspended tenants and USSD validation are enforced by the database
 * and verified in supabase/tests/003_products.test.sql.
 */

const postgrest = (code: string, message = 'boom') => new PostgrestError({ code, message, details: '', hint: '' });

const flow = {
  version: 1 as const,
  start: '*111#',
  steps: [{ type: 'select' as const, value: '5' }, { type: 'input' as const, source: 'destination_number' as const }, { type: 'confirm' as const }],
};

const row = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: 'product-1',
  tenant_id: 'tenant-a',
  name: 'Internet 5GB',
  description: null,
  category: 'monthly',
  price: 499.99,
  currency: 'MZN',
  data_amount: 5,
  data_unit: 'GB',
  validity_hours: 720,
  operator: 'vodacom',
  status: 'ACTIVE',
  ussd_flow: flow,
  archived_at: null,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const input = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  name: ' Internet 5GB ',
  description: '',
  category: 'monthly',
  price: 499.99,
  currency: 'mzn',
  dataAmount: 5,
  dataUnit: 'GB',
  validityHours: 720,
  operator: 'vodacom',
  status: 'ACTIVE',
  ussdFlow: flow,
  ...overrides,
});

function setup(tenantId: string | null = 'tenant-a') {
  const mocks = {
    list: jest.fn((tenant: string) => Promise.resolve([row()])),
    get: jest.fn((tenant: string, id: string) => Promise.resolve<ProductRow | null>(row({ id }))),
    insert: jest.fn((values: ProductInsertRow) => Promise.resolve(row())),
    update: jest.fn((tenant: string, id: string, patch: ProductUpdateRow) => Promise.resolve<ProductRow | null>(row({ id }))),
  };
  const gateway: ProductsGateway = mocks;
  return { mocks, service: createSupabaseProductsService(gateway, () => tenantId) };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('row mapping', () => {
  it('maps a product row to the domain', () => {
    expect(toProduct(row())).toEqual({
      id: 'product-1',
      tenantId: 'tenant-a',
      name: 'Internet 5GB',
      description: null,
      category: 'monthly',
      price: 499.99,
      currency: 'MZN',
      dataAmount: 5,
      dataUnit: 'GB',
      validityHours: 720,
      operator: 'vodacom',
      status: 'ACTIVE',
      ussdFlow: flow,
      archivedAt: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      soldToday: 0,
    });
  });

  it('fails closed: unknown values or an unreadable flow are never shown as for sale', () => {
    expect(toProduct(row({ status: 'PROMO' })).status).toBe('INACTIVE');
    expect(toProduct(row({ operator: 'satellite' })).status).toBe('INACTIVE');
    const broken = toProduct(row({ ussd_flow: { version: 9 } }));
    expect(broken).toMatchObject({ ussdFlow: null, status: 'INACTIVE' });
  });

  it('maps domain input to columns (tenant_id is added by the service)', () => {
    expect(toProductRow(input({ name: 'X', currency: 'MZN', description: null }))).toEqual({
      name: 'X',
      description: null,
      category: 'monthly',
      price: 499.99,
      currency: 'MZN',
      data_amount: 5,
      data_unit: 'GB',
      validity_hours: 720,
      operator: 'vodacom',
      status: 'ACTIVE',
      ussd_flow: flow,
    });
  });
});

describe('createSupabaseProductsService', () => {
  it('lists only the active tenant (scoped query; RLS enforces it)', async () => {
    const { service, mocks } = setup();
    const products = await service.list();
    expect(mocks.list).toHaveBeenCalledWith('tenant-a');
    expect(products[0].name).toBe('Internet 5GB');
  });

  it('requires a signed-in tenant', async () => {
    const { service, mocks } = setup(null);
    expect(await failure(service.list())).toMatchObject({ code: 'AUTH_ERROR', reason: 'SESSION_EXPIRED' });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('creates with normalized, validated values for the active tenant', async () => {
    const { service, mocks } = setup();
    await service.create(input());
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-a', name: 'Internet 5GB', description: null, currency: 'MZN', ussd_flow: flow })
    );
  });

  it('rejects invalid products before calling the backend', async () => {
    const { service, mocks } = setup();
    expect((await failure(service.create(input({ status: 'ACTIVE', ussdFlow: null })))).reason).toBe('INVALID_PRODUCT');
    expect((await failure(service.create(input({ ussdFlow: { ...flow, steps: [] } })))).code).toBe('VALIDATION_ERROR');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('explains RLS denials (operator, suspended tenant, other tenant)', async () => {
    const { service, mocks } = setup();
    mocks.insert.mockRejectedValueOnce(postgrest('42501', 'new row violates row-level security policy for table "products"'));
    expect(await failure(service.create(input()))).toMatchObject({ code: 'PERMISSION_DENIED', reason: 'PRODUCT_WRITE_DENIED' });
    mocks.update.mockRejectedValueOnce(postgrest('42501'));
    expect((await failure(service.deactivate('product-1'))).reason).toBe('PRODUCT_WRITE_DENIED');
  });

  it('maps duplicate names and archived products', async () => {
    const { service, mocks } = setup();
    mocks.insert.mockRejectedValueOnce(postgrest('23505', 'duplicate key value violates unique constraint "products_tenant_name_key"'));
    expect(await failure(service.create(input()))).toMatchObject({ code: 'CONFLICT', reason: 'PRODUCT_NAME_TAKEN' });
    mocks.update.mockRejectedValueOnce(postgrest('55000', 'Produto arquivado não pode ser alterado.'));
    expect((await failure(service.update('product-1', input()))).reason).toBe('PRODUCT_ARCHIVED');
  });

  it('reports an invisible / unknown product as NOT_FOUND', async () => {
    const { service, mocks } = setup();
    mocks.update.mockResolvedValueOnce(null);
    expect((await failure(service.update('nope', input()))).code).toBe('NOT_FOUND');
    mocks.get.mockResolvedValueOnce(null);
    expect((await failure(service.get('nope'))).code).toBe('NOT_FOUND');
  });

  it('activates, deactivates and archives with minimal patches', async () => {
    const { service, mocks } = setup();
    await service.activate('product-1');
    await service.deactivate('product-1');
    await service.archive('product-1');
    expect(mocks.update.mock.calls.map(([, , patch]) => Object.keys(patch))).toEqual([['status'], ['status'], ['archived_at']]);
    expect(mocks.update.mock.calls[0][2]).toEqual({ status: 'ACTIVE' });
  });

  it('explains why a product without USSD cannot be activated', async () => {
    const { service, mocks } = setup();
    mocks.update.mockRejectedValueOnce(postgrest('23514', 'new row violates check constraint "products_active_needs_flow"'));
    expect((await failure(service.activate('product-1'))).message).toMatch(/Configure o USSD/);
  });
});
