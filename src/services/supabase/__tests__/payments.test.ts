import { PostgrestError } from '@supabase/supabase-js';

import { AppError } from '../../errors';
import {
  createSupabasePaymentServices,
  toPaymentAccount,
  toPaymentCase,
  toPaymentError,
  toPaymentEvent,
  toPaymentMatch,
  toPaymentProof,
} from '../payments';
import type {
  ConfirmArgs,
  CreateAccountArgs,
  EventListQuery,
  MatchListQuery,
  OrderRefRow,
  PaymentAccountRow,
  PaymentEventRow,
  PaymentMatchRow,
  PaymentProofRow,
  PaymentsGateway,
  ProofListQuery,
  RecordEventArgs,
  SubmitProofArgs,
  UpdateAccountArgs,
} from '../paymentsGateway';

/*
 * The payment services against a fake gateway (no network). Authorization,
 * idempotency, immutability and the reconciliation decision itself are
 * enforced by the database and verified in supabase/tests/005_payments.test.sql.
 */

const tagged = (code: string, hint: string, message: string) => new PostgrestError({ code, message, details: '', hint });

const TODAY = new Date().toISOString();

const accountRow = (overrides: Partial<PaymentAccountRow> = {}): PaymentAccountRow => ({
  id: 'acc-1',
  tenant_id: 'tenant-a',
  provider: 'MPESA',
  account_name: 'Loja Alfa',
  account_identifier: '+258840000100',
  status: 'ACTIVE',
  metadata: {},
  created_at: TODAY,
  updated_at: TODAY,
  ...overrides,
});

const eventRow = (overrides: Partial<PaymentEventRow> = {}): PaymentEventRow => ({
  id: 'event-1',
  tenant_id: 'tenant-a',
  payment_account_id: 'acc-1',
  provider: 'MPESA',
  transaction_id: 'PP261001.1111.A00001',
  amount: 500,
  currency: 'MZN',
  sender_identifier: '84****001',
  recipient_identifier: null,
  occurred_at: TODAY,
  received_at: TODAY,
  raw_message: 'Recebeste 500.00MT de 84****001.',
  source: 'MANUAL',
  recorded_by: 'user-a',
  metadata: {},
  created_at: TODAY,
  ...overrides,
});

const proofRow = (overrides: Partial<PaymentProofRow> = {}): PaymentProofRow => ({
  id: 'proof-1',
  tenant_id: 'tenant-a',
  order_id: 'order-1',
  provider: 'MPESA',
  transaction_id: 'PP261001.1111.A00001',
  amount: 500,
  currency: 'MZN',
  sender_identifier: '840000001',
  recipient_identifier: null,
  raw_message: 'Confirmado PP261001.1111.A00001.',
  source: 'MANUAL',
  extracted_data: {},
  status: 'UNMATCHED',
  status_reason: 'NO_EVENT_YET',
  review_note: null,
  submitted_by: 'user-a',
  created_at: TODAY,
  updated_at: TODAY,
  ...overrides,
});

const matchRow = (overrides: Partial<PaymentMatchRow> = {}): PaymentMatchRow => ({
  id: 'match-1',
  tenant_id: 'tenant-a',
  order_id: 'order-1',
  payment_proof_id: 'proof-1',
  payment_event_id: 'event-1',
  match_status: 'CONFIRMED',
  match_methods: ['ORDER_CONTEXT', 'TRANSACTION_ID', 'ACCOUNT', 'AMOUNT', 'SENDER', 'TIME_WINDOW'],
  reason: null,
  details: {
    order_amount: 500,
    event_amount: 500,
    currency: 'MZN',
    failures: [],
    checks: { order: 'PASS', provider: 'PASS', transaction_id: 'PASS', account: 'PASS', currency: 'PASS', amount: 'PASS', sender: 'PASS', time_window: 'PASS' },
  },
  matched_at: TODAY,
  matched_by: null,
  metadata: {},
  created_at: TODAY,
  ...overrides,
});

