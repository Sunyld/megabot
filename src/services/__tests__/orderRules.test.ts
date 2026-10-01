import type { OrderStatus } from '@/types';

import { AppError } from '../errors';
import {
  assertValidCreateOrderInput,
  canTransition,
  newIdempotencyKey,
  normalizeCancelReason,
  normalizePhone,
  ORDER_RULES,
  ORDER_STATUSES,
  validateCreateOrderInput,
} from '../orderRules';

/* Same cases as supabase/tests/004_orders.test.sql (sections 2 and 3). */

describe('normalizePhone (mirrors private.normalize_phone)', () => {
  it.each([
    ['840000001', '+258840000001'],
    ['84 000 0001', '+258840000001'],
    ['84-000-0001', '+258840000001'],
    ['(84) 000.0001', '+258840000001'],
    ['+258 84 000 0001', '+258840000001'],
    ['00258840000001', '+258840000001'],
    ['258840000001', '+258840000001'],
    ['820000001', '+258820000001'],
    ['830000001', '+258830000001'],
    ['850000001', '+258850000001'],
    ['860000001', '+258860000001'],
    ['870000001', '+258870000001'],
    ['+27821234567', '+27821234567'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['810000001', '880000001', '84000000', '8400000011', '+25884000000', '+258840000001234', 'abc', '', '+0840000001', '840000001a', '+2589'])(
    'rejects %s',
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    }
  );

  it('rejects null / undefined', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('order state machine (mirrors private.order_status_transition_allowed)', () => {
  const allowed = [
    'PENDING>AWAITING_PAYMENT', 'PENDING>CANCELLED', 'PENDING>EXPIRED',
    'AWAITING_PAYMENT>VERIFYING', 'AWAITING_PAYMENT>PAID', 'AWAITING_PAYMENT>CANCELLED', 'AWAITING_PAYMENT>EXPIRED',
    'VERIFYING>PAID', 'VERIFYING>AWAITING_PAYMENT', 'VERIFYING>CANCELLED',
    'PAID>READY_FOR_ACTIVATION',
    'READY_FOR_ACTIVATION>ACTIVATING', 'READY_FOR_ACTIVATION>FAILED',
    'ACTIVATING>COMPLETED', 'ACTIVATING>FAILED',
    'FAILED>READY_FOR_ACTIVATION', 'FAILED>CANCELLED',
  ];

  it('allows exactly the 17 transitions of the database', () => {
    const actual: string[] = [];
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) if (canTransition(from, to)) actual.push(`${from}>${to}`);
    }
    expect(actual.sort()).toEqual([...allowed].sort());
  });

  it.each<[OrderStatus, OrderStatus]>([
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'PAID'],
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'PENDING'],
    ['EXPIRED', 'AWAITING_PAYMENT'],
    ['PAID', 'CANCELLED'],
  ])('refuses %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('create order input', () => {
  it('validates product, phone and name', () => {
    expect(validateCreateOrderInput({ productId: 'p1', customerPhone: '84 000 0001' })).toEqual({});
    const errors = validateCreateOrderInput({ productId: '', customerPhone: '810000001', customerName: 'x'.repeat(81) });
    expect(Object.keys(errors).sort()).toEqual(['customerName', 'customerPhone', 'productId']);
  });

  it('normalizes the phone and trims the name', () => {
    expect(assertValidCreateOrderInput({ productId: 'p1', customerPhone: '84 000 0001', customerName: '  João  ' })).toMatchObject({
      customerPhone: '+258840000001',
      customerName: 'João',
    });
    expect(assertValidCreateOrderInput({ productId: 'p1', customerPhone: '840000001', customerName: '   ' }).customerName).toBeNull();
  });

  it('throws INVALID_PHONE for an invalid number', () => {
    expect(() => assertValidCreateOrderInput({ productId: 'p1', customerPhone: '123' })).toThrow(AppError);
    try {
      assertValidCreateOrderInput({ productId: 'p1', customerPhone: '123' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', reason: 'INVALID_PHONE' });
    }
  });

  it('generates idempotency keys accepted by the database', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(ORDER_RULES.idempotencyKeyPattern);
    expect(a).not.toBe(b);
  });

  it('limits the cancellation reason', () => {
    expect(normalizeCancelReason('  Desistiu ')).toBe('Desistiu');
    expect(normalizeCancelReason('  ')).toBeNull();
    expect(() => normalizeCancelReason('x'.repeat(501))).toThrow(AppError);
  });
});
