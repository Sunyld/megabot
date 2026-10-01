import type { UssdFlow } from '@/types';
import { describeUssdFlow, ussdValuesFor } from '@/utils/ussd';

import { isUssdFlow, parseUssdFlow, validateUssdFlow } from '../ussdFlow';

/*
 * Same cases as supabase/tests/003_products.test.sql (section 2): the client
 * validator must accept and reject exactly what private.ussd_flow_is_valid does.
 */

const reference: UssdFlow = {
  version: 1,
  start: '*111#',
  steps: [
    { type: 'select', value: '5' },
    { type: 'select', value: '8' },
    { type: 'select', value: '2' },
    { type: 'input', source: 'destination_number' },
    { type: 'input', source: 'amount_mb' },
    { type: 'confirm' },
  ],
};

const rich: UssdFlow = {
  version: 1,
  start: '*123*1#',
  steps: [
    { type: 'select', value: '3', label: 'Pacotes', expect: { contains: ['Pacotes'] } },
    { type: 'input', source: 'destination_number', label: 'Número' },
    { type: 'wait', ms: 1500 },
    { type: 'confirm', value: '1', expect: { contains: ['Confirmar', 'Confirma'] } },
  ],
  success: { contains: ['sucesso'] },
  failure: { contains: ['saldo insuficiente', 'erro'] },
};

const invalid: [string, unknown][] = [
  ['empty object', {}],
  ['array', []],
  ['string', '*111#'],
  ['no start', { version: 1, steps: [{ type: 'confirm' }] }],
  ['no steps', { version: 1, start: '*111#' }],
  ['empty steps', { version: 1, start: '*111#', steps: [] }],
  ['unknown version', { version: 2, start: '*111#', steps: [{ type: 'confirm' }] }],
  ['version as text', { version: '1', start: '*111#', steps: [{ type: 'confirm' }] }],
  ['no version', { start: '*111#', steps: [{ type: 'confirm' }] }],
  ['bad start code', { version: 1, start: '111', steps: [{ type: 'confirm' }] }],
  ['start with garbage', { version: 1, start: '*111#; rm -rf', steps: [{ type: 'confirm' }] }],
  ['unknown step type', { version: 1, start: '*111#', steps: [{ type: 'dance' }] }],
  ['select without value', { version: 1, start: '*111#', steps: [{ type: 'select' }] }],
  ['non-USSD select value', { version: 1, start: '*111#', steps: [{ type: 'select', value: 'abc' }] }],
  ['numeric select value', { version: 1, start: '*111#', steps: [{ type: 'select', value: 5 }] }],
  ['input without source', { version: 1, start: '*111#', steps: [{ type: 'input' }] }],
  ['unknown source', { version: 1, start: '*111#', steps: [{ type: 'input', source: 'pin' }] }],
  ['bad confirm value', { version: 1, start: '*111#', steps: [{ type: 'confirm', value: 'sim' }] }],
  ['wait too short', { version: 1, start: '*111#', steps: [{ type: 'wait', ms: 50 }] }],
  ['wait not integer', { version: 1, start: '*111#', steps: [{ type: 'wait', ms: 1500.5 }] }],
  ['wait without ms', { version: 1, start: '*111#', steps: [{ type: 'wait' }] }],
  ['step not an object', { version: 1, start: '*111#', steps: ['5'] }],
  ['unknown step key', { version: 1, start: '*111#', steps: [{ type: 'confirm', command: 'x' }] }],
  ['unknown top key', { version: 1, start: '*111#', steps: [{ type: 'confirm' }], script: 'x' }],
  ['empty expect', { version: 1, start: '*111#', steps: [{ type: 'confirm', expect: { contains: [] } }] }],
  ['regex success', { version: 1, start: '*111#', steps: [{ type: 'confirm' }], success: { regex: 'ok' } }],
  ['label too long', { version: 1, start: '*111#', steps: [{ type: 'confirm', label: 'x'.repeat(81) }] }],
  ['31 steps', { version: 1, start: '*111#', steps: Array.from({ length: 31 }, () => ({ type: 'confirm' })) }],
  ['null', null],
];

describe('validateUssdFlow', () => {
  it('accepts the reference flow and a flow using every v1 feature', () => {
    expect(validateUssdFlow(reference)).toEqual([]);
    expect(validateUssdFlow(rich)).toEqual([]);
    expect(isUssdFlow({ version: 1, start: '#150#', steps: [{ type: 'input', source: 'amount_gb' }] })).toBe(true);
  });

  it.each(invalid)('rejects %s', (_label, flow) => {
    expect(validateUssdFlow(flow).length).toBeGreaterThan(0);
    expect(isUssdFlow(flow)).toBe(false);
  });

  it('points at the step and field that are wrong', () => {
    const issues = validateUssdFlow({
      version: 1,
      start: '*111#',
      steps: [{ type: 'select', value: '5' }, { type: 'select', value: '' }, { type: 'wait', ms: 10 }],
    });
    expect(issues.map((issue) => issue.path)).toEqual(['steps.1.value', 'steps.2.ms']);
  });

  it('ignores optional keys explicitly set to undefined (JSON drops them)', () => {
    expect(isUssdFlow({ version: 1, start: '*111#', steps: [{ type: 'confirm', value: undefined, label: undefined }] })).toBe(true);
  });
});

describe('parseUssdFlow', () => {
  it('returns the flow when valid and null otherwise (fail closed)', () => {
    expect(parseUssdFlow(reference)).toEqual(reference);
    expect(parseUssdFlow({ version: 1, start: '*111#', steps: [{ type: 'hack' }] })).toBeNull();
    expect(parseUssdFlow(null)).toBeNull();
  });
});

describe('describeUssdFlow', () => {
  it('renders the flow as one line with placeholders for run-time values', () => {
    expect(describeUssdFlow(reference)).toBe('*111# › 5 › 8 › 2 › {Número do cliente} › {Quantidade (MB)} › 1');
    expect(describeUssdFlow(rich)).toBe('*123*1# › 3 › {Número do cliente} › ⏱ 1,5 s › 1');
  });

  it('fills known values (an order\'s destination, the product volume)', () => {
    const values = ussdValuesFor({ dataAmount: 5, dataUnit: 'GB', price: 499.99 }, '840000001');
    expect(values).toEqual({ destination_number: '840000001', amount_mb: '5120', amount_gb: '5', price: '499.99' });
    expect(describeUssdFlow(reference, values)).toBe('*111# › 5 › 8 › 2 › 840000001 › 5120 › 1');
  });

  it('has no data amounts for unlimited plans', () => {
    expect(ussdValuesFor({ dataAmount: null, dataUnit: null, price: 25 })).toEqual({ price: '25' });
  });
});