const orderRef: OrderRefRow = { id: 'order-1', public_reference: 'MB-20261001-3F9A2C1B', product_price_snapshot: 500, currency_snapshot: 'MZN' };

type Data = { proofs: PaymentProofRow[]; events: PaymentEventRow[]; matches: PaymentMatchRow[]; accounts: PaymentAccountRow[] };

function setup(data: Partial<Data> = {}, tenantId: string | null = 'tenant-a') {
  const db: Data = { proofs: [], events: [], matches: [], accounts: [accountRow()], ...data };
  const mocks = {
    listAccounts: jest.fn((tenant: string) => Promise.resolve(db.accounts)),
    createAccount: jest.fn((args: CreateAccountArgs) => Promise.resolve([accountRow({ id: 'acc-new' })])),
    updateAccount: jest.fn((args: UpdateAccountArgs) => Promise.resolve([accountRow({ status: args.status ?? 'ACTIVE' })])),
    listEvents: jest.fn((tenant: string, query: EventListQuery) =>
      Promise.resolve(db.events.filter((e) => !query.ids || query.ids.includes(e.id)))
    ),
    recordEvent: jest.fn((args: RecordEventArgs) => Promise.resolve([eventRow()])),
    listProofs: jest.fn((tenant: string, query: ProofListQuery) =>
      Promise.resolve(db.proofs.filter((p) => !query.ids || query.ids.includes(p.id)))
    ),
    submitProof: jest.fn((args: SubmitProofArgs) => Promise.resolve([proofRow()])),
    reconcileProof: jest.fn((id: string) => Promise.resolve([proofRow({ id })])),
    rejectProof: jest.fn((id: string, reason: string) =>
      Promise.resolve([proofRow({ id, status: 'REJECTED', status_reason: 'REJECTED_MANUALLY', review_note: reason })])
    ),
    listMatches: jest.fn((tenant: string, query: MatchListQuery) =>
      Promise.resolve(
        db.matches.filter(
          (m) =>
            (!query.paymentProofId || m.payment_proof_id === query.paymentProofId) &&
            (!query.paymentEventId || m.payment_event_id === query.paymentEventId) &&
            (!query.orderId || m.order_id === query.orderId)
        )
      )
    ),
    confirmManually: jest.fn((args: ConfirmArgs) => Promise.resolve([matchRow({ reason: 'CONFIRMED_MANUALLY', match_methods: ['MANUAL'] })])),
    listOrderRefs: jest.fn((tenant: string, ids: string[]) => Promise.resolve(ids.includes('order-1') ? [orderRef] : [])),
  };
  const gateway: PaymentsGateway = mocks;
  return { mocks, db, services: createSupabasePaymentServices(gateway, () => tenantId) };
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
  it('maps accounts and events; unknown providers are left out, never relabelled', () => {
    expect(toPaymentAccount(accountRow())).toMatchObject({ provider: 'MPESA', accountIdentifier: '+258840000100', status: 'ACTIVE' });
    expect(toPaymentAccount(accountRow({ provider: 'MKESH' }))).toBeNull();
    expect(toPaymentEvent(eventRow({ amount: '500.00' as unknown as number }))).toMatchObject({ amount: 500, source: 'MANUAL' });
    expect(toPaymentEvent(eventRow({ provider: 'OTHER' }))).toBeNull();
  });

  it('maps proofs; unknown statuses surface as review, never as confirmed', () => {
    expect(toPaymentProof(proofRow({ status: 'SOMETHING_NEW' })).status).toBe('PENDING_REVIEW');
    expect(toPaymentProof(proofRow({ amount: null })).amount).toBeNull();
    expect(toPaymentProof(proofRow({ extracted_data: 'x' })).extractedData).toEqual({});
  });

  it('maps match details (checks, failures, amounts)', () => {
    const match = toPaymentMatch(
      matchRow({
        match_status: 'PENDING_REVIEW',
        reason: 'UNDERPAID',
        match_methods: ['ORDER_CONTEXT', 'AI_GUESS'],
        details: { order_amount: 500, event_amount: '300.00', currency: 'MZN', failures: ['UNDERPAID'], checks: { amount: 'FAIL', bogus: 'PASS', sender: 'MAYBE' } },
      })
    );
    expect(match).toMatchObject({
      status: 'PENDING_REVIEW',
      reason: 'UNDERPAID',
      methods: ['ORDER_CONTEXT'],
      failures: ['UNDERPAID'],
      checks: { amount: 'FAIL' },
      orderAmount: 500,
      eventAmount: 300,
    });
    expect(match.checks).not.toHaveProperty('bogus');
    expect(match.checks).not.toHaveProperty('sender');
  });
});

