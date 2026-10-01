import { AppError } from '../errors';
import { mockOrdersService as orders } from '../mock/orders';
import { mockProductsService as products } from '../mock/catalog';
import { serviceContext } from '../context';
import { setSimulation } from '../mock/simulation';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('mock orders service (same rules as migration 004)', () => {
  beforeAll(() => {
    setSimulation({ latency: 'instant', failRequests: false, offline: false, emptyData: false });
    serviceContext.setTenant('tnt_megabot_demo');
  });
  afterAll(() => {
    serviceContext.setTenant(null);
    setSimulation({ latency: 'realistic' });
  });

  it('creates a PENDING order with a product snapshot and a public reference', async () => {
    const order = await orders.create({ productId: 'prd_1024', customerPhone: '84 000 0001', customerName: 'João' });
    expect(order).toMatchObject({
      status: 'PENDING',
      destination: '+258840000001',
      productName: '1024 MB',
      price: 24,
      currency: 'MZN',
      channel: null,
    });
    expect(order.code).toMatch(/^MB-\d{8}-[0-9A-F]{8}$/);
    expect(order.events[0]).toMatchObject({ type: 'created', toStatus: 'PENDING' });
  });

  it('keeps the snapshot when the product changes later', async () => {
    const order = await orders.create({ productId: 'prd_2048', customerPhone: '850000002' });
    const product = await products.get('prd_2048');
    await products.update('prd_2048', {
      name: product.name,
      description: product.description,
      category: product.category,
      price: 99,
      currency: product.currency,
      dataAmount: product.dataAmount,
      dataUnit: product.dataUnit,
      validityHours: product.validityHours,
      operator: product.operator,
      status: product.status,
      ussdFlow: product.ussdFlow,
    });
    expect((await orders.get(order.id)).price).toBe(45);
  });

  it('is idempotent by key', async () => {
    const a = await orders.create({ productId: 'prd_400', customerPhone: '860000003', idempotencyKey: 'mock-key-0001' });
    const b = await orders.create({ productId: 'prd_400', customerPhone: '+258 86 000 0003', idempotencyKey: 'mock-key-0001' });
    expect(b.id).toBe(a.id);
    expect((await failure(orders.create({ productId: 'prd_400', customerPhone: '870000009', idempotencyKey: 'mock-key-0001' }))).reason).toBe(
      'IDEMPOTENCY_KEY_REUSED'
    );
  });

  it('refuses inactive products and invalid phones', async () => {
    expect((await failure(orders.create({ productId: 'prd_3072', customerPhone: '840000004' }))).reason).toBe('PRODUCT_NOT_AVAILABLE');
    expect((await failure(orders.create({ productId: 'prd_400', customerPhone: '810000004' }))).reason).toBe('INVALID_PHONE');
  });

  it('only allows valid transitions and records each one', async () => {
    const order = await orders.create({ productId: 'prd_600', customerPhone: '840000005' });
    expect((await orders.markAwaitingPayment(order.id)).status).toBe('AWAITING_PAYMENT');
    const cancelled = await orders.cancel(order.id, { reason: 'Desistiu' });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Desistiu' });
    expect(cancelled.events.map((e) => e.type)).toEqual(['created', 'status_changed', 'cancelled']);
    expect((await orders.cancel(order.id)).events).toHaveLength(3);
    expect((await failure(orders.markAwaitingPayment(order.id))).reason).toBe('INVALID_TRANSITION');
  });
});
