import { AppError } from '../errors';
import { serviceContext } from '../context';
import { mockOrdersService as orders } from '../mock/orders';
import {
  mockPaymentAccountsService as accounts,
  mockPaymentEventsService as events,
  mockPaymentMatchesService as matches,
  mockPaymentProofsService as proofs,
} from '../mock/reconciliation';
import { setSimulation } from '../mock/simulation';

/*
 * Mock mode follows the same deterministic reconciliation as migration 005,
 * so the demo never shows a behaviour the real backend would refuse.
 * prd_m20 (700 MZN) and prd_u_day (100 MZN) have no open demo orders, so the
 * candidates below are only the orders these tests create.
 */

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

let tx = 0;
const nextTx = () => `MK261001.${String(++tx).padStart(4, '0')}.T`;

describe('mock financial core (same rules as migration 005)', () => {
  let mpesa: string;

  beforeAll(async () => {
    setSimulation({ latency: 'instant', failRequests: false, offline: false, emptyData: false });
    serviceContext.setTenant('tnt_megabot_demo');
    mpesa = (await accounts.list()).find((a) => a.provider === 'MPESA' && a.status === 'ACTIVE')!.id;
  });
  afterAll(() => {
    serviceContext.setTenant(null);
    setSimulation({ latency: 'realistic' });
  });

  it('demo receiving accounts have no credentials', async () => {
    const list = await accounts.list();
    expect(list.map((a) => a.provider).sort()).toEqual(['EMOLA', 'MPESA']);
    list.forEach((a) => expect(Object.keys(a).sort()).toEqual(['accountIdentifier', 'accountName', 'createdAt', 'id', 'provider', 'status', 'tenantId', 'updatedAt']));
  });

  it('proof without event: UNMATCHED, order VERIFYING, never PAID; the event then confirms', async () => {
    const order = await orders.create({ productId: 'prd_m20', customerPhone: '840000001' });
    const id = nextTx();
    const proof = await proofs.submit({
      orderId: order.id,
      provider: 'MPESA',
      transactionId: id.toLowerCase(),
      amount: 700,
      senderIdentifier: '84 000 0001',
    });
    expect(proof).toMatchObject({ status: 'UNMATCHED', statusReason: 'NO_EVENT_YET', transactionId: id });
    expect((await orders.get(order.id)).status).toBe('VERIFYING');
    expect(await matches.list({ orderId: order.id })).toEqual([]);

    await events.record({ paymentAccountId: mpesa, transactionId: id, amount: 700, senderIdentifier: '84****001' });
    expect((await proofs.get(proof.id)).status).toBe('CONFIRMED');
    expect((await orders.get(order.id)).status).toBe('PAID');
    const [match] = await matches.list({ orderId: order.id });
    expect(match).toMatchObject({ status: 'CONFIRMED', paymentProofId: proof.id });
    expect(match.methods).toEqual(expect.arrayContaining(['TRANSACTION_ID', 'AMOUNT', 'ACCOUNT', 'SENDER', 'TIME_WINDOW']));
  });

  it('underpaid / overpaid go to review; a person can never accept a wrong amount', async () => {
    for (const [amount, reason] of [
      [300, 'UNDERPAID'],
      [900, 'OVERPAID'],
    ] as const) {
      const order = await orders.create({ productId: 'prd_m20', customerPhone: '850000002' });
      const id = nextTx();
      const event = await events.record({ paymentAccountId: mpesa, transactionId: id, amount });
      const proof = await proofs.submit({ orderId: order.id, provider: 'MPESA', transactionId: id });
      expect(proof).toMatchObject({ status: 'PENDING_REVIEW', statusReason: reason });
      expect((await orders.get(order.id)).status).toBe('VERIFYING');
      expect((await failure(matches.confirmManually({ orderId: order.id, paymentEventId: event.id, paymentProofId: proof.id }))).reason).toBe(
        'PAYMENT_NOT_CONFIRMABLE'
      );
    }
  });

  it('the provider is explicit: an e-Mola claim never uses an M-Pesa event', async () => {
    const order = await orders.create({ productId: 'prd_m20', customerPhone: '850000003' });
    const id = nextTx();
    await events.record({ paymentAccountId: mpesa, transactionId: id, amount: 700 });
    const proof = await proofs.submit({ orderId: order.id, provider: 'EMOLA', transactionId: id });
    expect(proof).toMatchObject({ status: 'UNMATCHED', statusReason: 'NO_EVENT_YET' });
  });

  it('one event never pays two orders', async () => {
    const first = await orders.create({ productId: 'prd_m20', customerPhone: '850000004' });
    const second = await orders.create({ productId: 'prd_m20', customerPhone: '850000005' });
    const id = nextTx();
    const event = await events.record({ paymentAccountId: mpesa, transactionId: id, amount: 700 });
    expect((await proofs.submit({ orderId: first.id, provider: 'MPESA', transactionId: id })).status).toBe('CONFIRMED');
    expect(await proofs.submit({ orderId: second.id, provider: 'MPESA', transactionId: id })).toMatchObject({
      status: 'DUPLICATE',
      statusReason: 'EVENT_ALREADY_USED',
    });
    expect((await orders.get(second.id)).status).not.toBe('PAID');
    await failure(matches.confirmManually({ orderId: second.id, paymentEventId: event.id }));
    expect((await matches.list({ paymentEventId: event.id })).filter((m) => m.status === 'CONFIRMED')).toHaveLength(1);
  });

  it('events are idempotent; different data under the same ID is a conflict', async () => {
    const id = nextTx();
    const event = await events.record({ paymentAccountId: mpesa, transactionId: id, amount: 55 });
    expect((await events.record({ paymentAccountId: mpesa, transactionId: ` ${id.toLowerCase()} `, amount: 55 })).id).toBe(event.id);
    expect((await failure(events.record({ paymentAccountId: mpesa, transactionId: id, amount: 56 }))).reason).toBe('PAYMENT_EVENT_CONFLICT');
  });

  it('event without proof: automatic only for one order with the full sender = customer phone', async () => {
    const auto = await orders.create({ productId: 'prd_u_day', customerPhone: '870000010' });
    await events.record({ paymentAccountId: mpesa, transactionId: nextTx(), amount: 100, senderIdentifier: '+258 87 000 0010' });
    expect((await orders.get(auto.id)).status).toBe('PAID');

    const masked = await orders.create({ productId: 'prd_u_day', customerPhone: '870000011' });
    const event = await events.record({ paymentAccountId: mpesa, transactionId: nextTx(), amount: 100, senderIdentifier: '87****011' });
    expect((await orders.get(masked.id)).status).toBe('PENDING');
    expect(await matches.list({ paymentEventId: event.id })).toEqual([
      expect.objectContaining({ status: 'PENDING_REVIEW', reason: 'SENDER_NOT_VERIFIED', orderId: masked.id }),
    ]);
    const decision = await matches.confirmManually({ orderId: masked.id, paymentEventId: event.id, note: 'Verificado com o cliente' });
    expect(decision).toMatchObject({ status: 'CONFIRMED', reason: 'CONFIRMED_MANUALLY' });
    expect(decision.methods).toContain('MANUAL');
    expect((await orders.get(masked.id)).status).toBe('PAID');
  });

  it('AI-extracted data never confirms', async () => {
    const order = await orders.create({ productId: 'prd_m20', customerPhone: '850000006' });
    const id = nextTx();
    await events.record({ paymentAccountId: mpesa, transactionId: id, amount: 700, senderIdentifier: '84****999' });
    const proof = await proofs.submit({
      orderId: order.id,
      rawMessage: `Confirmado ${id}. Transferiste 700.00MT.`,
      extractedData: { transaction_id: id, amount: 700, provider: 'MPESA', confidence: 0.99 },
    });
    expect(proof).toMatchObject({ status: 'UNMATCHED', statusReason: 'TRANSACTION_ID_REQUIRED' });
    expect((await orders.get(order.id)).status).toBe('VERIFYING');
  });

  it('rejection is final and sends the order back to AWAITING_PAYMENT', async () => {
    const order = await orders.create({ productId: 'prd_m20', customerPhone: '850000007' });
    const proof = await proofs.submit({ orderId: order.id, provider: 'MPESA', transactionId: nextTx() });
    expect((await failure(proofs.reject(proof.id, '  '))).code).toBe('VALIDATION_ERROR');
    expect(await proofs.reject(proof.id, 'Comprovativo não corresponde')).toMatchObject({ status: 'REJECTED', reviewNote: 'Comprovativo não corresponde' });
    expect((await orders.get(order.id)).status).toBe('AWAITING_PAYMENT');
    expect((await failure(proofs.reject(proof.id, 'De novo'))).reason).toBe('PROOF_ALREADY_DECIDED');
    expect((await proofs.reconcile(proof.id)).status).toBe('REJECTED');
  });

  it('inactive accounts never confirm', async () => {
    const created = await accounts.create({ provider: 'EMOLA', accountName: 'Conta Teste', accountIdentifier: '86 000 0900' });
    await accounts.update(created.id, { status: 'INACTIVE' });
    const order = await orders.create({ productId: 'prd_m20', customerPhone: '850000008' });
    const id = nextTx();
    await events.record({ paymentAccountId: created.id, transactionId: id, amount: 700 });
    expect(await proofs.submit({ orderId: order.id, provider: 'EMOLA', transactionId: id })).toMatchObject({
      status: 'PENDING_REVIEW',
      statusReason: 'ACCOUNT_INACTIVE',
    });
    expect((await failure(accounts.create({ provider: 'EMOLA', accountName: 'Duplicada', accountIdentifier: '+258 86 000 0900' }))).reason).toBe(
      'PAYMENT_ACCOUNT_EXISTS'
    );
  });
});
