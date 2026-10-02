import { runUssdSession } from './runner';
import { UssdError, type UssdCapabilities, type UssdExecutionRequest, type UssdExecutor, type UssdResult, type UssdSimInfo } from './types';

/** How the simulated operator answers the final step. */
export type MockUssdScenario = 'success' | 'failure' | 'unknown' | 'no-response-after-submit' | 'sim-missing';

/**
 * Simulated operator for MOCK MODE AND TESTS ONLY. It is never wired to the
 * Supabase backend (src/features/worker/runtime.ts picks the Android executor
 * there), so no simulated success can reach real data.
 */
export class MockUssdExecutor implements UssdExecutor {
  readonly kind = 'mock' as const;
  scenario: MockUssdScenario;
  /** Every reply sent, for tests. */
  readonly sent: string[] = [];

  constructor(scenario: MockUssdScenario = 'success', private readonly sims: UssdSimInfo[] = [{ slotIndex: 0, fingerprint: null, carrierName: 'Simulado' }]) {
    this.scenario = scenario;
  }

  async capabilities(): Promise<UssdCapabilities> {
    return { ussd: true, ussdInteractive: true, multiSim: this.sims.length > 1, reason: 'USSD simulado (modo demonstração).' };
  }

  async listSims(): Promise<UssdSimInfo[]> {
    return this.sims;
  }

  async execute(request: UssdExecutionRequest): Promise<UssdResult> {
    const finalText = () => {
      switch (this.scenario) {
        case 'success':
          return request.plan.success?.contains[0] ?? 'Pedido recebido.';
        case 'failure':
          return request.plan.failure?.contains[0] ?? 'Operação recusada.';
        default:
          return 'Pedido em processamento. Obrigado.';
      }
    };
    return runUssdSession(async () => {
      if (this.scenario === 'sim-missing' || !this.sims.some((s) => s.slotIndex === request.slotIndex)) {
        throw new UssdError('SIM_UNAVAILABLE', 'SIM não encontrado no slot pedido.');
      }
      let remaining = request.plan.steps.filter((s) => s.kind === 'send').length;
      return {
        screen: `Menu ${request.plan.start}: ${request.plan.steps
          .map((s) => (s.kind === 'send' && s.expect ? s.expect.contains[0] : ''))
          .filter(Boolean)
          .join(' ')}`.trim(),
        session: {
          send: async (input) => {
            this.sent.push(input);
            remaining -= 1;
            if (remaining > 0) {
              // Next screen shows whatever the next step expects, so the flow can continue.
              const next = request.plan.steps.filter((s) => s.kind === 'send')[this.sent.length];
              return next && next.kind === 'send' && next.expect ? next.expect.contains[0] : 'Continue';
            }
            if (this.scenario === 'no-response-after-submit') throw new UssdError('TIMEOUT', 'Sem resposta da operadora.');
            return finalText();
          },
          close: async () => undefined,
        },
      };
    }, request);
  }
}
