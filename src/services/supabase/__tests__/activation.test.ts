import { PostgrestError } from '@supabase/supabase-js';

import type { AutomationService } from '../../types';
import { AppError } from '../../errors';
import { createSupabaseActivationServices, toActivationError, toDeviceRecord, toSimRecord, toTaskRecord } from '../activation';
import type {
  ActivationAttemptRow,
  ActivationEventRow,
  ActivationGateway,
  ActivationOrderRow,
  ActivationTaskRow,
  DeviceRow,
  DeviceSimRow,
} from '../activationGateway';

/*
 * The activation services against a fake gateway (no network). Authorization,
 * the state machine, the dispatcher and the verification of results are
 * enforced by the database and verified in supabase/tests/006_devices_activation.test.sql.
 */

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const tagged = (code: string, hint: string, message: string) => new PostgrestError({ code, message, details: '', hint });

const FLOW = {
  version: 1,
  start: '*111#',
  steps: [{ type: 'select', value: '5' }, { type: 'input', source: 'destination_number' }, { type: 'confirm' }],
  success: { contains: ['sucesso'] },
};

const deviceRow = (overrides: Partial<DeviceRow> = {}): DeviceRow => ({
  id: 'dev-1',
  tenant_id: 'tenant-a',
  device_name: 'Worker 1',
  device_identifier: 'inst-1',
  platform: 'ANDROID',
  app_version: '1.0.0',
  status: 'ACTIVE',
  capabilities: { ussd: true, ussd_interactive: true, multi_sim: true },
  telemetry: { battery_level: 77, charging: false, network_type: 'WIFI', model: 'SM-A12', os_version: '13' },
  last_seen_at: '2026-10-02T11:59:30.000Z',
  registered_at: '2026-10-01T10:00:00.000Z',
  registered_by: 'user-op',
  created_by: 'user-owner',
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-02T11:59:30.000Z',
  ...overrides,
});

const simRow = (overrides: Partial<DeviceSimRow> = {}): DeviceSimRow => ({
  id: 'sim-1',
  tenant_id: 'tenant-a',
  device_id: 'dev-1',
  slot_index: 0,
  operator: 'vodacom',
  phone_number: '+258845550100',
  status: 'ACTIVE',
  unavailable_reason: null,
  capabilities: { ussd: true },
  sim_fingerprint: 'sub-0001',
  last_seen_at: '2026-10-02T11:59:30.000Z',
  created_by: 'user-owner',
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-02T11:59:30.000Z',
  ...overrides,
});

const taskRow = (overrides: Partial<ActivationTaskRow> = {}): ActivationTaskRow => ({
  id: 'task-1',
  tenant_id: 'tenant-a',
  order_id: 'order-1',
  product_id: 'product-1',
  device_id: 'dev-1',
  sim_id: 'sim-1',
  status: 'SUCCESS',
  priority: 0,
  operator: 'vodacom',
  ussd_flow: FLOW,
  flow_version: 1,
  attempt_count: 1,
  max_attempts: 3,
  assigned_at: '2026-10-02T11:00:00.000Z',
  started_at: '2026-10-02T11:00:05.000Z',
  submitted_at: '2026-10-02T11:00:20.000Z',
  completed_at: '2026-10-02T11:00:25.000Z',
  result_code: 'ACTIVATED',
  result_message: 'Pacote activado com sucesso',
  failure_reason: null,
  created_at: '2026-10-02T10:59:00.000Z',
  updated_at: '2026-10-02T11:00:25.000Z',
  ...overrides,
});

const attemptRow = (overrides: Partial<ActivationAttemptRow> = {}): ActivationAttemptRow => ({
  id: 'att-1',
  tenant_id: 'tenant-a',
  task_id: 'task-1',
  sequence: 1,
  attempt_number: 1,
  device_id: 'dev-1',
  sim_id: 'sim-1',
  slot_index: 0,
  outcome: 'SUCCESS',
  result_code: 'ACTIVATED',
  retryable: false,
  source: 'WORKER',
  ussd_trace: '*111# › 5 › 840000777 › 1',
  operator_response: 'Pacote activado com sucesso',
  note: null,
  decided_by: null,
  started_at: '2026-10-02T11:00:05.000Z',
  finished_at: '2026-10-02T11:00:25.000Z',
  created_at: '2026-10-02T11:00:25.000Z',
  ...overrides,
});

const eventRow = (overrides: Partial<ActivationEventRow> = {}): ActivationEventRow => ({
  id: 'evt-1',
  tenant_id: 'tenant-a',
  task_id: 'task-1',
  event_type: 'activation_task.completed',
  from_status: 'SUBMITTED',
  to_status: 'SUCCESS',
  device_id: 'dev-1',
  sim_id: 'sim-1',
  actor_user_id: null,
  metadata: {},
  created_at: '2026-10-02T11:00:25.000Z',
  ...overrides,
});

