import type {
  ActivationAttemptRecord,
  ActivationPayload,
  ActivationTask,
  ActivationTaskEventRecord,
  ActivationTaskRecord,
  Device,
  DevicePairing,
  DeviceRecord,
  DeviceSimRecord,
  ID,
  Sim,
  TaskAttempt,
  WorkerIdentity,
} from '@/types';
import { ACTIVATION_PROTOCOL } from '@/types';
import { ussdValuesFor } from '@/utils/ussd';

import {
  ACTIVATION_RESULT_CODES,
  assertValidDeviceName,
  assertValidDeviceUpdate,
  assertValidSimInput,
  assertValidSimUpdate,
  canTaskTransition,
  formatPairingCode,
  isAutomaticRetry,
  normalizeDecisionNote,
  normalizePairingCode,
  SUBMITTED_TASK_STATUSES,
  verifyWorkerClaim,
} from '../activationRules';
import { AppError, type AppErrorReason } from '../errors';
import { canTransition, normalizePhone } from '../orderRules';
import type { ActivationTasksService, DeviceRegistryService, WorkerService } from '../types';
import { db, notFound, ownedBy, request } from './db';
import { transition } from './orders';

/*
 * In-memory activation engine for mock mode. It works on the demo read models
 * (db.devices / db.sims / db.tasks) and applies the same rules as migration
 * 006 (activationRules): pairing codes, device tokens, state machine, result
 * verification, retry policy, UNKNOWN never retried.
 */

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const conflict = (message: string, reason?: AppErrorReason) => new AppError('CONFLICT', message, { reason });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/** One-time pairing codes and device tokens (the mock equivalent of device_credentials). */
const pairingCodes = new Map<string, { deviceId: ID; expiresAt: number }>();
const tokens = new Map<string, ID>();
/** Engine-only task state not present in the demo read model. */
const taskEngine = new Map<ID, { simId: ID | null; attemptCount: number; maxAttempts: number; startedAt: string | null; submittedAt: string | null }>();
const attemptLog = new Map<ID, ActivationAttemptRecord[]>();
const eventLog = new Map<ID, ActivationTaskEventRecord[]>();

const engineOf = (task: ActivationTask) => {
  let state = taskEngine.get(task.id);
  if (!state) {
    const executed = task.attempts.filter((a) => !a.result.startsWith('skipped') && a.result !== 'running');
    state = { simId: null, attemptCount: executed.length, maxAttempts: 3, startedAt: null, submittedAt: null };
    taskEngine.set(task.id, state);
  }
  return state;
};

const event = (task: ActivationTask, type: string, from: ActivationTask['status'] | null) => {
  const list = eventLog.get(task.id) ?? [];
  list.push({ id: newId('evt'), taskId: task.id, type: `activation_task.${type}`, fromStatus: from, toStatus: task.status, deviceId: task.deviceId ?? null, simId: engineOf(task).simId, actorUserId: null, at: nowIso() });
  eventLog.set(task.id, list);
};

function setStatus(task: ActivationTask, to: ActivationTask['status'], type: string) {
  if (!canTaskTransition(task.status, to)) {
    throw new AppError('CONFLICT', 'Esta ação não é possível no estado atual da tarefa.', { reason: 'INVALID_TRANSITION' });
  }
  const from = task.status;
  task.status = to;
  task.updatedAt = nowIso();
  event(task, type, from);
}

