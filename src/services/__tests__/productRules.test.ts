import type { ProductInput } from '@/types';

import { AppError } from '../errors';
import { assertValidProductInput, normalizeProductInput, validateProductInput } from '../productRules';

const flow = { version: 1 as const, start: '*111#', steps: [{ type: 'confirm' as const }] };

const valid = (overrides: Partial<ProductInput> = {}): ProductInput => ({
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
  ...overrides,
});

describe('validateProductInput (mirrors the products table constraints)', () => {
  it('accepts a complete product and an unlimited plan without volume', () => {
    expect(validateProductInput(valid())).toEqual({});
    expect(validateProductInput(valid({ category: 'unlimited', dataAmount: null, dataUnit: null }))).toEqual({});
  });

  it('rejects prices that are not positive money values', () => {
    expect(validateProductInput(valid({ price: 0 })).price).toBeDefined();
    expect(validateProductInput(valid({ price: -5 })).price).toBeDefined();
    expect(validateProductInput(valid({ price: Number.NaN })).price).toBeDefined();
    expect(validateProductInput(valid({ price: 10.555 })).price).toBeDefined();
    expect(validateProductInput(valid({ price: 10.5 })).price).toBeUndefined();
  });

  it('requires a data volume (with unit) except for unlimited plans', () => {
    expect(validateProductInput(valid({ dataAmount: null, dataUnit: null })).dataAmount).toBeDefined();
    expect(validateProductInput(valid({ dataUnit: null })).dataAmount).toBeDefined();
    expect(validateProductInput(valid({ dataAmount: 0 })).dataAmount).toBeDefined();
  });

  it('validates name, currency, validity and operator', () => {
    expect(validateProductInput(valid({ name: ' x ' })).name).toBeDefined();
    expect(validateProductInput(valid({ currency: 'MT' })).currency).toBeDefined();
    expect(validateProductInput(valid({ validityHours: 0 })).validityHours).toBeDefined();
    expect(validateProductInput(valid({ validityHours: 1.5 })).validityHours).toBeDefined();
  });

  it('only sells products that have a valid USSD flow', () => {
    expect(validateProductInput(valid({ ussdFlow: null })).ussdFlow).toMatch(/USSD/);
    expect(validateProductInput(valid({ ussdFlow: null, status: 'INACTIVE' }))).toEqual({});
    const broken = { ...flow, start: 'abc' };
    expect(validateProductInput(valid({ ussdFlow: broken })).ussdFlow).toMatch(/Código USSD/);
  });
});

describe('normalizeProductInput / assertValidProductInput', () => {
  it('trims text, uppercases the currency and drops the unit without volume', () => {
    expect(
      normalizeProductInput(valid({ name: '  Internet 5GB ', description: '  ', currency: ' mzn ', category: 'unlimited', dataAmount: null }))
    ).toMatchObject({ name: 'Internet 5GB', description: null, currency: 'MZN', dataUnit: null });
  });

  it('throws a VALIDATION_ERROR with the first problem', () => {
    expect(() => assertValidProductInput(valid({ price: 0 }))).toThrow(AppError);
    try {
      assertValidProductInput(valid({ price: 0 }));
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', reason: 'INVALID_PRODUCT' });
    }
  });
});