const orderRow: ActivationOrderRow = {
  id: 'order-1',
  public_reference: 'MB-20261002-ABCD1234',
  product_name_snapshot: 'Internet 1GB',
  customer_phone: '+258840000777',
  product_price_snapshot: 777,
  currency_snapshot: 'MZN',
  data_amount_snapshot: 1,
  data_unit_snapshot: 'GB',
};

function setup(data: { devices?: DeviceRow[]; sims?: DeviceSimRow[]; tasks?: ActivationTaskRow[]; attempts?: ActivationAttemptRow[] } = {}, tenantId: string | null = 'tenant-a') {
  const db = { devices: [deviceRow()], sims: [simRow()], tasks: [taskRow()], attempts: [attemptRow()], ...data };
  const mocks = {
    listDevices: jest.fn(async (_t: string, ids?: string[] | null) => db.devices.filter((d) => !ids || ids.includes(d.id))),
    createDevice: jest.fn(async () => [{ device_id: 'dev-new', pairing_code: 'ABCD-EF23', pairing_expires_at: '2026-10-02T12:15:00.000Z' }]),
    createPairingCode: jest.fn(async () => [{ device_id: 'dev-1', pairing_code: 'WXYZ-2345', pairing_expires_at: '2026-10-02T12:15:00.000Z' }]),
    updateDevice: jest.fn(async () => [deviceRow({ status: 'DISABLED' })]),
    listSims: jest.fn(async (_t: string, deviceId: string | null) => db.sims.filter((s) => !deviceId || s.device_id === deviceId)),
    registerSim: jest.fn(async () => [simRow({ id: 'sim-new', slot_index: 1 })]),
    updateSim: jest.fn(async () => [simRow({ status: 'DISABLED' })]),
    listTasks: jest.fn(async (_t: string, q: { ids: string[] | null }) => db.tasks.filter((t) => !q.ids || q.ids.includes(t.id))),
    listAttempts: jest.fn(async () => db.attempts),
    listEvents: jest.fn(async () => [eventRow()]),
    listOrders: jest.fn(async () => [orderRow]),
    automationSettings: jest.fn(async () => ({})),
    dispatch: jest.fn(async () => 2),
    retryTask: jest.fn(async () => [taskRow({ status: 'QUEUED', device_id: null, sim_id: null })]),
    resolveTask: jest.fn(async () => [taskRow({ status: 'SUCCESS', result_code: 'MANUAL_CONFIRMED' })]),
    registerDevice: jest.fn(async () => [{ device_id: 'dev-1', device_token: 'mbdt_' + 'b'.repeat(64), device_name: 'Worker 1', tenant_id: 'tenant-a' }]),
    heartbeat: jest.fn(async () => ({ device_id: 'dev-1', server_time: '2026-10-02T12:00:00.000Z', heartbeat_timeout_seconds: 120, task_id: 'task-1' })),
    fetchTask: jest.fn(async () => null as unknown),
    startTask: jest.fn(async () => ({}) as unknown),
    reportProgress: jest.fn(async () => [taskRow({ status: 'SUBMITTED' })]),
    reportResult: jest.fn(async () => [taskRow()]),
    platformDevices: jest.fn(async () => db.devices),
    platformTasks: jest.fn(async () => db.tasks),
  };
  const settings: Pick<AutomationService, 'getSettings' | 'updateSettings'> = {
    getSettings: jest.fn(async () => ({ enabled: false, autoOrders: false, autoConfirm: false, autoUssd: false, failover: false, smsMonitoring: false })),
    updateSettings: jest.fn(),
  };
  const gateway = mocks as unknown as ActivationGateway;
  return { mocks, services: createSupabaseActivationServices(gateway, settings, () => tenantId, () => NOW) };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('row mapping', () => {
  it('devices: wire formats mapped, unknown status never ACTIVE', () => {
    expect(toDeviceRecord(deviceRow())).toMatchObject({
      status: 'ACTIVE',
      capabilities: { ussd: true, ussdInteractive: true, multiSim: true },
      telemetry: { batteryLevel: 77, networkType: 'WIFI', model: 'SM-A12' },
    });
    expect(toDeviceRecord(deviceRow({ status: 'SOMETHING' })).status).toBe('UNREGISTERED');
  });

  it('SIMs of an unknown network are left out; unknown status is not ACTIVE', () => {
    expect(toSimRecord(simRow({ operator: 'mtn' }))).toBeNull();
    expect(toSimRecord(simRow({ status: 'WEIRD' }))?.status).toBe('UNAVAILABLE');
  });

  it('tasks: unknown statuses need a person (never success); invalid flows are dropped', () => {
    expect(toTaskRecord(taskRow({ status: 'DONE' })).status).toBe('UNKNOWN');
    expect(toTaskRecord(taskRow({ ussd_flow: { version: 2 } })).ussdFlow).toBeNull();
  });
});

describe('devices / SIMs read models (Supabase mode: real data only)', () => {
  it('derives online / offline / paused / unregistered from the backend', async () => {
    const { services } = setup({
      devices: [
        deviceRow(),
        deviceRow({ id: 'dev-2', last_seen_at: '2026-10-02T11:00:00.000Z' }),
        deviceRow({ id: 'dev-3', status: 'DISABLED' }),
        deviceRow({ id: 'dev-4', status: 'UNREGISTERED', registered_at: null, device_identifier: null, platform: null, last_seen_at: null, telemetry: {} }),
      ],
    });
    const list = await services.devices.list();
    expect(list.map((d) => [d.id, d.status])).toEqual([
      ['dev-1', 'online'],
      ['dev-2', 'offline'],
      ['dev-3', 'paused'],
      ['dev-4', 'unregistered'],
    ]);
    expect(list[0]).toMatchObject({ battery: { level: 77 }, network: { type: 'WiFi' }, model: 'SM-A12', androidVersion: 'Android 13' });
    // Nothing invented when the worker did not report it.
    expect(list[3]).toMatchObject({ battery: null, network: null, model: null, usage: { capacityPerDay: null } });
  });

  it('starts empty without devices (no demo data)', async () => {
    const { services } = setup({ devices: [], sims: [], tasks: [], attempts: [] });
    expect(await services.devices.list()).toEqual([]);
    expect(await services.sims.list()).toEqual([]);
    expect(await services.devices.summary()).toEqual({ online: 0, total: 0, simsAvailable: 0, simsTotal: 0, capacityUsed: 0, capacityTotal: null });
    expect(await services.automation.listTasks()).toEqual([]);
  });

  it('SIM status: busy with a running task, unavailable with reason, paused when disabled', async () => {
    const { services } = setup({
      sims: [simRow(), simRow({ id: 'sim-2', slot_index: 1, status: 'UNAVAILABLE', unavailable_reason: 'SIM_CHANGED' }), simRow({ id: 'sim-3', slot_index: 2, status: 'DISABLED' })],
      tasks: [taskRow({ status: 'EXECUTING' })],
    });
    const sims = await services.sims.list();
    expect(sims.map((s) => [s.id, s.status, s.slot])).toEqual([
      ['sim-1', 'busy', 1],
      ['sim-2', 'unavailable', 2],
      ['sim-3', 'paused', 3],
    ]);
    expect(sims[1].unavailableReason).toBe('SIM_CHANGED');
    expect(sims[0]).toMatchObject({ dailyLimit: null, dataUsedMb: null, balance: null });
  });

  it('the USSD test is not faked from the panel', async () => {
    const { services } = setup();
    expect((await failure(services.devices.testUssd('dev-1'))).reason).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('task read model shows the order snapshot, flow and attempts', async () => {
    const { services } = setup();
    const [task] = await services.automation.listTasks();
    expect(task).toMatchObject({
      code: 'MB-20261002-ABCD1234',
      productName: 'Internet 1GB',
      destination: '+258840000777',
      status: 'SUCCESS',
      ussdCode: '*111# › 5 › 840000777 › 1',
      deviceName: 'Worker 1',
      simSlot: 1,
    });
    expect(task.attempts).toEqual([expect.objectContaining({ result: 'success', simSlot: 1, durationMs: 20_000 })]);
  });
});

describe('registry and decisions', () => {
  it('requires a session', async () => {
    const { services, mocks } = setup({}, null);
    expect((await failure(services.deviceRegistry.createDevice('Worker'))).reason).toBe('SESSION_EXPIRED');
    expect(mocks.createDevice).not.toHaveBeenCalled();
  });

  it('creates devices for the session tenant only (never a tenant chosen by the screen)', async () => {
    const { services, mocks } = setup();
    expect(await services.deviceRegistry.createDevice('  Worker Novo  ')).toEqual({
      deviceId: 'dev-new',
      pairingCode: 'ABCD-EF23',
      expiresAt: '2026-10-02T12:15:00.000Z',
    });
    expect(mocks.createDevice).toHaveBeenCalledWith('tenant-a', 'Worker Novo');
  });

  it('validates before the network', async () => {
    const { services, mocks } = setup();
    await failure(services.deviceRegistry.createDevice('X'));
    await failure(services.deviceRegistry.registerSim({ deviceId: 'dev-1', slotIndex: 0, operator: 'mtn' as never }));
    await failure(services.activationTasks.resolve('task-1', 'SUCCESS', '   '));
    await failure(services.activationTasks.resolve('task-1', 'MAYBE' as never, 'nota'));
    expect(mocks.createDevice).not.toHaveBeenCalled();
    expect(mocks.registerSim).not.toHaveBeenCalled();
    expect(mocks.resolveTask).not.toHaveBeenCalled();
  });

  it('decisions go to the backend commands', async () => {
    const { services, mocks } = setup();
    await services.activationTasks.retry('task-1', ' saldo carregado ');
    expect(mocks.retryTask).toHaveBeenCalledWith('task-1', 'saldo carregado');
    await services.activationTasks.resolve('task-1', 'SUCCESS', 'Cliente confirmou');
    expect(mocks.resolveTask).toHaveBeenCalledWith('task-1', 'SUCCESS', 'Cliente confirmou');
    expect(await services.activationTasks.dispatch()).toBe(2);
    expect(mocks.dispatch).toHaveBeenCalledWith('tenant-a');
  });

  it('task detail keeps attempts and history in order', async () => {
    const { services } = setup({ attempts: [attemptRow({ id: 'a2', sequence: 2 }), attemptRow({ id: 'a1', sequence: 1, outcome: 'FAILED', result_code: 'NETWORK_ERROR', retryable: true })] });
    const detail = await services.activationTasks.get('task-1');
    expect(detail.attempts.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(detail).toMatchObject({ order: { code: 'MB-20261002-ABCD1234', price: 777 }, device: { name: 'Worker 1' }, sim: { slotIndex: 0 } });
  });

  it('maps database hints to app errors', () => {
    expect(toActivationError(tagged('55000', 'TASK_NOT_UNKNOWN', 'Só um resultado desconhecido…'))).toMatchObject({ code: 'CONFLICT', reason: 'TASK_NOT_UNKNOWN' });
    expect(toActivationError(tagged('42501', 'TENANT_SUSPENDED', 'A empresa está suspensa.'))).toMatchObject({ reason: 'TENANT_SUSPENDED' });
    expect(toActivationError(tagged('P0002', 'PAIRING_CODE_INVALID', 'Código inválido'))).toMatchObject({ reason: 'PAIRING_CODE_INVALID' });
    expect(toActivationError(tagged('55000', 'INVALID_TRANSITION', 'Transição inválida: SUCCESS → EXECUTING.'))).toMatchObject({
      message: 'Esta ação não é possível no estado atual da tarefa.',
    });
  });
});

describe('worker protocol', () => {
  const identity = { deviceId: 'dev-1', deviceToken: 'mbdt_' + 'b'.repeat(64), deviceName: 'Worker 1', tenantId: 'tenant-a' };

  it('rejects malformed pairing codes before the network', async () => {
    const { services, mocks } = setup();
    expect((await failure(services.worker.register({ pairingCode: '123', deviceIdentifier: 'inst-1', appVersion: '1.0.0' }))).reason).toBe('PAIRING_CODE_INVALID');
    expect(mocks.registerDevice).not.toHaveBeenCalled();
    const id = await services.worker.register({ pairingCode: 'abcd ef23', deviceIdentifier: 'inst-1', appVersion: '1.0.0' });
    expect(mocks.registerDevice).toHaveBeenCalledWith('ABCD-EF23', 'inst-1', '1.0.0');
    expect(id.deviceId).toBe('dev-1');
  });

  it('sends capabilities / telemetry / SIMs in the database format', async () => {
    const { services, mocks } = setup();
    const result = await services.worker.heartbeat(identity, {
      appVersion: '1.0.0',
      capabilities: { ussd: false, ussdInteractive: false },
      telemetry: { model: 'SM-A12' },
      sims: [{ slotIndex: 0, fingerprint: 'sub-0001' }],
    });
    expect(mocks.heartbeat).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      deviceToken: identity.deviceToken,
      appVersion: '1.0.0',
      capabilities: { ussd: false, ussd_interactive: false },
      telemetry: { model: 'SM-A12' },
      sims: [{ slot_index: 0, fingerprint: 'sub-0001' }],
    });
    expect(result.taskId).toBe('task-1');
  });

  it('never executes a payload it cannot validate (fail closed)', async () => {
    const { services, mocks } = setup();
    mocks.fetchTask.mockResolvedValueOnce({ protocol: 'megabot.activation.v1', task_id: 'task-1' });
    expect((await failure(services.worker.fetchTask(identity))).code).toBe('DATABASE_ERROR');
    mocks.fetchTask.mockResolvedValueOnce(null);
    expect(await services.worker.fetchTask(identity)).toBeNull();
  });

  it('result codes are checked before the network', async () => {
    const { services, mocks } = setup();
    await failure(services.worker.reportResult(identity, 'task-1', { outcome: 'SUCCESS', resultCode: 'BOGUS' as never }));
    expect(mocks.reportResult).not.toHaveBeenCalled();
  });
});
