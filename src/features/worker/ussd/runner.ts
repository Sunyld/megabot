import type { ActivationResultCode } from '@/types';

import { UssdResponseParser } from './responseParser';
import { UssdError, type UssdExecutionRequest, type UssdResult, type UssdSession } from './types';

export type OpenSession = (start: string, timeoutMs: number) => Promise<{ session: UssdSession; screen: string }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const codeOf = (error: unknown): ActivationResultCode =>
  error instanceof UssdError ? (error.code === 'TIMEOUT' ? 'TIMEOUT' : error.code) : 'NETWORK_ERROR';

/**
 * Drives one interactive USSD session through the plan. Guarantees:
 *   • each step's expected text is checked before answering (else FLOW_MISMATCH, nothing confirmed);
 *   • `onBeforeSubmit` (report SUBMITTED) runs and succeeds BEFORE the final step is sent;
 *   • any error before the final step → FAILED (safe to retry); any doubt after it → UNKNOWN;
 *   • the final screen is classified with the product's own texts — no text, no success.
 */
export async function runUssdSession(open: OpenSession, request: UssdExecutionRequest): Promise<UssdResult> {
  const { plan } = request;
  const trace: string[] = [plan.start];
  const result = (outcome: UssdResult['outcome'], resultCode: ActivationResultCode, finalResponse: string | null, submitted: boolean): UssdResult => ({
    outcome,
    resultCode,
    finalResponse,
    trace: trace.join(' › '),
    submitted,
  });

  let session: UssdSession;
  let screen: string;
  try {
    ({ session, screen } = await open(plan.start, request.stepTimeoutMs));
  } catch (error) {
    return result('FAILED', codeOf(error), null, false);
  }

  const deadline = Date.now() + request.sessionTimeoutMs;
  try {
    for (const step of plan.steps) {
      if (step.kind === 'wait') {
        await sleep(step.ms);
        continue;
      }
      if (Date.now() > deadline) return result('FAILED', 'TIMEOUT', screen, false);
      if (UssdResponseParser.showsFailure(plan, screen)) return result('FAILED', 'USSD_REJECTED', screen, false);
      if (!UssdResponseParser.matchesExpectation(screen, step.expect)) return result('FAILED', 'FLOW_MISMATCH', screen, false);

      if (step.final) {
        try {
          await request.onBeforeSubmit();
        } catch {
          // Could not tell the backend we are about to submit: do not submit.
          return result('FAILED', 'NETWORK_ERROR', screen, false);
        }
        trace.push(step.display);
        try {
          screen = await session.send(step.value, request.stepTimeoutMs);
        } catch (error) {
          // The confirmation may have reached the operator: never a failure we can prove.
          return result('UNKNOWN', codeOf(error) === 'TIMEOUT' ? 'TIMEOUT' : 'UNKNOWN_RESPONSE', null, true);
        }
        const outcome = UssdResponseParser.classify(plan, screen);
        if (outcome === 'SUCCESS') return result('SUCCESS', 'ACTIVATED', screen, true);
        if (outcome === 'FAILED') return result('FAILED', 'USSD_REJECTED', screen, true);
        return result('UNKNOWN', 'UNKNOWN_RESPONSE', screen, true);
      }

      trace.push(step.display);
      try {
        screen = await session.send(step.value, request.stepTimeoutMs);
      } catch (error) {
        return result('FAILED', codeOf(error), screen, false);
      }
    }
    // Plans always end with a final step (plan.ts); defensive.
    return result('FAILED', 'FLOW_MISMATCH', screen, false);
  } finally {
    await session.close().catch(() => undefined);
  }
}
