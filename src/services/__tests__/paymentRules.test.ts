import { AppError } from '../errors';
import {
  assertValidEventInput,
  assertValidProofInput,
  blockingFailures,
  evaluatePaymentMatch,
  isSafePaymentMetadata,
  normalizeAccountIdentifier,
  normalizeReviewNote,
  normalizeTransactionId,
  resolveMatchWindow,
  sendersCompatible,
  type MatchContext,
  type MatchEventFacts,
  type MatchOrderFacts,
  type MatchProofFacts,
} from '../paymentRules';

/*
 * Same cases as supabase/tests/005_payments.test.sql (sections 2, 5–10): the
 * app's copy of the rules must agree with the database, which stays the only
 * authority that confirms a payment.
 */

describe('normalization (mirrors the SQL helpers)', () => {
  it.each([
    [' pp261001.1111.a00001 ', 'PP261001.1111.A00001'],
    ['abc def 123', 'ABCDEF123'],
    ['9A8B7C6D5E', '9A8B7C6D5E'],
    ['CI251001_ABCD-12', 'CI251001_ABCD-12'],
  ])('transaction ID %p → %p', (raw, expected) => {
    expect(normalizeTransactionId(raw)).toBe(expected);
  });

  it.each(['AB1', '', '-ABC1', 'ABC#123', 'A'.repeat(65)])('rejects transaction ID %p', (raw) => {
    expect(normalizeTransactionId(raw)).toBeNull();
  });

  it.each([
    ['84 000 0100', '+258840000100'],
    ['+258 86 000 0200', '+258860000200'],
    ['Till 171717', 'TILL171717'],
    ['(84) 000-0100', '+258840000100'],
    ['8400000100', '8400000100'],
  ])('account identifier %p → %p (not every identifier is a phone)', (raw, expected) => {
    expect(normalizeAccountIdentifier(raw)).toBe(expected);
  });

  it('rejects invalid account identifiers', () => {
    expect(normalizeAccountIdentifier('!!')).toBeNull();
    expect(normalizeAccountIdentifier('')).toBeNull();
    expect(normalizeAccountIdentifier('AB')).toBeNull();
  });

  it.each([
    ['840000001', '84****001', true],
    ['+258 84 000 0001', '840000001', true],
    ['258840000001', '84xxxx001', true],
    ['00258840000001', '***001', true],
    ['840000001', '86****777', false],
    ['840000001', '840000002', false],
    ['840000001', '****01', null],
    [null, '840000001', null],
    ['840000001', '', null],
  ])('senders %p / %p → %p', (a, b, expected) => {
    expect(sendersCompatible(a, b)).toBe(expected);
  });

  it.each([
    [{}, true],
    [{ note: 'conta principal' }, true],
    [{ shipping: 'x', spinner: 1 }, true],
    [{ pin: '1234' }, false],
    [{ mpesa_pin: '1234' }, false],
    [{ 'PIN Code': '1' }, false],
    [{ mpin: '1' }, false],
    [{ otp: '123456' }, false],
    [{ passcode: '1' }, false],
    [{ apiSecret: 'x' }, false],
    [{ nested: { access_key: 'x' } }, false],
    [{ private_key: 'x' }, false],
    [{ accessToken: 'x' }, false],
    [{ note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ' }, false],
  ])('payment metadata %p safe → %p', (value, expected) => {
    expect(isSafePaymentMetadata(value)).toBe(expected);
  });
});

describe('time window (tenant_settings.payments.match_window)', () => {
  it('defaults per provider', () => {
    expect(resolveMatchWindow(undefined, 'MPESA')).toEqual({ beforeMinutes: 60, afterMinutes: 2880 });
    expect(resolveMatchWindow({}, 'EMOLA')).toEqual({ beforeMinutes: 60, afterMinutes: 2880 });
  });

  it('reads the configured window and ignores invalid values', () => {
    const settings = { match_window: { MPESA: { before_minutes: 5000, after_minutes: -5 }, EMOLA: { before_minutes: 'muito' } } };
    expect(resolveMatchWindow(settings, 'MPESA')).toEqual({ beforeMinutes: 5000, afterMinutes: 2880 });
    expect(resolveMatchWindow(settings, 'EMOLA')).toEqual({ beforeMinutes: 60, afterMinutes: 2880 });
    expect(resolveMatchWindow({ match_window: { MPESA: { before_minutes: 99_999 } } }, 'MPESA').beforeMinutes).toBe(60);
  });
});

describe('evaluatePaymentMatch (deterministic decision table)', () => {
  const CREATED = '2026-10-01T10:00:00.000Z';
  const order = (overrides: Partial<MatchOrderFacts> = {}): MatchOrderFacts => ({
    id: 'order-1',
    tenantId: 'tenant-a',
    status: 'AWAITING_PAYMENT',
    price: 500,
    currency: 'MZN',
    createdAt: CREATED,
    ...overrides,
  });
  const event = (overrides: Partial<MatchEventFacts> = {}): MatchEventFacts => ({
    id: 'event-1',
    tenantId: 'tenant-a',
    provider: 'MPESA',
    transactionId: 'PP261001.1111.A00001',
    amount: 500,
    currency: 'MZN',
    senderIdentifier: '84****001',
    recipientIdentifier: null,
    occurredAt: '2026-10-01T10:05:00.000Z',
    ...overrides,
  });
  const proof = (overrides: Partial<MatchProofFacts> = {}): MatchProofFacts => ({
    id: 'proof-1',
    tenantId: 'tenant-a',
    provider: 'MPESA',
    transactionId: 'PP261001.1111.A00001',
    amount: 500,
    currency: 'MZN',
    senderIdentifier: '840000001',
    recipientIdentifier: '84 000 0100',
    ...overrides,
  });
  const context = (overrides: Partial<MatchContext> = {}): MatchContext => ({
    account: { status: 'ACTIVE', accountIdentifier: '+258840000100' },
    eventAlreadyUsed: false,
    orderAlreadyPaid: false,
    window: { beforeMinutes: 60, afterMinutes: 2880 },
    ...overrides,
  });

  it('confirms proof + event when every rule holds (500 for 500)', () => {
    const result = evaluatePaymentMatch(order(), event(), proof(), context());
    expect(result.decision).toBe('CONFIRMED');
    expect(result.reason).toBeNull();
    expect(result.methods).toEqual(
      expect.arrayContaining(['ORDER_CONTEXT', 'TRANSACTION_ID', 'ACCOUNT', 'AMOUNT', 'SENDER', 'TIME_WINDOW'])
    );
    expect(result.methods).not.toContain('MANUAL');
    expect(result.checks).toMatchObject({ provider: 'PASS', amount: 'PASS', sender: 'PASS', time_window: 'PASS' });
  });

  it('confirms an event without proof (no provider / ID claims to compare)', () => {
    const result = evaluatePaymentMatch(order(), event(), null, context());
    expect(result.decision).toBe('CONFIRMED');
    expect(result.checks.provider).toBeUndefined();
    expect(result.checks.sender).toBe('SKIPPED');
  });

  it.each<[string, () => ReturnType<typeof evaluatePaymentMatch>]>([
    ['UNDERPAID', () => evaluatePaymentMatch(order(), event({ amount: 300 }), proof({ amount: 300 }), context())],
    ['OVERPAID', () => evaluatePaymentMatch(order(), event({ amount: 700 }), proof({ amount: null }), context())],
    ['CURRENCY_MISMATCH', () => evaluatePaymentMatch(order(), event({ currency: 'USD' }), proof({ currency: null }), context())],
    ['PROOF_AMOUNT_MISMATCH', () => evaluatePaymentMatch(order(), event(), proof({ amount: 400 }), context())],
    ['PROVIDER_MISMATCH', () => evaluatePaymentMatch(order(), event(), proof({ provider: 'EMOLA' }), context())],
    ['TRANSACTION_ID_MISMATCH', () => evaluatePaymentMatch(order(), event(), proof({ transactionId: 'PP261001.9999.Z00009' }), context())],
    ['ACCOUNT_INACTIVE', () => evaluatePaymentMatch(order(), event(), proof(), context({ account: { status: 'INACTIVE', accountIdentifier: '+258840000100' } }))],
    ['ACCOUNT_MISMATCH', () => evaluatePaymentMatch(order(), event(), proof({ recipientIdentifier: '84 000 0999' }), context())],
    ['SENDER_MISMATCH', () => evaluatePaymentMatch(order(), event({ senderIdentifier: '86****777' }), proof({ senderIdentifier: '840000008' }), context())],
    ['OUTSIDE_TIME_WINDOW', () => evaluatePaymentMatch(order(), event({ occurredAt: '2026-09-28T10:00:00.000Z' }), proof(), context())],
    ['ORDER_ALREADY_PAID', () => evaluatePaymentMatch(order(), event(), proof(), context({ orderAlreadyPaid: true }))],
    ['ORDER_NOT_PAYABLE', () => evaluatePaymentMatch(order({ status: 'CANCELLED' }), event(), proof(), context())],
  ])('%s → review, never confirmed', (reason, run) => {
    const result = run();
    expect(result.decision).toBe('PENDING_REVIEW');
    expect(result.reason).toBe(reason);
  });

  it('a used event is a DUPLICATE (one event never pays two orders)', () => {
    const result = evaluatePaymentMatch(order(), event(), proof(), context({ eventAlreadyUsed: true }));
    expect(result).toMatchObject({ decision: 'DUPLICATE', reason: 'EVENT_ALREADY_USED', checks: { duplicate: 'FAIL' } });
  });

  it('records from different tenants never match', () => {
    expect(evaluatePaymentMatch(order(), event({ tenantId: 'tenant-b' }), null, context()).decision).toBe('REJECTED');
  });

  it('compares money in cents (no floating point surprises)', () => {
    expect(evaluatePaymentMatch(order({ price: 0.3 }), event({ amount: 0.1 + 0.2 }), null, context()).decision).toBe('CONFIRMED');
  });

  it('only a time-window or sender doubt can be accepted manually', () => {
    const sender = evaluatePaymentMatch(order(), event({ senderIdentifier: '86****777' }), proof({ senderIdentifier: '840000008' }), context());
    expect(blockingFailures(sender)).toEqual([]);
    const underpaid = evaluatePaymentMatch(order(), event({ amount: 300 }), null, context());
    expect(blockingFailures(underpaid)).toEqual(['UNDERPAID']);
    const used = evaluatePaymentMatch(order(), event(), null, context({ eventAlreadyUsed: true }));
    expect(blockingFailures(used)).toEqual(['EVENT_ALREADY_USED']);
  });
});

describe('input validation', () => {
  const NOW = Date.parse('2026-10-01T12:00:00.000Z');

  it('normalizes a manual event', () => {
    expect(
      assertValidEventInput(
        { paymentAccountId: 'acc-1', transactionId: ' pp261001.1111.a00001 ', amount: 500, currency: 'mzn', senderIdentifier: '  ' },
        NOW
      )
    ).toMatchObject({ transactionId: 'PP261001.1111.A00001', amount: 500, currency: 'MZN', senderIdentifier: null, occurredAt: null });
  });

  it.each([
    [{ transactionId: 'AB', amount: 500 }],
    [{ transactionId: 'PP261001.0000.Z00001', amount: 0 }],
    [{ transactionId: 'PP261001.0000.Z00002', amount: 10.555 }],
    [{ transactionId: 'PP261001.0000.Z00003', amount: -500 }],
    [{ transactionId: 'PP261001.0000.Z00004', amount: 500, occurredAt: '2026-10-02T12:00:00.000Z' }],
    [{ transactionId: 'PP261001.0000.Z00005', amount: 500, currency: 'MT' }],
  ])('rejects invalid event %p', (input) => {
    expect(() => assertValidEventInput({ paymentAccountId: 'acc-1', ...input }, NOW)).toThrow(AppError);
  });

  it('a proof needs a transaction ID or the original message', () => {
    expect(() => assertValidProofInput({ provider: 'MPESA' })).toThrow('Indique o ID da transação');
    expect(assertValidProofInput({ rawMessage: ' Confirmado … ' })).toMatchObject({ transactionId: null, rawMessage: 'Confirmado …' });
  });

  it('refuses PINs / tokens in AI-extracted data', () => {
    expect(() => assertValidProofInput({ rawMessage: 'x', extractedData: { pin: '1234' } })).toThrow(AppError);
    expect(() => assertValidProofInput({ rawMessage: 'x', extractedData: { access_token: 'abc' } })).toThrow(AppError);
  });

  it('requires a rejection reason', () => {
    expect(() => normalizeReviewNote('   ', { required: true })).toThrow('Indique o motivo.');
    expect(normalizeReviewNote(null, { required: false })).toBeNull();
    expect(() => normalizeReviewNote('x'.repeat(501), { required: false })).toThrow(AppError);
  });
});
