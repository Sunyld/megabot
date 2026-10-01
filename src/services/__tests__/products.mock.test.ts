import type { ProductInput } from '@/types';

import { serviceContext } from '../context';
import { AppError } from '../errors';
import { mockProductsService as products } from '../mock/catalog';
import { setSimulation } from '../mock/simulation';

const input = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  name: 'Teste Mock 1GB',
  description: null,
  category: 'daily',
  price: 24,
  currency: 'MZN',
  dataAmount: 1,
  dataUnit: 'GB',
  validityHours: 24,
  operator: 'movitel',
  status: 'INACTIVE',
  ussdFlow: { version: 1, start: '*123#', steps: [{ type: 'select', value: '3' }, { type: 'confirm' }] },
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('mock products service (same rules as migration 003)', () => {
  beforeAll(() => {
    setSimulation({ latency: 'instant', failRequests: false, offline: false, emptyData: false });
    serviceContext.setTenant('tnt_megabot_demo');
  });
  afterAll(() => {
    serviceContext.setTenant(null);
    setSimulation({ latency: 'realistic' });
  });

  it('creates, edits, activates and archives a product', async () => {
    const created = await products.create(input());
    expect(created).toMatchObject({ name: 'Teste Mock 1GB', status: 'INACTIVE', archivedAt: null });
    expect((await products.list()).some((p) => p.id === created.id)).toBe(true);

    const edited = await products.update(created.id, input({ price: 25, description: '  Promo  ' }));
    expect(edited).toMatchObject({ price: 25, description: 'Promo' });

    expect((await products.activate(created.id)).status).toBe('ACTIVE');
    expect((await products.deactivate(created.id)).status).toBe('INACTIVE');

    await products.archive(created.id);
    expect((await products.list()).some((p) => p.id === created.id)).toBe(false);
    expect((await products.get(created.id)).archivedAt).not.toBeNull();
    expect((await failure(products.update(created.id, input()))).reason).toBe('PRODUCT_ARCHIVED');
  });

  it('keeps one live product per name (case-insensitive)', async () => {
    await products.create(input({ name: 'Nome Único' }));
    expect((await failure(products.create(input({ name: 'nome único' })))).reason).toBe('PRODUCT_NAME_TAKEN');
  });

  it('only activates products that have a USSD flow', async () => {
    const created = await products.create(input({ name: 'Sem Fluxo', ussdFlow: null }));
    expect((await failure(products.activate(created.id))).code).toBe('VALIDATION_ERROR');
    expect((await failure(products.create(input({ name: 'Ativo Sem Fluxo', status: 'ACTIVE', ussdFlow: null })))).reason).toBe(
      'INVALID_PRODUCT'
    );
  });

  it('keeps a different flow per product', async () => {
    const a = await products.create(input({ name: 'Fluxo A' }));
    const b = await products.create(
      input({ name: 'Fluxo B', ussdFlow: { version: 1, start: '*111#', steps: [{ type: 'input', source: 'destination_number' }] } })
    );
    expect((await products.get(a.id)).ussdFlow?.start).toBe('*123#');
    expect((await products.get(b.id)).ussdFlow?.start).toBe('*111#');
  });
});
