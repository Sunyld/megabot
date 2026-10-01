/**
 * Product form state (strings as typed by the user) ↔ ProductInput / UssdFlow.
 * Pure functions: the screen holds the draft, these convert and validate it
 * with the same rules the services and the database apply.
 */
import { validateProductInput, type ProductFieldErrors } from '@/services/productRules';
import { validateUssdFlow } from '@/services/ussdFlow';
import type {
  DataUnit,
  Operator,
  Product,
  ProductCategory,
  ProductInput,
  UssdFlow,
  UssdInputSource,
  UssdStep,
  UssdStepType,
  UssdTextMatch,
} from '@/types';

export type UssdStepDraft = {
  key: string;
  type: UssdStepType;
  /** select / confirm */
  value: string;
  /** input */
  source: UssdInputSource;
  /** wait */
  seconds: string;
  /** Not edited in the form, preserved as-is. */
  label?: string;
  expect?: UssdTextMatch;
};

export type ProductDraft = {
  name: string;
  description: string;
  category: ProductCategory;
  price: string;
  currency: string;
  dataAmount: string;
  dataUnit: DataUnit;
  validityHours: string;
  operator: Operator;
  active: boolean;
  ussdEnabled: boolean;
  ussdStart: string;
  ussdSteps: UssdStepDraft[];
  /** Texts separated by ';'. */
  successTexts: string;
  failureTexts: string;
};

export type ProductFormErrors = ProductFieldErrors & {
  ussdStart?: string;
  /** Step index → message. */
  steps?: Record<number, string>;
  /** Flow-level problems (no steps, success/failure texts, status without flow). */
  ussd?: string;
};

let keySeed = 0;
const nextKey = () => `step-${Date.now().toString(36)}-${(keySeed += 1)}`;

export function newStep(type: UssdStepType = 'select'): UssdStepDraft {
  return { key: nextKey(), type, value: type === 'confirm' ? '1' : '', source: 'destination_number', seconds: '2' };
}

/** Starting point for a new product: the common "menu → number → confirm" shape. */
export function emptyDraft(currency: string): ProductDraft {
  return {
    name: '',
    description: '',
    category: 'daily',
    price: '',
    currency,
    dataAmount: '',
    dataUnit: 'MB',
    validityHours: '24',
    operator: 'vodacom',
    active: false,
    ussdEnabled: true,
    ussdStart: '',
    ussdSteps: [newStep('select'), { ...newStep('input'), source: 'destination_number' }, newStep('confirm')],
    successTexts: '',
    failureTexts: '',
  };
}

const formatNumberText = (value: number) => String(value).replace('.', ',');

function stepToDraft(step: UssdStep): UssdStepDraft {
  const base = { ...newStep(step.type), label: step.label };
  switch (step.type) {
    case 'select':
      return { ...base, value: step.value, expect: step.expect };
    case 'input':
      return { ...base, source: step.source, expect: step.expect };
    case 'confirm':
      return { ...base, value: step.value ?? '', expect: step.expect };
    case 'wait':
      return { ...base, seconds: formatNumberText(step.ms / 1000) };
  }
}

export function draftFromProduct(product: Product): ProductDraft {
  const flow = product.ussdFlow;
  return {
    name: product.name,
    description: product.description ?? '',
    category: product.category,
    price: formatNumberText(product.price),
    currency: product.currency,
    dataAmount: product.dataAmount === null ? '' : formatNumberText(product.dataAmount),
    dataUnit: product.dataUnit ?? 'MB',
    validityHours: String(product.validityHours),
    operator: product.operator,
    active: product.status === 'ACTIVE',
    ussdEnabled: flow !== null,
    ussdStart: flow?.start ?? '',
    ussdSteps: flow ? flow.steps.map(stepToDraft) : emptyDraft(product.currency).ussdSteps,
    successTexts: flow?.success?.contains.join('; ') ?? '',
    failureTexts: flow?.failure?.contains.join('; ') ?? '',
  };
}

/** "24,50" / "24.5" → 24.5; anything else → NaN (rejected by validation). */
export function parseDecimal(text: string): number {
  const normalized = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

const parseInteger = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

function toTextMatch(text: string): UssdTextMatch | undefined {
  const contains = text
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
  return contains.length ? { contains } : undefined;
}

function draftToStep(step: UssdStepDraft): UssdStep {
  const extras = {
    ...(step.label ? { label: step.label } : {}),
    ...(step.expect && step.type !== 'wait' ? { expect: step.expect } : {}),
  };
  switch (step.type) {
    case 'select':
      return { type: 'select', value: step.value.trim(), ...extras };
    case 'input':
      return { type: 'input', source: step.source, ...extras };
    case 'confirm':
      return step.value.trim() ? { type: 'confirm', value: step.value.trim(), ...extras } : { type: 'confirm', ...extras };
    case 'wait':
      return { type: 'wait', ms: Math.round(parseDecimal(step.seconds) * 1000), ...extras };
  }
}

/** The flow as it will be saved; `null` when USSD is not configured. */
export function draftToFlow(draft: ProductDraft): UssdFlow | null {
  if (!draft.ussdEnabled) return null;
  const success = toTextMatch(draft.successTexts);
  const failure = toTextMatch(draft.failureTexts);
  return {
    version: 1,
    start: draft.ussdStart.trim(),
    steps: draft.ussdSteps.map(draftToStep),
    ...(success ? { success } : {}),
    ...(failure ? { failure } : {}),
  };
}

export function draftToInput(draft: ProductDraft): ProductInput {
  const dataAmount = draft.dataAmount.trim() === '' ? null : parseDecimal(draft.dataAmount);
  return {
    name: draft.name,
    description: draft.description.trim() || null,
    category: draft.category,
    price: parseDecimal(draft.price),
    currency: draft.currency,
    dataAmount,
    dataUnit: dataAmount === null ? null : draft.dataUnit,
    validityHours: parseInteger(draft.validityHours),
    operator: draft.operator,
    status: draft.active ? 'ACTIVE' : 'INACTIVE',
    ussdFlow: draftToFlow(draft),
  };
}

/** Converts and validates the whole form; `errors` is empty when it can be saved. */
export function validateDraft(draft: ProductDraft): { input: ProductInput; errors: ProductFormErrors } {
  const input = draftToInput(draft);
  const { ussdFlow: flowError, ...errors }: ProductFormErrors = validateProductInput(input);

  const result: ProductFormErrors = { ...errors };
  if (input.ussdFlow) {
    for (const issue of validateUssdFlow(input.ussdFlow)) {
      const step = /^steps\.(\d+)/.exec(issue.path);
      if (issue.path === 'start') result.ussdStart ??= issue.message;
      else if (step) result.steps = { ...result.steps, [Number(step[1])]: result.steps?.[Number(step[1])] ?? issue.message };
      else result.ussd ??= issue.message;
    }
  } else if (flowError) {
    result.ussd = flowError;
  }
  return { input, errors: result };
}

export const hasErrors = (errors: ProductFormErrors) => Object.keys(errors).length > 0;