/** Moves the demo order along the order state machine (never skipping states). */
function syncOrder(task: ActivationTask) {
  const order = db.orders.find((o) => o.id === task.orderId);
  if (!order) return;
  const target =
    task.status === 'SUCCESS' ? 'COMPLETED' : task.status === 'FAILED' ? 'FAILED' : task.status === 'ASSIGNED' || task.status === 'QUEUED' ? 'READY_FOR_ACTIVATION' : 'ACTIVATING';
  const path: Record<string, string[]> = {
    READY_FOR_ACTIVATION: ['READY_FOR_ACTIVATION'],
    ACTIVATING: ['READY_FOR_ACTIVATION', 'ACTIVATING'],
    COMPLETED: ['READY_FOR_ACTIVATION', 'ACTIVATING', 'COMPLETED'],
    FAILED: ['READY_FOR_ACTIVATION', 'FAILED'],
  };
  for (const step of path[target] ?? []) {
    if (order.status !== step && canTransition(order.status, step as typeof order.status)) transition(order, step as typeof order.status);
  }
}

// ─── Read model → records ─────────────────────────────────────────────────────

export function mockDeviceRecord(device: Device): DeviceRecord {
  const registered = device.status !== 'unregistered';
  const createdAt = device.history.at(-1)?.at ?? device.lastSeenAt ?? nowIso();
  return {
    id: device.id,
    tenantId: device.tenantId,
    name: device.name,
    deviceIdentifier: registered ? `mock-${device.id}` : null,
    platform: registered ? 'ANDROID' : null,
    appVersion: device.appVersion,
    status: device.status === 'unregistered' ? 'UNREGISTERED' : device.status === 'paused' ? 'DISABLED' : 'ACTIVE',
    capabilities: {
      ussd: device.capabilities.ussd,
      ussdInteractive: device.capabilities.ussdInteractive,
      sms: device.capabilities.sms,
      multiSim: device.capabilities.dualSim,
    },
    telemetry: {
      ...(device.battery ? { batteryLevel: device.battery.level, charging: device.battery.charging } : {}),
      ...(device.network
        ? { networkType: device.network.type === 'WiFi' ? 'WIFI' : device.network.type === 'none' ? 'NONE' : device.network.type, signalLevel: device.network.signal }
        : {}),
      ...(device.model ? { model: device.model } : {}),
    },
    lastSeenAt: device.lastSeenAt,
    registeredAt: registered ? createdAt : null,
    createdAt,
    updatedAt: device.syncedAt ?? createdAt,
  };
}

export function mockSimRecord(sim: Sim): DeviceSimRecord {
  return {
    id: sim.id,
    tenantId: sim.tenantId,
    deviceId: sim.deviceId,
    slotIndex: sim.slot - 1,
    operator: sim.operator,
    phoneNumber: sim.msisdn ? normalizePhone(sim.msisdn) : null,
    status: sim.status === 'paused' ? 'DISABLED' : sim.status === 'unavailable' ? 'UNAVAILABLE' : 'ACTIVE',
    unavailableReason: sim.status === 'unavailable' ? (sim.unavailableReason ?? 'NOT_DETECTED') : null,
    capabilities: { ussd: true },
    lastSeenAt: sim.lastUsedAt,
    createdAt: sim.lastUsedAt ?? nowIso(),
    updatedAt: sim.lastUsedAt ?? nowIso(),
  };
}

const ATTEMPT_OUTCOME: Record<TaskAttempt['result'], [ActivationAttemptRecord['outcome'], string] | null> = {
  skipped_offline: ['FAILED', 'DEVICE_OFFLINE'],
  skipped_unavailable: ['FAILED', 'SIM_UNAVAILABLE'],
  skipped_limit: ['FAILED', 'SIM_UNAVAILABLE'],
  running: null,
  success: ['SUCCESS', 'ACTIVATED'],
  failed: ['FAILED', 'USSD_REJECTED'],
  timeout: ['UNKNOWN', 'TIMEOUT'],
  unknown: ['UNKNOWN', 'UNKNOWN_RESPONSE'],
};

