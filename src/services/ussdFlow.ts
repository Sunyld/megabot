/**
 * USSD flow validation, shared by every backend and the product form.
 * Mirrors private.ussd_flow_is_valid (migration 003, schema version 1) rule
 * for rule: the form shows the same errors the database would raise, and the
 * database stays the final authority. Unknown keys and step types are
 * rejected on purpose — extending the schema is a migration + an update here.
 */
import type { UssdFlow, UssdInputSource, UssdStepType } from '@/types';

export const USSD_RULES = {
  version: 1,
  maxSteps: 30,
  labelMax: 80,
  matchEntriesMax: 20,
  matchTextMax: 120,
  waitMinMs: 100,
  waitMaxMs: 60_000,
  /** Kept below the database limit (16 KB of jsonb text) to absorb formatting differences. */
  maxBytes: 14_000,
} as const;

/** "*111#", "*123*1#", "#150#" — a prefix, then digits / * / #, ending in #. */
export const USSD_START_PATTERN = /^[*#][0-9][0-9*#]{0,37}#$/;

/** Menu options and confirmation values: up to 10 digits, * or #. */
export const USSD_VALUE_PATTERN = /^[0-9*#]{1,10}$/;

export const USSD_STEP_TYPES: readonly UssdStepType[] = ['select', 'input', 'confirm', 'wait'];

export const USSD_INPUT_SOURCES: readonly UssdInputSource[] = ['destination_number', 'amount_mb', 'amount_gb', 'price'];

/** `path` points at the offending part: "start", "steps.2.value", "success"… */
export type UssdFlowIssue = { path: string; message: string };

type JsonRecord = { [key: string]: unknown };

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStepType = (value: string): value is UssdStepType => (USSD_STEP_TYPES as readonly string[]).includes(value);

const isInputSource = (value: string): value is UssdInputSource =>
  (USSD_INPUT_SOURCES as readonly string[]).includes(value);

/** Keys that would reach the database (JSON drops `undefined`). */
const presentKeys = (record: JsonRecord) => Object.keys(record).filter((key) => record[key] !== undefined);

const unknownKeys = (record: JsonRecord, allowed: readonly string[]) =>
  presentKeys(record).filter((key) => !allowed.includes(key));

const has = (record: JsonRecord, key: string) => record[key] !== undefined;

const STEP_KEYS: Record<UssdStepType, readonly string[]> = {
  select: ['type', 'value', 'label', 'expect'],
  input: ['type', 'source', 'label', 'expect'],
  confirm: ['type', 'value', 'label', 'expect'],
  wait: ['type', 'ms', 'label'],
};

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function matchIssues(value: unknown, path: string): UssdFlowIssue[] {
  if (!isRecord(value) || unknownKeys(value, ['contains']).length) {
    return [{ path, message: 'Verificação de texto inválida.' }];
  }
  const entries = value.contains;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > USSD_RULES.matchEntriesMax) {
    return [{ path, message: `Indique entre 1 e ${USSD_RULES.matchEntriesMax} textos.` }];
  }
  const invalid = entries.some(
    (entry) => typeof entry !== 'string' || entry.trim().length < 1 || entry.trim().length > USSD_RULES.matchTextMax
  );
  return invalid ? [{ path, message: `Cada texto deve ter entre 1 e ${USSD_RULES.matchTextMax} caracteres.` }] : [];
}

function stepIssues(step: unknown, path: string): UssdFlowIssue[] {
  if (!isRecord(step)) return [{ path, message: 'Passo inválido.' }];
  const type = step.type;
  if (typeof type !== 'string' || !isStepType(type)) {
    return [{ path: `${path}.type`, message: 'Tipo de passo desconhecido.' }];
  }

  const issues: UssdFlowIssue[] = [];
  const extra = unknownKeys(step, STEP_KEYS[type]);
  if (extra.length) issues.push({ path, message: `Campos não suportados neste passo: ${extra.join(', ')}.` });
  if (has(step, 'label') && (typeof step.label !== 'string' || step.label.length > USSD_RULES.labelMax)) {
    issues.push({ path: `${path}.label`, message: `A descrição do passo tem no máximo ${USSD_RULES.labelMax} caracteres.` });
  }
  if (type !== 'wait' && has(step, 'expect')) issues.push(...matchIssues(step.expect, `${path}.expect`));

  switch (type) {
    case 'select':
      if (typeof step.value !== 'string' || !USSD_VALUE_PATTERN.test(step.value)) {
        issues.push({ path: `${path}.value`, message: 'Indique a opção do menu (dígitos, * ou #, até 10).' });
      }
      break;
    case 'input':
      if (typeof step.source !== 'string' || !isInputSource(step.source)) {
        issues.push({ path: `${path}.source`, message: 'Escolha o dado a inserir.' });
      }
      break;
    case 'confirm':
      if (has(step, 'value') && (typeof step.value !== 'string' || !USSD_VALUE_PATTERN.test(step.value))) {
        issues.push({ path: `${path}.value`, message: 'Valor de confirmação inválido (dígitos, * ou #).' });
      }
      break;
    case 'wait':
      if (
        typeof step.ms !== 'number' ||
        !Number.isInteger(step.ms) ||
        step.ms < USSD_RULES.waitMinMs ||
        step.ms > USSD_RULES.waitMaxMs
      ) {
        issues.push({ path: `${path}.ms`, message: 'A espera deve estar entre 0,1 e 60 segundos.' });
      }
      break;
  }
  return issues;
}

/** All problems of a flow; an empty list means valid. */
export function validateUssdFlow(value: unknown): UssdFlowIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'Configuração USSD inválida.' }];

  const issues: UssdFlowIssue[] = [];
  const extra = unknownKeys(value, ['version', 'start', 'steps', 'success', 'failure']);
  if (extra.length) issues.push({ path: '', message: `Campos não suportados: ${extra.join(', ')}.` });
  if (value.version !== USSD_RULES.version) {
    issues.push({ path: 'version', message: 'Versão do fluxo USSD não suportada.' });
  }
  if (typeof value.start !== 'string' || !USSD_START_PATTERN.test(value.start)) {
    issues.push({ path: 'start', message: 'Código USSD inicial inválido (ex.: *111#).' });
  }

  const steps = value.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({ path: 'steps', message: 'Adicione pelo menos um passo.' });
  } else if (steps.length > USSD_RULES.maxSteps) {
    issues.push({ path: 'steps', message: `Máximo de ${USSD_RULES.maxSteps} passos.` });
  } else {
    steps.forEach((step, index) => issues.push(...stepIssues(step, `steps.${index}`)));
  }

  if (has(value, 'success')) issues.push(...matchIssues(value.success, 'success'));
  if (has(value, 'failure')) issues.push(...matchIssues(value.failure, 'failure'));

  if (!issues.length && utf8Length(JSON.stringify(value)) > USSD_RULES.maxBytes) {
    issues.push({ path: '', message: 'Fluxo USSD demasiado grande.' });
  }
  return issues;
}

export const isUssdFlow = (value: unknown): value is UssdFlow => validateUssdFlow(value).length === 0;

/** Backend JSON → flow; `null` when absent or not valid (fail closed). */
export function parseUssdFlow(value: unknown): UssdFlow | null {
  return isUssdFlow(value) ? value : null;
}