describe('payment cases (proof / real event / reconciliation result kept apart)', () => {
  const orders = new Map([[orderRef.id, orderRef]]);
  const account = toPaymentAccount(accountRow());

  it('a proof without a real event is pending — never confirmed', () => {
    const payment = toPaymentCase({ id: 'proof-1', tenantId: 'tenant-a', proof: toPaymentProof(proofRow()), event: null, matches: [], account: null, orders });
    expect(payment.status).toBe('pending');
    expect(payment.walletEvent).toBeNull();
    expect(payment.checks).toEqual([]);
    expect(payment.confirmedBy).toBeUndefined();
    expect(payment.proof).toMatchObject({ extractedBy: 'manual', confidence: null });
    expect(payment.orderCode).toBe('MB-20261001-3F9A2C1B');
  });

  it('proof + event + CONFIRMED match → confirmed by rules', () => {
    const payment = toPaymentCase({
      id: 'proof-1',
      tenantId: 'tenant-a',
      proof: toPaymentProof(proofRow({ status: 'CONFIRMED', status_reason: null })),
      event: toPaymentEvent(eventRow()),
      matches: [toPaymentMatch(matchRow())],
      account,
      orders,
    });
    expect(payment).toMatchObject({ status: 'confirmed', confirmedBy: 'rules', method: 'mpesa', amount: 500, account: '+258840000100' });
    expect(payment.walletEvent).toMatchObject({ source: 'manual', deviceName: null });
    expect(payment.checks.map((c) => c.key)).toEqual(
      expect.arrayContaining(['order', 'provider', 'transaction_id', 'account', 'amount', 'sender', 'datetime', 'duplicate'])
    );
    expect(payment.checks.every((c) => c.result === 'match')).toBe(true);
  });

  it('a manual decision is labelled manual', () => {
    const payment = toPaymentCase({
      id: 'proof-1',
      tenantId: 'tenant-a',
      proof: toPaymentProof(proofRow({ status: 'CONFIRMED' })),
      event: toPaymentEvent(eventRow()),
      matches: [toPaymentMatch(matchRow({ reason: 'CONFIRMED_MANUALLY', match_methods: ['MANUAL'] }))],
      account,
      orders,
    });
    expect(payment.confirmedBy).toBe('manual');
  });

  it('a review explains the failing rule and shows the amounts', () => {
    const payment = toPaymentCase({
      id: 'proof-1',
      tenantId: 'tenant-a',
      proof: toPaymentProof(proofRow({ status: 'PENDING_REVIEW', status_reason: 'UNDERPAID', amount: 300 })),
      event: toPaymentEvent(eventRow({ amount: 300 })),
      matches: [
        toPaymentMatch(
          matchRow({
            match_status: 'PENDING_REVIEW',
            reason: 'UNDERPAID',
            details: { order_amount: 500, event_amount: 300, currency: 'MZN', failures: ['UNDERPAID'], checks: { amount: 'FAIL', currency: 'PASS' } },
          })
        ),
      ],
      account,
      orders,
    });
    expect(payment.status).toBe('review');
    expect(payment.reviewReason).toBe('O valor recebido é inferior ao valor do pedido.');
    expect(payment.checks.find((c) => c.key === 'amount')).toMatchObject({ result: 'mismatch', expected: '500.00 MZN', actual: '300.00 MZN' });
  });

  it('rejected and duplicate proofs are rejected cases', () => {
    const rejected = toPaymentCase({
      id: 'proof-1',
      tenantId: 'tenant-a',
      proof: toPaymentProof(proofRow({ status: 'REJECTED', status_reason: 'REJECTED_MANUALLY', review_note: 'Comprovativo falso' })),
      event: null,
      matches: [],
      account: null,
      orders,
    });
    expect(rejected).toMatchObject({ status: 'rejected', reviewReason: 'Comprovativo falso' });
    const duplicate = toPaymentCase({
      id: 'proof-2',
      tenantId: 'tenant-a',
      proof: toPaymentProof(proofRow({ id: 'proof-2', status: 'DUPLICATE', status_reason: 'EVENT_ALREADY_USED' })),
      event: null,
      matches: [],
      account: null,
      orders,
    });
    expect(duplicate).toMatchObject({ status: 'rejected', reviewReason: 'Este movimento já confirmou outro pedido.' });
  });

  it('an event with several candidate orders has no single order', () => {
    const payment = toPaymentCase({
      id: 'event-1',
      tenantId: 'tenant-a',
      proof: null,
      event: toPaymentEvent(eventRow()),
      matches: [
        toPaymentMatch(matchRow({ id: 'm1', order_id: 'order-1', payment_proof_id: null, match_status: 'PENDING_REVIEW', reason: 'MULTIPLE_CANDIDATES' })),
        toPaymentMatch(matchRow({ id: 'm2', order_id: 'order-2', payment_proof_id: null, match_status: 'PENDING_REVIEW', reason: 'MULTIPLE_CANDIDATES' })),
      ],
      account,
      orders,
    });
    expect(payment).toMatchObject({ status: 'review', orderId: null, proof: null });
    expect(payment.reviewReason).toBe('Vários pedidos têm este valor. Escolha o pedido certo.');
  });
});

