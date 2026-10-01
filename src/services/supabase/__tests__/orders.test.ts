import { PostgrestError } from '@supabase/supabase-js';

import { AppError } from '../../errors';
import { createSupabaseOrdersService, toOrder, toOrderEvent } from '../orders';
import { toSearchTerm, type CreateOrderArgs, type OrderEventRow, type OrderListQuery, type OrderRow, type OrdersGateway } from '../ordersGateway';

/*
 * The orders service against a fake gateway (no network). Authorization,
 * snapshots, idempotency and the state machine are enforced by the database
 * and verified in supabase/tests/004_orders.test.sql.
 */

const tagged = (code: string, hint: string, message: string) => new PostgrestError({ code, message, details: '', hint });

const row = (overrides: Partial<OrderRow> = {}): OrderRow => ({
  id: 'order-1',
  tenant_id: 'tenant-a',
  product_id: 'product-1',
  public_reference: 'MB-20261001-3F9A2C1B',
  customer_name: 'João',
  customer_phone: '+258840000001',
  product_name_snapshot: 'Internet 5GB',
  product_price_snapshot: 500,
  currency_snapshot: 'MZN',
  data_amount_snapshot: 5,
  data_unit_snapshot: 'GB',
  validity_hours_snapshot: 720,
  operator_snapshot: 'vodacom',
  status: 'PENDING',
  status_changed_at: '2026-10-01T10:00:00.000Z',
  cancel_reason: null,
  idempotency_key: null,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const event = (overrides: Partial<OrderEventRow> = {}): OrderEventRow => ({
  id: 'event-1',
  tenant_id: 'tenant-a',
  order_id: 'order-1',
  event_type: 'order.created',
  actor_user_id: 'user-a',
  from_status: null,
  to_status: 'PENDING',
  metadata: {},
  created_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

function setup(tenantId: string | null = 'tenant-a') {
  const mocks = {
    list: jest.fn((tenant: string, query: OrderListQuery) => Promise.resolve([row()])),
    get: jest.fn((tenant: string, id: string) => Promise.resolve<OrderRow | null>(row({ id }))),
    listEvents: jest.fn((tenant: string, orderId: string) => Promise.resolve([event()])),
    counts: jest.fn((tenant: string) =>
      Promise.resolve([
        { status: 'PENDING', total: 2 },
        { status: 'AWAITING_PAYMENT', total: 1 },
        { status: 'COMPLETED', total: 4 },
        { status: 'CANCELLED', total: 3 },
      ])
    ),
    create: jest.fn((args: CreateOrderArgs) => Promise.resolve([row()])),
    markAwaitingPayment: jest.fn((id: string) => Promise.resolve([row({ id, status: 'AWAITING_PAYMENT' })])),
    cancel: jest.fn((id: string, reason: string | null) => Promise.resolve([row({ id, status: 'CANCELLED', cancel_reason: reason })])),
  };
  const gateway: OrdersGateway = mocks;
  return { mocks, service: createSupabaseOrdersService(gateway, () => tenantId) };
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
  it('maps the order snapshot (never the current product)', () => {
    expect(toOrder(row(), [event()])).toMatchObject({
      code: 'MB-20261001-3F9A2C1B',
      productName: 'Internet 5GB',
      price: 500,
      currency: 'MZN',
      dataAmount: 5,
      dataUnit: 'GB',
      destination: '+258840000001',
      customer: { name: 'João', whatsapp: null },
      channel: null,
      status: 'PENDING',
      paymentId: null,
      events: [{ type: 'created', toStatus: 'PENDING', fromStatus: null, actorUserId: 'user-a' }],
    });
  });

  it('maps history events (transitions and cancellation reasons)', () => {
    expect(toOrderEvent(event({ event_type: 'order.status_changed', from_status: 'PENDING', to_status: 'AWAITING_PAYMENT' }))).toMatchObject({
      type: 'status_changed',
      fromStatus: 'PENDING',
      toStatus: 'AWAITING_PAYMENT',
    });
    expect(
      toOrderEvent(event({ event_type: 'order.cancelled', from_status: 'PENDING', to_status: 'CANCELLED', metadata: { reason: 'Desistiu' } }))
    ).toMatchObject({ type: 'cancelled', description: 'Desistiu' });
    expect(toOrderEvent(event({ event_type: 'order.expired', to_status: 'EXPIRED' })).type).toBe('expired');
  });

  it('shows unknown statuses as needing attention', () => {
    expect(toOrder(row({ status: 'ON_HOLD' })).status).toBe('FAILED');
  });
});

describe('toSearchTerm', () => {
  it('keeps the search safe for PostgREST filters', () => {
    expect(toSearchTerm('MB-2026,(evil)*')).toBe('MB-2026evil');
    expect(toSearchTerm(' 84 000 0001 ')).toBe('840000001');
    expect(toSearchTerm('João Mabunda')).toBe('João Mabunda');
  });
});

describe('createSupabaseOrdersService', () => {
  it('lists the active tenant with the statuses of the filter', async () => {
    const { service, mocks } = setup();
    await service.list({ filter: 'pending', search: '  840 ' });
    expect(mocks.list).toHaveBeenCalledWith('tenant-a', {
      statuses: ['PENDING', 'AWAITING_PAYMENT', 'VERIFYING'],
      search: '840',
      limit: 200,
    });
    await service.list();
    expect(mocks.list).toHaveBeenLastCalledWith('tenant-a', { statuses: null, search: null, limit: 200 });
  });

  it('aggregates status counts into the filter buckets', async () => {
    const { service } = setup();
    expect(await service.counts()).toEqual({ all: 10, pending: 3, paid: 0, processing: 0, completed: 4, failed: 0 });
  });

  it('loads an order with its history', async () => {
    const { service, mocks } = setup();
    const order = await service.get('order-9');
    expect(mocks.listEvents).toHaveBeenCalledWith('tenant-a', 'order-9');
    expect(order.events).toHaveLength(1);
    mocks.get.mockResolvedValueOnce(null);
    expect((await failure(service.get('nope'))).code).toBe('NOT_FOUND');
  });

  it('creates with a normalized phone and the idempotency key (never a price)', async () => {
    const { service, mocks } = setup();
    await service.create({ productId: 'product-1', customerPhone: '84 000 0001', customerName: ' João ', idempotencyKey: 'app-key-0001' });
    expect(mocks.create).toHaveBeenCalledWith({
      productId: 'product-1',
      customerPhone: '+258840000001',
      customerName: 'João',
      idempotencyKey: 'app-key-0001',
    });
  });

  it('rejects an invalid phone before calling the backend', async () => {
    const { service, mocks } = setup();
    expect((await failure(service.create({ productId: 'product-1', customerPhone: '810000001' }))).reason).toBe('INVALID_PHONE');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['42501', 'TENANT_SUSPENDED', 'PERMISSION_DENIED', 'TENANT_SUSPENDED'],
    ['55000', 'PRODUCT_NOT_AVAILABLE', 'CONFLICT', 'PRODUCT_NOT_AVAILABLE'],
    ['P0002', 'PRODUCT_NOT_FOUND', 'NOT_FOUND', undefined],
    ['23505', 'IDEMPOTENCY_KEY_REUSED', 'CONFLICT', 'IDEMPOTENCY_KEY_REUSED'],
    ['22023', 'INVALID_PHONE', 'VALIDATION_ERROR', 'INVALID_PHONE'],
  ])('maps database error %s/%s', async (code, hint, appCode, reason) => {
    const { service, mocks } = setup();
    mocks.create.mockRejectedValueOnce(tagged(code, hint, 'Mensagem do servidor.'));
    const error = await failure(service.create({ productId: 'product-1', customerPhone: '840000001' }));
    expect(error).toMatchObject({ code: appCode, reason, message: 'Mensagem do servidor.' });
  });

  it('runs explicit status commands and explains refused transitions', async () => {
    const { service, mocks } = setup();
    expect((await service.markAwaitingPayment('order-1')).status).toBe('AWAITING_PAYMENT');
    expect(await service.cancel('order-1', { reason: '  Desistiu ' })).toMatchObject({ status: 'CANCELLED', cancelReason: 'Desistiu' });
    expect(mocks.cancel).toHaveBeenCalledWith('order-1', 'Desistiu');

    mocks.markAwaitingPayment.mockRejectedValueOnce(tagged('55000', 'INVALID_TRANSITION', 'Transição de estado inválida: CANCELLED → AWAITING_PAYMENT.'));
    expect(await failure(service.markAwaitingPayment('order-1'))).toMatchObject({
      code: 'CONFLICT',
      reason: 'INVALID_TRANSITION',
      message: 'Esta ação não é possível no estado atual do pedido.',
    });
  });

  it('requires a signed-in tenant', async () => {
    const { service, mocks } = setup(null);
    expect((await failure(service.list())).reason).toBe('SESSION_EXPIRED');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('activation commands are not available until the activation phase', async () => {
    const { service } = setup();
    expect((await failure(service.retryActivation('order-1'))).reason).toBe('FEATURE_NOT_AVAILABLE');
    expect((await failure(service.verifyActivation('order-1'))).reason).toBe('FEATURE_NOT_AVAILABLE');
    expect((await failure(service.resendConfirmation('order-1'))).reason).toBe('FEATURE_NOT_AVAILABLE');
  });
});
