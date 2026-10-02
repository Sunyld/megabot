import type { WorkerService } from '@/services/types';
import { ACTIVATION_PROTOCOL, type ActivationPayload, type ActivationTaskRecord, type UssdFlow, type WorkerIdentity } from '@/types';

import { createMemoryStore, saveIdentity } from '../credentials';
import { WorkerRuntime } from '../runtime';
import { executeActivation, PendingReportError } from '../taskExecutor';
import { AndroidUssdExecutor, type MegabotUssdNativeModule } from '../ussd/androidUssdExecutor';
import { MockUssdExecutor } from '../ussd/mockUssdExecutor';
import { buildUssdPlan } from '../ussd/plan';
import { runUssdSession } from '../ussd/runner';
import { UssdError, type UssdExecutionRequest } from '../ussd/types';

/*
 * The Android worker side of megabot.activation.v1, with the simulated
 * executor and fake services (no network, no phone). The real execution
 * needs the native module on a physical Android phone (docs/phase7).
 */

const FLOW: UssdFlow = {
  version: 1,
  start: '*111#',
  steps: [
    { type: 'select', value: '5', expect: { contains: ['Dados'] } },
    { type: 'input', source: 'destination_number' },
    { type: 'confirm' },
  ],
  success: { contains: ['sucesso'] },
  failure: { contains: ['saldo insuficiente'] },
};

const identity: WorkerIdentity = { deviceId: 'dev-1', deviceToken: 'mbdt_' + 'a'.repeat(64), deviceName: 'Worker 1', tenantId: 'tenant-a' };

const payload = (overrides: Partial<ActivationPayload> = {}): ActivationPayload => ({
  protocol: ACTIVATION_PROTOCOL,
  taskId: 'task-1',
  orderId: 'order-1',
  productId: 'product-1',
  deviceId: 'dev-1',
  simId: 'sim-1',
  status: 'ASSIGNED',
  attempt: 0,
  operator: 'vodacom',
  sim: { slotIndex: 0, fingerprint: null, operator: 'vodacom' },
  destinationNumber: '+258840000777',
  flowVersion: 1,
  flow: FLOW,
  values: { destination_number: '840000777', price: '500' },
  limits: { stepTimeoutMs: 1000, sessionTimeoutMs: 10_000 },
  ...overrides,
});

const record = (status: ActivationTaskRecord['status']): ActivationTaskRecord => ({
  id: 'task-1',
  tenantId: 'tenant-a',
  orderId: 'order-1',
  productId: 'product-1',
  deviceId: 'dev-1',
  simId: 'sim-1',
  status,
  priority: 0,
  operator: 'vodacom',
  ussdFlow: FLOW,
  flowVersion: 1,
  attemptCount: 1,
  maxAttempts: 3,
  assignedAt: null,
  startedAt: null,
  submittedAt: null,
  completedAt: null,
  resultCode: null,
  resultMessage: null,
  failureReason: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
});