describe('payments service (Supabase)', () => {
  it('starts empty: no real data, no demo fixtures', async () => {
    const { services } = setup({ accounts: [] });
    expect(await services.payments.list()).toEqual([]);
    expect(await services.payments.summary()).toEqual({ received: 0, confirmed: 0, pending: 0, review: 0, rejected: 0, confirmedAmount: 0 });
    expect(await services.payments.listAccounts()).toEqual([]);
  });

  it('lists proofs and unclaimed events as separate cases, filtered and searched', async () => {
    const { services } = setup({
      proofs: [proofRow()],
      events: [eventRow({ id: 'event-2', transaction_id: 'PP261001.2222.B00002' })],
      matches: [],
    });
    const all = await services.payments.list();
    expect(all.map((p) => [p.id, p.status])).toEqual(
      expect.arrayContaining([
        ['proof-1', 'pending'],
        ['event-2', 'review'],
      ])
    );
    expect((await services.payments.list({ filter: 'pending' })).map((p) => p.id)).toEqual(['proof-1']);
    expect((await services.payments.list({ search: 'pp261001.2222' })).map((p) => p.id)).toEqual(['event-2']);
    const summary = await services.payments.summary();
    expect(summary).toMatchObject({ received: 2, pending: 1, review: 1, confirmed: 0 });
  });

  it('an event already claimed by a proof is not listed twice', async () => {
    const { services } = setup({
      proofs: [proofRow({ status: 'CONFIRMED' })],
      events: [eventRow()],
      matches: [matchRow()],
    });
    const cases = await services.payments.list();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: 'proof-1', status: 'confirmed' });
    expect((await services.payments.summary()).confirmedAmount).toBe(500);
  });

  it('approve refuses a proof without a real event (a proof alone never confirms)', async () => {
    const { services, mocks } = setup({
      proofs: [proofRow({ status: 'PENDING_REVIEW', status_reason: 'TRANSACTION_ID_REQUIRED', transaction_id: null, provider: null })],
    });
    const error = await failure(services.payments.approve('proof-1'));
    expect(error).toMatchObject({ code: 'CONFLICT', reason: 'PAYMENT_NOT_CONFIRMABLE' });
    expect(mocks.confirmManually).not.toHaveBeenCalled();
  });

  it('approve confirms a review against its real event', async () => {
    const { services, mocks } = setup({
      proofs: [proofRow({ status: 'PENDING_REVIEW', status_reason: 'SENDER_MISMATCH' })],
      events: [eventRow()],
      matches: [matchRow({ match_status: 'PENDING_REVIEW', reason: 'SENDER_MISMATCH' })],
    });
    await services.payments.approve('proof-1');
    expect(mocks.confirmManually).toHaveBeenCalledWith({ orderId: 'order-1', paymentEventId: 'event-1', paymentProofId: 'proof-1', note: null });
  });

  it('approve refuses an event with several candidate orders', async () => {
    const { services, mocks } = setup({
      events: [eventRow()],
      matches: [
        matchRow({ id: 'm1', order_id: 'order-1', payment_proof_id: null, match_status: 'PENDING_REVIEW', reason: 'MULTIPLE_CANDIDATES' }),
        matchRow({ id: 'm2', order_id: 'order-2', payment_proof_id: null, match_status: 'PENDING_REVIEW', reason: 'MULTIPLE_CANDIDATES' }),
      ],
    });
    expect((await failure(services.payments.approve('event-1'))).reason).toBe('PAYMENT_NOT_CONFIRMABLE');
    expect(mocks.confirmManually).not.toHaveBeenCalled();
  });

  it('reject rejects the proof — a real event can never be rejected', async () => {
    const { services, mocks } = setup({ proofs: [proofRow({ status: 'PENDING_REVIEW' })], events: [eventRow({ id: 'event-9' })] });
    await services.payments.reject('proof-1', '  Comprovativo falso  ');
    expect(mocks.rejectProof).toHaveBeenCalledWith('proof-1', 'Comprovativo falso');
    expect((await failure(services.payments.reject('event-9', 'x'))).code).toBe('CONFLICT');
    expect(mocks.rejectProof).toHaveBeenCalledTimes(1);
    expect((await failure(services.payments.reject('proof-1', '  '))).code).toBe('VALIDATION_ERROR');
  });

  it('listAccounts exposes only active accounts, without credentials', async () => {
    const { services } = setup({ accounts: [accountRow(), accountRow({ id: 'acc-2', status: 'INACTIVE' })] });
    expect(await services.payments.listAccounts()).toEqual([
      { method: 'mpesa', account: '+258840000100', holderName: 'Loja Alfa', monitoredBy: null },
    ]);
  });
});

