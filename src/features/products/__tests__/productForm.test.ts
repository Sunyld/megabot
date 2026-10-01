import type { Product } from '@/types';

import {
  draftFromProduct,
  draftToFlow,
  draftToInput,
  emptyDraft,
  hasErrors,
  newStep,
  parseDecimal,
  validateDraft,
  type ProductDraft,
} from '../productForm';

const product: Product = {
  id: 'product-1',
  tenantId: 'tenant-a',
  name: 'Internet 5GB',
  description: 'Mensal',
  category: 'monthly',
  price: 499.5,
  currency: 'MZN',
  dataAmount: 5,
  dataUnit: 'GB',
  validityHours: 720,
  operator: 'vodacom',
  status: 'ACTIVE',
  ussdFlow: {
    version: 1,
    start: '*111#',
    steps: [
      { type: 'select', value: '5', label: 'Pacotes', expect: { contains: ['Pacotes'] } },
      { type: 'input', source: 'destination_number' },
      { type: 'wait', ms: 1500 },
      { type: 'confirm' },
    ],
    success: { contains: ['sucesso', 'activado'] },
  },
  archivedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  soldToday: 0,
};

const filled = (overrides: Partial<ProductDraft> = {}): ProductDraft => ({
  ...emptyDraft('MZN'),
  name: 'Internet 1GB',
  price: '24,50',
  dataAmount: '1',
  dataUnit: 'GB',
  ussdStart: '*111#',
  ussdSteps: [{ ...newStep('select'), value: '5' }, { ...newStep('input'), source: 'destination_number' }, newStep('confirm')],
  ...overrides,
});

describe('parseDecimal', () => {
  it('accepts comma or dot decimals and rejects anything else', () => {
    expect(parseDecimal('24,50')).toBe(24.5);
    expect(parseDecimal(' 500 ')).toBe(500);
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('12a')).toBeNaN();
    expect(parseDecimal('-5')).toBeNaN();
  });
});

describe('product form draft', () => {
  it('round-trips a product without losing flow details (labels, expected texts)', () => {
    const draft = draftFromProduct(product);
    expect(draft).toMatchObject({ price: '499,5', dataAmount: '5', active: true, ussdStart: '*111#', successTexts: 'sucesso; activado' });
    expect(draftToInput(draft)).toEqual({
      name: 'Internet 5GB',
      description: 'Mensal',
      category: 'monthly',
      price: 499.5,
      currency: 'MZN',
      dataAmount: 5,
      dataUnit: 'GB',
      validityHours: 720,
      operator: 'vodacom',
      status: 'ACTIVE',
      ussdFlow: product.ussdFlow,
    });
  });

  it('starts new products as not for sale, with a typical flow skeleton', () => {
    const draft = emptyDraft('MZN');
    expect(draft.active).toBe(false);
    expect(draft.ussdSteps.map((s) => s.type)).toEqual(['select', 'input', 'confirm']);
  });

  it('builds the flow from the steps; no flow when USSD is disabled', () => {
    expect(draftToFlow(filled())).toEqual({
      version: 1,
      start: '*111#',
      steps: [{ type: 'select', value: '5' }, { type: 'input', source: 'destination_number' }, { type: 'confirm', value: '1' }],
    });
    expect(draftToFlow(filled({ ussdEnabled: false }))).toBeNull();
  });

  it('validates the whole form and maps USSD issues to the right step', () => {
    expect(hasErrors(validateDraft(filled()).errors)).toBe(false);

    const { errors } = validateDraft(
      filled({ name: '', price: '0', ussdStart: '111', ussdSteps: [{ ...newStep('select'), value: '' }, newStep('confirm')] })
    );
    expect(errors.name).toBeDefined();
    expect(errors.price).toBeDefined();
    expect(errors.ussdStart).toBeDefined();
    expect(errors.steps?.[0]).toBeDefined();
    expect(errors.steps?.[1]).toBeUndefined();
  });

  it('blocks selling a product without USSD', () => {
    const { errors } = validateDraft(filled({ active: true, ussdEnabled: false }));
    expect(errors.ussd).toMatch(/USSD/);
  });

  it('lets unlimited plans omit the data volume', () => {
    const { input, errors } = validateDraft(filled({ category: 'unlimited', dataAmount: '' }));
    expect(errors).toEqual({});
    expect(input).toMatchObject({ dataAmount: null, dataUnit: null });
  });
});