function fakeService(overrides: Partial<WorkerService> = {}) {
  const calls: string[] = [];
  const service: WorkerService = {
    register: jest.fn(async () => identity),
    heartbeat: jest.fn(async () => ({ deviceId: 'dev-1', serverTime: '2026-10-02T10:00:00.000Z', heartbeatTimeoutSeconds: 120, taskId: null })),
    fetchTask: jest.fn(async () => null),
    startTask: jest.fn(async () => {
      calls.push('start');
      return payload({ status: 'EXECUTING', attempt: 1 });
    }),
    reportProgress: jest.fn(async (_i, _t, status) => {
      calls.push(`progress:${status}`);
    }),
    reportResult: jest.fn(async (_i, _t, report) => {
      calls.push(`result:${report.outcome}:${report.resultCode}`);
      return record(report.outcome === 'SUCCESS' ? 'SUCCESS' : report.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED');
    }),
    ...overrides,
  };
  return { service, calls };
}

const request = (overrides: Partial<UssdExecutionRequest> = {}): UssdExecutionRequest => {
  const plan = buildUssdPlan(FLOW, { destination_number: '840000777' });
  if (!plan.ok) throw new Error(plan.reason);
  return { slotIndex: 0, expectedFingerprint: null, plan: plan.plan, stepTimeoutMs: 1000, sessionTimeoutMs: 10_000, onBeforeSubmit: async () => undefined, ...overrides };
};

describe('execution plan', () => {
  it('sends the flow in order; the last confirm is the submission point', () => {
    const plan = buildUssdPlan(FLOW, { destination_number: '840000777' });
    expect(plan.ok && plan.plan.steps.map((s) => (s.kind === 'send' ? `${s.value}${s.final ? '!' : ''}` : 'wait'))).toEqual(['5', '840000777', '1!']);
  });

  it('fails closed when a value is missing (nothing is sent)', () => {
    expect(buildUssdPlan(FLOW, {})).toMatchObject({ ok: false });
  });
});

describe('USSD session runner (simulated operator)', () => {
  it('SUCCESS only when the final screen shows the success text; SUBMITTED reported before the final step', async () => {
    const executor = new MockUssdExecutor('success');
    const order: string[] = [];
    const result = await executor.execute(
      request({
        onBeforeSubmit: async () => {
          order.push(`submit-before:${executor.sent.length}`);
        },
      })
    );
    expect(result).toMatchObject({ outcome: 'SUCCESS', resultCode: 'ACTIVATED', submitted: true, trace: '*111# › 5 › 840000777 › 1' });
    // Two replies were sent before SUBMITTED was reported, the confirmation after.
    expect(order).toEqual(['submit-before:2']);
    expect(executor.sent).toEqual(['5', '840000777', '1']);
  });

  it('operator failure text → FAILED', async () => {
    expect(await new MockUssdExecutor('failure').execute(request())).toMatchObject({ outcome: 'FAILED', resultCode: 'USSD_REJECTED', submitted: true });
  });

  it('a screen that proves nothing → UNKNOWN (never assumed success)', async () => {
    expect(await new MockUssdExecutor('unknown').execute(request())).toMatchObject({ outcome: 'UNKNOWN', resultCode: 'UNKNOWN_RESPONSE' });
  });

  it('no answer after the confirmation → UNKNOWN', async () => {
    expect(await new MockUssdExecutor('no-response-after-submit').execute(request())).toMatchObject({ outcome: 'UNKNOWN', resultCode: 'TIMEOUT', submitted: true });
  });

  it('if SUBMITTED cannot be reported, the confirmation is NOT sent', async () => {
    const executor = new MockUssdExecutor('success');
    const result = await executor.execute(request({ onBeforeSubmit: async () => Promise.reject(new Error('offline')) }));
    expect(result).toMatchObject({ outcome: 'FAILED', resultCode: 'NETWORK_ERROR', submitted: false });
    expect(executor.sent).not.toContain('1');
  });

  it('unexpected menu → FLOW_MISMATCH before anything is confirmed', async () => {
    const submit = jest.fn(async () => undefined);
    const result = await runUssdSession(
      async () => ({ screen: 'Bem-vindo. 1 Voz 2 SMS', session: { send: async () => 'x', close: async () => undefined } }),
      request({ onBeforeSubmit: submit })
    );
    expect(result).toMatchObject({ outcome: 'FAILED', resultCode: 'FLOW_MISMATCH', submitted: false });
    expect(submit).not.toHaveBeenCalled();
  });

  it('the requested SIM missing → FAILED SIM_UNAVAILABLE (never another SIM)', async () => {
    expect(await new MockUssdExecutor('sim-missing').execute(request())).toMatchObject({ outcome: 'FAILED', resultCode: 'SIM_UNAVAILABLE' });
  });
});

describe('Android executor', () => {
  it('without the native module: no USSD capability and nothing is executed', async () => {
    const executor = new AndroidUssdExecutor(null);
    expect(await executor.capabilities()).toMatchObject({ ussd: false, ussdInteractive: false });
    expect(await executor.listSims()).toBeNull();
    expect(await executor.execute(request())).toMatchObject({ outcome: 'FAILED', resultCode: 'USSD_NOT_SUPPORTED', submitted: false });
  });

  it('uses the native session on the requested slot and maps its errors', async () => {
    const native: MegabotUssdNativeModule = {
      getCapabilities: async () => ({ ussd: true, interactive: true, multiSim: true }),
      listSims: async () => [{ slotIndex: 1, fingerprint: 'fp-1-xxxx', carrierName: 'Vodacom' }],
      openSession: jest.fn(async () => ({ sessionId: 's1', text: 'Menu: Dados' })),
      send: jest.fn(async (_id: string, input: string) => (input === '1' ? 'Pacote activado com sucesso' : 'Continue')),
      close: jest.fn(async () => undefined),
    };
    const executor = new AndroidUssdExecutor(native);
    expect(await executor.capabilities()).toMatchObject({ ussd: true, ussdInteractive: true });
    expect(await executor.execute(request({ slotIndex: 1, expectedFingerprint: 'fp-1-xxxx' }))).toMatchObject({ outcome: 'SUCCESS' });
    expect(native.openSession).toHaveBeenCalledWith(1, 'fp-1-xxxx', '*111#', 1000);
    expect(native.close).toHaveBeenCalled();

    const rejecting = new AndroidUssdExecutor({
      ...native,
      openSession: async () => Promise.reject(Object.assign(new Error('different SIM'), { code: 'SIM_UNAVAILABLE' })),
    });
    expect(await rejecting.execute(request())).toMatchObject({ outcome: 'FAILED', resultCode: 'SIM_UNAVAILABLE' });
  });
});

describe('task executor (protocol)', () => {
  it('start → SUBMITTED → result, in that order', async () => {
    const { service, calls } = fakeService();
    const task = await executeActivation(service, identity, payload(), new MockUssdExecutor('success'));
    expect(task.status).toBe('SUCCESS');
    expect(calls).toEqual(['start', 'progress:SUBMITTED', 'result:SUCCESS:ACTIVATED']);
  });

  it('SIM not in the phone → FAILED without starting (nothing executed)', async () => {
    const { service, calls } = fakeService();
    await executeActivation(service, identity, payload({ sim: { slotIndex: 1, fingerprint: null, operator: 'vodacom' } }), new MockUssdExecutor('success'));
    expect(calls).toEqual(['result:FAILED:SIM_UNAVAILABLE']);
  });

  it('a different SIM in the slot → FAILED SIM_UNAVAILABLE', async () => {
    const { service, calls } = fakeService();
    const executor = new MockUssdExecutor('success', [{ slotIndex: 0, fingerprint: 'other-sim-xx', carrierName: null }]);
    await executeActivation(service, identity, payload({ sim: { slotIndex: 0, fingerprint: 'registered-sim', operator: 'vodacom' } }), executor);
    expect(calls).toEqual(['result:FAILED:SIM_UNAVAILABLE']);
    expect(executor.sent).toEqual([]);
  });

  it('never re-executes after a restart: EXECUTING → retryable failure, SUBMITTED → UNKNOWN', async () => {
    const executor = new MockUssdExecutor('success');
    const a = fakeService();
    await executeActivation(a.service, identity, payload({ status: 'EXECUTING' }), executor);
    expect(a.calls).toEqual(['result:FAILED:DEVICE_OFFLINE']);
    const b = fakeService();
    await executeActivation(b.service, identity, payload({ status: 'SUBMITTED' }), executor);
    expect(b.calls).toEqual(['result:UNKNOWN:UNKNOWN_RESPONSE']);
    expect(executor.sent).toEqual([]);
  });

  it('a result that cannot be delivered is kept, not re-executed', async () => {
    jest.useFakeTimers();
    try {
      const { service } = fakeService({ reportResult: jest.fn(async () => Promise.reject(new Error('offline'))) });
      const promise = executeActivation(service, identity, payload(), new MockUssdExecutor('success'));
      const assertion = expect(promise).rejects.toBeInstanceOf(PendingReportError);
      await jest.runAllTimersAsync();
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('worker runtime', () => {
  const deps = (service: WorkerService, executor = new MockUssdExecutor('success')) => ({
    service,
    executor,
    store: createMemoryStore(),
    appVersion: '1.0.0',
    telemetry: () => ({ model: 'Test' }),
  });

  it('pairs and keeps the token out of the screen state', async () => {
    const { service } = fakeService();
    const runtime = new WorkerRuntime(deps(service));
    await runtime.load();
    expect(runtime.getSnapshot().phase).toBe('unpaired');
    await runtime.pair('abcd-ef23');
    const state = runtime.getSnapshot();
    expect(state).toMatchObject({ phase: 'stopped', device: { id: 'dev-1', name: 'Worker 1' } });
    expect(JSON.stringify(state)).not.toContain('mbdt_');
    expect(service.register).toHaveBeenCalledWith(expect.objectContaining({ pairingCode: 'abcd-ef23', appVersion: '1.0.0' }));
  });

  it('a phone without USSD reports it and never asks for work', async () => {
    const { service } = fakeService();
    const d = { ...deps(service), executor: new AndroidUssdExecutor(null) };
    await saveIdentity(d.store, identity);
    const runtime = new WorkerRuntime(d);
    await runtime.load();
    await runtime.tick();
    expect(service.heartbeat).toHaveBeenCalledWith(identity, expect.objectContaining({ capabilities: expect.objectContaining({ ussd: false, ussdInteractive: false }), sims: null }));
    expect(service.fetchTask).not.toHaveBeenCalled();
  });

  it('executes the task the backend gives it', async () => {
    const { service, calls } = fakeService({ fetchTask: jest.fn(async () => payload()) });
    const d = deps(service);
    await saveIdentity(d.store, identity);
    const runtime = new WorkerRuntime(d);
    await runtime.load();
    await runtime.tick();
    expect(calls).toEqual(['start', 'progress:SUBMITTED', 'result:SUCCESS:ACTIVATED']);
    expect(runtime.getSnapshot().log[0].message).toContain('concluída');
  });

  it('heartbeat failures surface as errors (no silent success)', async () => {
    const { service } = fakeService({ heartbeat: jest.fn(async () => Promise.reject(new UssdError('NETWORK_ERROR', 'Sem rede'))) });
    const d = deps(service);
    await saveIdentity(d.store, identity);
    const runtime = new WorkerRuntime(d);
    await runtime.load();
    await runtime.tick();
    expect(runtime.getSnapshot().lastError).toBeTruthy();
    expect(service.fetchTask).not.toHaveBeenCalled();
  });
});
