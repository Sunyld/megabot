import type { ActivationPayload, UssdFlow, UssdInputSource } from '@/types';

import type { UssdPlan, UssdPlanStep } from './types';

export type PlanResult = { ok: true; plan: UssdPlan } | { ok: false; reason: string };

/**
 * Product flow (003) + values computed by the backend → the exact sequence to
 * send. The submission point is the last `confirm` step (or the last step that
 * sends something when the flow has no confirm). A missing value fails closed:
 * nothing is sent.
 */
export function buildUssdPlan(flow: UssdFlow, values: ActivationPayload['values']): PlanResult {
  const sendIndexes = flow.steps.map((step, index) => (step.type === 'wait' ? -1 : index)).filter((index) => index >= 0);
  const confirmIndexes = flow.steps.map((step, index) => (step.type === 'confirm' ? index : -1)).filter((index) => index >= 0);
  const finalIndex = confirmIndexes.length ? confirmIndexes[confirmIndexes.length - 1] : sendIndexes[sendIndexes.length - 1];
  if (finalIndex === undefined) return { ok: false, reason: 'O fluxo não envia nenhum passo.' };

  const steps: UssdPlanStep[] = [];
  for (const [index, step] of flow.steps.entries()) {
    if (step.type === 'wait') {
      steps.push({ kind: 'wait', ms: step.ms });
      continue;
    }
    let value: string | undefined;
    if (step.type === 'select') value = step.value;
    else if (step.type === 'confirm') value = step.value ?? '1';
    else value = values[step.source as UssdInputSource];
    if (!value) return { ok: false, reason: `Falta o valor "${step.type === 'input' ? step.source : step.type}" para o passo ${index + 1}.` };
    steps.push({ kind: 'send', value, display: value, expect: step.expect, final: index === finalIndex });
  }
  return { ok: true, plan: { start: flow.start, steps, success: flow.success, failure: flow.failure } };
}
