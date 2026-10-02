import type { WorkerService } from '@/services/types';
import type { ActivationPayload, ActivationTaskRecord, WorkerIdentity, WorkerResultReport } from '@/types';

import { buildUssdPlan } from './ussd/plan';
import type { UssdExecutor } from './ussd/types';

/** The result could not be delivered; the runtime keeps it and sends it again (never re-executes). */
export class PendingReportError extends Error {
  constructor(
    readonly taskId: string,
    readonly report: WorkerResultReport,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'Falha ao enviar o resultado.');
    this.name = 'PendingReportError';
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delivers a result with a few retries; after that the caller keeps it pending. */
export async function deliverReport(service: WorkerService, identity: WorkerIdentity, taskId: string, report: WorkerResultReport) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await service.reportResult(identity, taskId, report);
    } catch (error) {
      lastError = error;
      await delay(500 * 2 ** attempt);
    }
  }
  throw new PendingReportError(taskId, report, lastError);
}

/**
 * Runs one activation following megabot.activation.v1:
 *   1. never re-executes work a previous run may have started (restart safety);
 *   2. checks the plan and the requested SIM before touching the network;
 *   3. start (ASSIGNED → EXECUTING), execute, report SUBMITTED before the
 *      final step, report the result. The backend re-checks the claim.
 */
export async function executeActivation(
  service: WorkerService,
  identity: WorkerIdentity,
  payload: ActivationPayload,
  executor: UssdExecutor,
  log: (message: string) => void = () => undefined
): Promise<ActivationTaskRecord> {
  const report = (r: WorkerResultReport) => deliverReport(service, identity, payload.taskId, r);

  if (payload.status === 'EXECUTING') {
    // Started before an app restart, final step never sent (SUBMITTED is reported first): safe to retry.
    log('Tarefa interrompida antes da submissão — devolvida para nova tentativa.');
    return report({ outcome: 'FAILED', resultCode: 'DEVICE_OFFLINE', operatorResponse: null, ussdTrace: null });
  }
  if (payload.status === 'SUBMITTED' || payload.status === 'VERIFYING') {
    // The confirmation may have been sent: never repeat it, a person decides.
    log('Tarefa interrompida depois da submissão — resultado desconhecido.');
    return report({ outcome: 'UNKNOWN', resultCode: 'UNKNOWN_RESPONSE', operatorResponse: null, ussdTrace: null });
  }

  const plan = buildUssdPlan(payload.flow, payload.values);
  if (!plan.ok) {
    log(`Fluxo inválido: ${plan.reason}`);
    return report({ outcome: 'FAILED', resultCode: 'FLOW_MISMATCH', operatorResponse: plan.reason, ussdTrace: null });
  }

  const sims = await executor.listSims();
  if (sims) {
    const sim = sims.find((s) => s.slotIndex === payload.sim.slotIndex);
    if (!sim || (payload.sim.fingerprint && sim.fingerprint && sim.fingerprint !== payload.sim.fingerprint)) {
      log(`SIM do slot ${payload.sim.slotIndex + 1} indisponível ou diferente do registado.`);
      return report({ outcome: 'FAILED', resultCode: 'SIM_UNAVAILABLE', operatorResponse: null, ussdTrace: null });
    }
  }

  const started = await service.startTask(identity, payload.taskId);
  log(`A executar ${payload.flow.start} no SIM do slot ${started.sim.slotIndex + 1}…`);
  const result = await executor.execute({
    slotIndex: started.sim.slotIndex,
    expectedFingerprint: started.sim.fingerprint,
    plan: plan.plan,
    stepTimeoutMs: started.limits.stepTimeoutMs,
    sessionTimeoutMs: started.limits.sessionTimeoutMs,
    onBeforeSubmit: () => service.reportProgress(identity, payload.taskId, 'SUBMITTED'),
  });
  log(`Resultado: ${result.outcome} (${result.resultCode}).`);
  return report({ outcome: result.outcome, resultCode: result.resultCode, operatorResponse: result.finalResponse, ussdTrace: result.trace });
}