function attemptsOf(task: ActivationTask): ActivationAttemptRecord[] {
  const fromDemo = task.attempts
    .map((a, index): ActivationAttemptRecord | null => {
      const mapped = ATTEMPT_OUTCOME[a.result];
      if (!mapped) return null;
      return {
        id: a.id,
        taskId: task.id,
        sequence: index + 1,
        attemptNumber: index + 1,
        deviceId: a.deviceId,
        simId: a.simId,
        slotIndex: a.simSlot - 1,
        outcome: mapped[0],
        resultCode: mapped[1],
        retryable: mapped[0] === 'FAILED' && ACTIVATION_RESULT_CODES[mapped[1] as keyof typeof ACTIVATION_RESULT_CODES]?.retryable === true,
        source: 'WORKER',
        ussdTrace: null,
        operatorResponse: null,
        note: null,
        decidedBy: null,
        startedAt: a.durationMs ? new Date(Date.parse(a.at) - a.durationMs).toISOString() : null,
        finishedAt: a.at,
      };
    })
    .filter((a): a is ActivationAttemptRecord => a !== null);
  const live = attemptLog.get(task.id) ?? [];
  return [...fromDemo.filter((a) => !live.some((l) => l.id === a.id)), ...live].map((a, i) => ({ ...a, sequence: i + 1 }));
}