describe('financial core services (Supabase)', () => {
  it('requires a session', async () => {
    const { services, mocks } = setup({}, null);
    expect((await failure(services.paymentEvents.list())).reason).toBe('SESSION_EXPIRED');
    expect((await failure(services.paymentAccounts.create({ provider: 'MPESA', accountName: 'Loja', accountIdentifier: '840000100' }))).reason).toBe(
      'SESSION_EXPIRED'
    );
    expect(mocks.createAccount).not.toHaveBeenCalled();
  });

  it('creates accounts for the session tenant (never a tenant chosen by the screen)', async () => {
    const { services, mocks } = setup();
    await services.paymentAccounts.create({ provider: 'MPESA', accountName: '  Loja Alfa ', accountIdentifier: ' 84 000 0100 ' });
    expect(mocks.createAccount).toHaveBeenCalledWith({ tenantId: 'tenant-a', provider: 'MPESA', accountName: 'Loja Alfa', accountIdentifier: '84 000 0100' });
  });

  it('validates before the network', async () => {
    const { services, mocks } = setup();
    expect((await failure(services.paymentEvents.record({ paymentAccountId: 'acc-1', transactionId: 'AB', amount: 500 }))).code).toBe('VALIDATION_ERROR');
    expect((await failure(services.paymentEvents.record({ paymentAccountId: 'acc-1', transactionId: 'PP261001.1', amount: 10.555 }))).code).toBe(
      'VALIDATION_ERROR'
    );
    expect((await failure(services.paymentProofs.submit({ provider: 'MPESA' }))).code).toBe('VALIDATION_ERROR');
    expect((await failure(services.paymentProofs.submit({ rawMessage: 'x', extractedData: { pin: '1234' } }))).code).toBe('VALIDATION_ERROR');
    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(mocks.submitProof).not.toHaveBeenCalled();
  });

  it('records events with normalized input', async () => {
    const { services, mocks } = setup();
    const event = await services.paymentEvents.record({ paymentAccountId: 'acc-1', transactionId: ' pp261001.1111.a00001 ', amount: 500 });
    expect(mocks.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ paymentAccountId: 'acc-1', transactionId: 'PP261001.1111.A00001', amount: 500, currency: null, occurredAt: null })
    );
    expect(event.provider).toBe('MPESA');
  });

  it('submits proofs scoped to the order (or to the session tenant without one)', async () => {
    const { services, mocks } = setup();
    await services.paymentProofs.submit({ orderId: 'order-1', provider: 'MPESA', transactionId: 'pp261001.1111.a00001' });
    expect(mocks.submitProof).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 'tenant-a', orderId: 'order-1', transactionId: 'PP261001.1111.A00001' }));
    await services.paymentProofs.submit({ rawMessage: 'Confirmado …', extractedData: { amount: 500 } });
    expect(mocks.submitProof).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: null, extractedData: { amount: 500 } }));
  });

  it('confirms manually with an optional note', async () => {
    const { services, mocks } = setup();
    const match = await services.paymentMatches.confirmManually({ orderId: 'order-1', paymentEventId: 'event-1', note: '  Verificado  ' });
    expect(mocks.confirmManually).toHaveBeenCalledWith({ orderId: 'order-1', paymentEventId: 'event-1', paymentProofId: null, note: 'Verificado' });
    expect(match.methods).toEqual(['MANUAL']);
  });

  it('maps tagged database errors', async () => {
    const { services, mocks } = setup();
    mocks.recordEvent.mockRejectedValueOnce(tagged('23505', 'EVENT_CONFLICT', 'Já existe um movimento com este ID de transação e dados diferentes.'));
    expect(await failure(services.paymentEvents.record({ paymentAccountId: 'acc-1', transactionId: 'PP261001.1', amount: 501 }))).toMatchObject({
      code: 'CONFLICT',
      reason: 'PAYMENT_EVENT_CONFLICT',
    });
    mocks.confirmManually.mockRejectedValueOnce(tagged('55000', 'UNDERPAID', 'Não é possível confirmar: UNDERPAID.'));
    expect(await failure(services.paymentMatches.confirmManually({ orderId: 'order-1', paymentEventId: 'event-1' }))).toMatchObject({
      code: 'CONFLICT',
      reason: 'PAYMENT_NOT_CONFIRMABLE',
      message: 'Não é possível confirmar: O valor recebido é inferior ao valor do pedido.',
    });
    mocks.createAccount.mockRejectedValueOnce(tagged('42501', 'TENANT_SUSPENDED', 'A empresa está suspensa.'));
    expect(
      await failure(services.paymentAccounts.create({ provider: 'EMOLA', accountName: 'Loja', accountIdentifier: '860000200' }))
    ).toMatchObject({ code: 'PERMISSION_DENIED', reason: 'TENANT_SUSPENDED' });
  });

  it('untagged errors keep the generic mapping', () => {
    expect(toPaymentError(new PostgrestError({ code: '42501', message: 'permission denied for table payment_events', details: '', hint: '' }))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});
