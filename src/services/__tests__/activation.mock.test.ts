import { executeActivation } from '@/features/worker/taskExecutor';
import { MockUssdExecutor } from '@/features/worker/ussd/mockUssdExecutor';
import type { ActivationTask, WorkerIdentity } from '@/types';

import { serviceContext } from '../context';
import { AppError } from '../errors';
import { mockActivationTasksService as tasks, mockDeviceRegistryService as registry, mockWorkerService as worker } from '../mock/activation';
import { db } from '../mock/db';
import { mockOrdersService as orders } from '../mock/orders';
import { setSimulation } from '../mock/simulation';

/*
 * Mock mode follows migration 006: one-time pairing codes, device tokens,
 * the task state machine, verification of results, UNKNOWN never retried —
 * driven end to end by the real worker protocol code with a simulated operator.
 */

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

/** A paid demo order with its QUEUED task, first in the queue. */
async function queuedTask(): Promise<ActivationTask> {
  const order = await orders.create({ productId: 'prd_1024', customerPhone: '840000777' });
  const live = db.orders.find((o) => o.id === order.id)!;
  live.status = 'PAID';
  const task: ActivationTask = {
    id: `tsk_test_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: live.tenantId,
    code: live.code,
    orderId: live.id,
    orderCode: live.code,
    productName: live.productName,
    destination: live.destination ?? '',
    status: 'QUEUED',
    ussdCode: '',
    attempts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.tasks.unshift(task);
  return task;
}

describe('mock activation engine (same rules as migration 006)', () => {
  let identity: WorkerIdentity;

  beforeAll(async () => {
    setSimulation({ latency: 'instant', failRequests: false, offline: false, emptyData: false });
    serviceContext.setTenant('tnt_megabot_demo');
    // Keep demo QUEUED tasks out of the way: only this test's tasks are queued.
    db.tasks.filter((t) => t.status === 'QUEUED').forEach((t) => (t.status = 'SUCCESS'));
  });
  afterAll(() => {
    serviceContext.setTenant(null);
    setSimulation({ latency: 'realistic' });
  });

  it('pairing codes are single-use and tokens are checked', async () => {
    const pairing = await registry.createDevice('Worker Teste');
    expect(pairing.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect((await registry.getDevice(pairing.deviceId)).status).toBe('UNREGISTERED');

    identity = await worker.register({ pairingCode: pairing.pairingCode.toLowerCase(), deviceIdentifier: 'inst-test', appVersion: '1.0.0' });
    expect(identity.deviceToken).toMatch(/^mbdt_[0-9a-f]{64}$/);
    expect((await registry.getDevice(pairing.deviceId)).status).toBe('ACTIVE');
    expect((await failure(worker.register({ pairingCode: pairing.pairingCode, deviceIdentifier: 'inst-x', appVersion: '1.0.0' }))).reason).toBe(
      'PAIRING_CODE_INVALID'
    );
    await failure(worker.heartbeat({ ...identity, deviceToken: 'mbdt_' + '0'.repeat(64) }, {}));
    await failure(worker.heartbeat({ ...identity, deviceId: 'dev_01' }, {}));

    await registry.registerSim({ deviceId: identity.deviceId, slotIndex: 0, operator: 'vodacom', phoneNumber: '84 555 0100' });
    await failure(registry.registerSim({ deviceId: identity.deviceId, slotIndex: 0, operator: 'movitel' }));
  });

  it('a phone without interactive USSD gets no work', async () => {
    await queuedTask();
    await worker.heartbeat(identity, { capabilities: { ussd: true, ussdInteractive: false } });
    expect(await worker.fetchTask(identity)).toBeNull();
  });

  it('runs a task end to end: SUCCESS only with the operator text, order COMPLETED', async () => {
    await worker.heartbeat(identity, { capabilities: { ussd: true, ussdInteractive: true } });
    const payload = await worker.fetchTask(identity);
    expect(payload).toMatchObject({ status: 'ASSIGNED', sim: { slotIndex: 0, operator: 'vodacom' }, values: { destination_number: '840000777' } });
    const record = await executeActivation(worker, identity, payload!, new MockUssdExecutor('success', [{ slotIndex: 0, fingerprint: null, carrierName: null }]));
    expect(record.status).toBe('SUCCESS');
    expect(db.orders.find((o) => o.id === payload!.orderId)?.status).toBe('COMPLETED');
    const detail = await tasks.get(payload!.taskId);
    expect(detail.attempts.at(-1)).toMatchObject({ outcome: 'SUCCESS', resultCode: 'ACTIVATED' });
  });

  it('a screen that proves nothing → UNKNOWN, never retried; a person decides', async () => {
    const task = await queuedTask();
    const payload = await worker.fetchTask(identity);
    expect(payload?.taskId).toBe(task.id);
    const record = await executeActivation(worker, identity, payload!, new MockUssdExecutor('unknown', [{ slotIndex: 0, fingerprint: null, carrierName: null }]));
    expect(record.status).toBe('UNKNOWN');
    expect(await worker.fetchTask(identity)).toBeNull();
    expect((await tasks.get(task.id)).task.status).toBe('UNKNOWN');

    await failure(tasks.resolve(task.id, 'SUCCESS', '  '));
    await failure(tasks.retry(task.id));
    const resolved = await tasks.resolve(task.id, 'SUCCESS', 'Cliente confirmou o pacote');
    expect(resolved.status).toBe('SUCCESS');
    expect(db.orders.find((o) => o.id === task.orderId)?.status).toBe('COMPLETED');
  });

  it('a retryable failure before submission goes back to the queue', async () => {
    const task = await queuedTask();
    const payload = await worker.fetchTask(identity);
    await worker.startTask(identity, payload!.taskId);
    const record = await worker.reportResult(identity, task.id, { outcome: 'FAILED', resultCode: 'NETWORK_ERROR' });
    expect(record.status).toBe('QUEUED');
    // The forged SUCCESS of a task this device no longer holds is refused.
    await failure(worker.reportResult(identity, task.id, { outcome: 'SUCCESS', resultCode: 'ACTIVATED', operatorResponse: 'sucesso' }));
  });

  it('a worker claim of SUCCESS without the operator text is not accepted', async () => {
    const payload = await worker.fetchTask(identity);
    await worker.startTask(identity, payload!.taskId);
    await worker.reportProgress(identity, payload!.taskId, 'SUBMITTED');
    const record = await worker.reportResult(identity, payload!.taskId, { outcome: 'SUCCESS', resultCode: 'ACTIVATED', operatorResponse: 'Obrigado.' });
    expect(record.status).toBe('UNKNOWN');
  });

  it('an operator failure after submission is final (no automatic retry)', async () => {
    const task = await queuedTask();
    const payload = await worker.fetchTask(identity);
    expect(payload?.taskId).toBe(task.id);
    const record = await executeActivation(worker, identity, payload!, new MockUssdExecutor('failure', [{ slotIndex: 0, fingerprint: null, carrierName: null }]));
    expect(record.status).toBe('FAILED');
    const retried = await tasks.retry(task.id, 'Saldo carregado');
    expect(retried.status).toBe('QUEUED');
  });
});