export function mockTaskRecord(task: ActivationTask): ActivationTaskRecord {
  const order = db.orders.find((o) => o.id === task.orderId);
  const product = order ? db.products.find((p) => p.id === order.productId) : undefined;
  const engine = engineOf(task);
  // Like the 006 row, a task that ran keeps the device/SIM of its last attempt (QUEUED clears them).
  const last = task.status === 'QUEUED' ? undefined : attemptsOf(task).at(-1);
  return {
    id: task.id,
    tenantId: task.tenantId,
    orderId: task.orderId,
    productId: order?.productId ?? '',
    deviceId: task.deviceId ?? last?.deviceId ?? null,
    simId: engine.simId ?? last?.simId ?? null,
    status: task.status,
    priority: 0,
    operator: product?.operator ?? 'vodacom',
    ussdFlow: product?.ussdFlow ?? null,
    flowVersion: 1,
    attemptCount: Math.max(engine.attemptCount, attemptsOf(task).filter((a) => a.source === 'WORKER').length),
    maxAttempts: Math.max(engine.maxAttempts, engine.attemptCount),
    assignedAt: null,
    startedAt: engine.startedAt,
    submittedAt: engine.submittedAt,
    completedAt: ['SUCCESS', 'FAILED', 'UNKNOWN'].includes(task.status) ? task.updatedAt : null,
    resultCode: task.resultCode ?? last?.resultCode ?? null,
    resultMessage: task.operatorResponse ?? null,
    failureReason: task.failureReason ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

const findDevice = (tenantId: string, id: ID) => db.devices.filter(ownedBy(tenantId)).find((d) => d.id === id) ?? notFound('Dispositivo');
const findSim = (tenantId: string, id: ID) => db.sims.filter(ownedBy(tenantId)).find((s) => s.id === id) ?? notFound('SIM');
const findTask = (tenantId: string, id: ID) => db.tasks.filter(ownedBy(tenantId)).find((t) => t.id === id) ?? notFound('Tarefa');

function issuePairing(device: Device): DevicePairing {
  for (const [code, entry] of pairingCodes) if (entry.deviceId === device.id) pairingCodes.delete(code);
  const code = randomCode();
  const expiresAt = Date.now() + 15 * 60_000;
  pairingCodes.set(code, { deviceId: device.id, expiresAt });
  return { deviceId: device.id, pairingCode: formatPairingCode(code), expiresAt: new Date(expiresAt).toISOString() };
}

// ─── Services ──────────────────────────────────────────────────────────────────

export const mockDeviceRegistryService: DeviceRegistryService = {
  listDevices: () => request((tenantId) => db.devices.filter(ownedBy(tenantId)).map(mockDeviceRecord), { list: true }),

  getDevice: (id) => request((tenantId) => mockDeviceRecord(findDevice(tenantId, id))),

  async createDevice(name) {
    const valid = assertValidDeviceName(name);
    return request((tenantId) => {
      const device: Device = {
        id: newId('dev'),
        tenantId,
        name: valid,
        role: 'worker',
        model: null,
        androidVersion: null,
        appVersion: null,
        status: 'unregistered',
        battery: null,
        network: null,
        lastSeenAt: null,
        syncedAt: null,
        simIds: [],
        capabilities: { ussd: false, ussdInteractive: false, sms: false, dualSim: false },
        usage: { tasksToday: 0, successToday: 0, failedToday: 0, capacityPerDay: null },
        errors: [],
        history: [{ id: newId('hst'), at: nowIso(), type: 'sync', title: 'Dispositivo criado' }],
      };
      db.devices.push(device);
      return issuePairing(device);
    });
  },

  createPairingCode: (deviceId) =>
    request((tenantId) => {
      const device = findDevice(tenantId, deviceId);
      if (device.status === 'paused') throw conflict('Ative o dispositivo antes de o emparelhar.', 'DEVICE_DISABLED');
      return issuePairing(device);
    }),

  async updateDevice(id, input) {
    const valid = assertValidDeviceUpdate(input);
    return request((tenantId) => {
      const device = findDevice(tenantId, id);
      if (valid.status && device.status === 'unregistered') throw conflict('O dispositivo ainda não foi emparelhado.', 'DEVICE_NOT_REGISTERED');
      if (valid.name) device.name = valid.name;
      if (valid.status) device.status = valid.status === 'DISABLED' ? 'paused' : 'online';
      return mockDeviceRecord(device);
    });
  },

  listSims: (params = {}) =>
    request(
      (tenantId) => db.sims.filter(ownedBy(tenantId)).filter((s) => !params.deviceId || s.deviceId === params.deviceId).map(mockSimRecord),
      { list: true }
    ),

  async registerSim(input) {
    const valid = assertValidSimInput(input);
    return request((tenantId) => {
      const device = findDevice(tenantId, valid.deviceId);
      if (db.sims.some((s) => s.deviceId === device.id && s.slot === valid.slotIndex + 1)) {
        throw conflict('Já existe um SIM registado neste slot.', 'SIM_SLOT_TAKEN');
      }
      const sim: Sim = {
        id: newId('sim'),
        tenantId,
        deviceId: device.id,
        deviceName: device.name,
        slot: valid.slotIndex + 1,
        operator: valid.operator,
        msisdn: valid.phoneNumber,
        status: 'available',
        unavailableReason: null,
        activationsToday: 0,
        dailyLimit: null,
        dataUsedMb: null,
        dataTotalMb: null,
        paymentWallet: null,
        balance: null,
        lastUsedAt: null,
      };
      db.sims.push(sim);
      device.simIds.push(sim.id);
      return mockSimRecord(sim);
    });
  },

  async updateSim(id, input) {
    const valid = assertValidSimUpdate(input);
    return request((tenantId) => {
      const sim = findSim(tenantId, id);
      if (valid.operator) sim.operator = valid.operator;
      if (valid.phoneNumber !== undefined) sim.msisdn = valid.phoneNumber;
      if (valid.status) {
        sim.status = valid.status === 'DISABLED' ? 'paused' : 'available';
        sim.unavailableReason = null;
      }
      return mockSimRecord(sim);
    });
  },
};

export const mockActivationTasksService: ActivationTasksService = {
  list: (params = {}) =>
    request(
      (tenantId) =>
        db.tasks
          .filter(ownedBy(tenantId))
          .filter((t) => (!params.status || t.status === params.status) && (!params.orderId || t.orderId === params.orderId))
          .map(mockTaskRecord),
      { list: true }
    ),

  get: (id) =>
    request((tenantId) => {
      const task = findTask(tenantId, id);
      const order = db.orders.find((o) => o.id === task.orderId);
      const record = mockTaskRecord(task);
      const device = record.deviceId ? db.devices.find((d) => d.id === record.deviceId) : undefined;
      const sim = record.simId ? db.sims.find((s) => s.id === record.simId) : undefined;
      return {
        task: record,
        attempts: attemptsOf(task),
        events: eventLog.get(task.id) ?? [],
        order: order ? { code: order.code, productName: order.productName, destination: order.destination ?? '', price: order.price, currency: order.currency } : null,
        device: device ? mockDeviceRecord(device) : null,
        sim: sim ? mockSimRecord(sim) : null,
      };
    }),

  dispatch: () => request(() => 0),

  async retry(id, note) {
    normalizeDecisionNote(note, { required: false });
    return request((tenantId) => {
      const task = findTask(tenantId, id);
      if (task.status !== 'FAILED') throw conflict('Só uma tarefa falhada pode ser repetida.', 'TASK_NOT_RETRYABLE');
      const engine = engineOf(task);
      engine.maxAttempts = Math.max(engine.maxAttempts, engine.attemptCount + 1);
      task.deviceId = null;
      engine.simId = null;
      setStatus(task, 'QUEUED', 'retried');
      syncOrder(task);
      return mockTaskRecord(task);
    });
  },

  async resolve(id, outcome, note) {
    const valid = normalizeDecisionNote(note, { required: true });
    return request((tenantId) => {
      const task = findTask(tenantId, id);
      if (task.status !== 'UNKNOWN') throw conflict('Só um resultado desconhecido é decidido manualmente.', 'TASK_NOT_UNKNOWN');
      const engine = engineOf(task);
      const list = attemptLog.get(task.id) ?? [];
      list.push({
        id: newId('att'),
        taskId: task.id,
        sequence: 0,
        attemptNumber: engine.attemptCount,
        deviceId: task.deviceId ?? null,
        simId: engine.simId,
        slotIndex: null,
        outcome,
        resultCode: outcome === 'SUCCESS' ? 'MANUAL_CONFIRMED' : 'MANUAL_REJECTED',
        retryable: false,
        source: 'MANUAL',
        ussdTrace: null,
        operatorResponse: null,
        note: valid,
        decidedBy: 'usr_01',
        startedAt: null,
        finishedAt: nowIso(),
      });
      attemptLog.set(task.id, list);
      task.resultCode = outcome === 'SUCCESS' ? 'MANUAL_CONFIRMED' : 'MANUAL_REJECTED';
      task.failureReason = outcome === 'FAILED' ? valid : null;
      setStatus(task, outcome, 'resolved');
      syncOrder(task);
      return mockTaskRecord(task);
    });
  },
};

// ─── Worker protocol (mock) ────────────────────────────────────────────────────

function authenticate(identity: WorkerIdentity): Device {
  const deviceId = tokens.get(identity.deviceToken);
  const device = deviceId === identity.deviceId ? db.devices.find((d) => d.id === deviceId) : undefined;
  if (!device) throw new AppError('NOT_FOUND', 'Dispositivo não encontrado.');
  if (device.status === 'paused') throw new AppError('PERMISSION_DENIED', 'Este dispositivo foi desativado.', { reason: 'DEVICE_DISABLED' });
  return device;
}

function payloadOf(task: ActivationTask): ActivationPayload {
  const order = db.orders.find((o) => o.id === task.orderId);
  const product = order ? db.products.find((p) => p.id === order.productId) : undefined;
  const engine = engineOf(task);
  const sim = db.sims.find((s) => s.id === engine.simId);
  if (!order || !product?.ussdFlow || !sim || !task.deviceId) throw new AppError('NOT_FOUND', 'Tarefa não encontrada.');
  const destination = normalizePhone(order.destination) ?? '+258840000000';
  const values = ussdValuesFor({ dataAmount: order.dataAmount, dataUnit: order.dataUnit, price: order.price }, destination.replace(/^\+258/, ''));
  return {
    protocol: ACTIVATION_PROTOCOL,
    taskId: task.id,
    orderId: order.id,
    productId: product.id,
    deviceId: task.deviceId,
    simId: sim.id,
    status: task.status,
    attempt: engine.attemptCount,
    operator: product.operator,
    sim: { slotIndex: sim.slot - 1, fingerprint: null, operator: sim.operator },
    destinationNumber: destination,
    flowVersion: 1,
    flow: product.ussdFlow,
    values,
    limits: { stepTimeoutMs: 30_000, sessionTimeoutMs: 120_000 },
  };
}

export const mockWorkerService: WorkerService = {
  register: async ({ pairingCode, deviceIdentifier, appVersion }) =>
    request(() => {
      const code = normalizePairingCode(pairingCode);
      const entry = code ? pairingCodes.get(code) : undefined;
      if (!code || !entry || entry.expiresAt < Date.now()) {
        throw new AppError('VALIDATION_ERROR', 'Código de emparelhamento inválido ou expirado.', { reason: 'PAIRING_CODE_INVALID' });
      }
      const device = db.devices.find((d) => d.id === entry.deviceId) ?? notFound('Dispositivo');
      pairingCodes.delete(code);
      for (const [token, id] of tokens) if (id === device.id) tokens.delete(token);
      const token = `mbdt_${Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;
      tokens.set(token, device.id);
      device.status = 'online';
      device.appVersion = appVersion;
      device.lastSeenAt = nowIso();
      device.syncedAt = device.lastSeenAt;
      device.history.unshift({ id: newId('hst'), at: nowIso(), type: 'sync', title: `Telemóvel emparelhado (${deviceIdentifier})` });
      return { deviceId: device.id, deviceToken: token, deviceName: device.name, tenantId: device.tenantId };
    }),

  heartbeat: async (identity, report) =>
    request(() => {
      const device = authenticate(identity);
      device.lastSeenAt = nowIso();
      device.syncedAt = device.lastSeenAt;
      if (report.appVersion) device.appVersion = report.appVersion;
      if (report.capabilities) {
        device.capabilities = {
          ussd: !!report.capabilities.ussd,
          ussdInteractive: !!report.capabilities.ussdInteractive,
          sms: !!report.capabilities.sms,
          dualSim: !!report.capabilities.multiSim,
        };
      }
      const t = report.telemetry;
      if (t?.batteryLevel !== undefined) device.battery = { level: t.batteryLevel, charging: !!t.charging };
      if (t?.model) device.model = t.model;
      const task = db.tasks.find((x) => x.deviceId === device.id && ['ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'].includes(x.status));
      return { deviceId: device.id, serverTime: nowIso(), heartbeatTimeoutSeconds: 120, taskId: task?.id ?? null };
    }),

  fetchTask: async (identity) =>
    request(() => {
      const device = authenticate(identity);
      let task = db.tasks.find((x) => x.deviceId === device.id && ['ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'].includes(x.status));
      if (!task && device.capabilities.ussd && device.capabilities.ussdInteractive) {
        // Mock dispatcher: oldest QUEUED task whose network matches a free active SIM of this device.
        const sims = db.sims.filter((s) => s.deviceId === device.id && s.status === 'available');
        task = db.tasks
          .filter((x) => x.tenantId === device.tenantId && x.status === 'QUEUED')
          .find((x) => {
            const order = db.orders.find((o) => o.id === x.orderId);
            const product = order ? db.products.find((p) => p.id === order.productId) : undefined;
            const sim = product?.ussdFlow ? sims.find((s) => s.operator === product.operator) : undefined;
            if (!sim) return false;
            engineOf(x).simId = sim.id;
            return true;
          });
        if (task) {
          task.deviceId = device.id;
          task.deviceName = device.name;
          setStatus(task, 'ASSIGNED', 'assigned');
          syncOrder(task);
        }
      }
      return task ? payloadOf(task) : null;
    }),

  startTask: async (identity, taskId) =>
    request(() => {
      const device = authenticate(identity);
      const task = db.tasks.find((x) => x.id === taskId && x.deviceId === device.id) ?? notFound('Tarefa');
      if (task.status !== 'ASSIGNED') throw conflict('A tarefa não está atribuída a este dispositivo para execução.', 'TASK_NOT_ASSIGNED');
      const engine = engineOf(task);
      engine.attemptCount += 1;
      engine.startedAt = nowIso();
      setStatus(task, 'EXECUTING', 'started');
      syncOrder(task);
      return payloadOf(task);
    }),

  reportProgress: async (identity, taskId, status) =>
    request(() => {
      const device = authenticate(identity);
      const task = db.tasks.find((x) => x.id === taskId && x.deviceId === device.id) ?? notFound('Tarefa');
      const expected = status === 'SUBMITTED' ? 'EXECUTING' : 'SUBMITTED';
      if (task.status !== expected) throw conflict('A tarefa não está neste passo neste dispositivo.', 'TASK_NOT_ASSIGNED');
      if (status === 'SUBMITTED') engineOf(task).submittedAt = nowIso();
      setStatus(task, status, status === 'SUBMITTED' ? 'submitted' : 'verifying');
    }),

  reportResult: async (identity, taskId, report) =>
    request(() => {
      const device = authenticate(identity);
      const task = db.tasks.find((x) => x.id === taskId && x.deviceId === device.id) ?? notFound('Tarefa');
      if (!['ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'].includes(task.status)) {
        throw conflict('A tarefa já não está em execução neste dispositivo.', 'TASK_NOT_ASSIGNED');
      }
      const info = ACTIVATION_RESULT_CODES[report.resultCode];
      if (!info?.worker || !info.outcomes.includes(report.outcome)) throw new AppError('VALIDATION_ERROR', 'Código de resultado inválido.');
      if (task.status === 'ASSIGNED' && report.outcome !== 'FAILED') throw conflict('A tarefa não foi iniciada.', 'TASK_NOT_ASSIGNED');
      const order = db.orders.find((o) => o.id === task.orderId);
      const product = order ? db.products.find((p) => p.id === order.productId) : undefined;
      const engine = engineOf(task);
      if (task.status === 'ASSIGNED') engine.attemptCount += 1;
      const verified = verifyWorkerClaim(product?.ussdFlow ?? null, report, SUBMITTED_TASK_STATUSES.includes(task.status));
      const sim = db.sims.find((s) => s.id === engine.simId);
      task.attempts.push({
        id: newId('att'),
        deviceId: device.id,
        deviceName: device.name,
        simId: sim?.id ?? '',
        simSlot: sim?.slot ?? 1,
        result: verified.outcome === 'SUCCESS' ? 'success' : verified.outcome === 'FAILED' ? 'failed' : 'unknown',
        reason: ACTIVATION_RESULT_CODES[verified.resultCode].text,
        at: nowIso(),
      });
      task.resultCode = verified.resultCode;
      task.operatorResponse = report.operatorResponse ?? undefined;
      task.failureReason = verified.outcome === 'FAILED' ? verified.resultCode : null;
      setStatus(task, verified.outcome, verified.outcome === 'SUCCESS' ? 'completed' : verified.outcome === 'FAILED' ? 'failed' : 'unknown');
      if (verified.resultCode === 'SIM_UNAVAILABLE' && sim) {
        sim.status = 'unavailable';
        sim.unavailableReason = 'NOT_DETECTED';
      }
      if (isAutomaticRetry(verified.outcome, verified.resultCode, engine.attemptCount, engine.maxAttempts)) {
        task.deviceId = null;
        engine.simId = null;
        setStatus(task, 'QUEUED', 'retried');
      } else {
        syncOrder(task);
      }
      return mockTaskRecord(task);
    }),
};
