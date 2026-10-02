/**
 * Activation engine on Supabase (migration 006): rows ↔ domain, database
 * errors → AppErrors, and the read models of the existing Devices / SIMs /
 * Automation screens. Authorization, the state machine, the dispatcher and the
 * verification of results live in the database; this layer maps and validates.
 * Fields the backend does not know are `null` — nothing is invented.
 */
import type {
  ActivationAttemptRecord,
  ActivationPayload,
  ActivationTask,
  ActivationTaskEventRecord,
  ActivationTaskRecord,
  AttemptResult,
  AutomationStats,
  Device,
  DeviceEvent,
  DevicePairing,
  DeviceRecord,
  DeviceSimRecord,
  DevicesSummary,
  ID,
  NetworkType,
  Operator,
  Sim,
  TaskAttempt,
  WorkerIdentity,
} from '@/types';
import { describeUssdFlow, ussdValuesFor } from '@/utils/ussd';

import {
  assertValidDeviceName,
  assertValidDeviceUpdate,
  assertValidSimInput,
  assertValidSimUpdate,
  capabilitiesFromWire,
  capabilitiesToWire,
  formatPairingCode,
  heartbeatTimeoutSeconds,
  isActivationResultCode,
  isDeviceOnline,
  isOperator,
  isTaskStatus,
  isToday,
  normalizeDecisionNote,
  normalizePairingCode,
  parseActivationPayload,
  resultCodeText,
  RUNNING_TASK_STATUSES,
  telemetryFromWire,
  telemetryToWire,
  ACTIVATION_RULES,
} from '../activationRules';
import { serviceContext } from '../context';
import { AppError, type AppErrorCode, type AppErrorReason } from '../errors';
import { parseUssdFlow } from '../ussdFlow';
import type {
  ActivationTasksService,
  AutomationService,
  DeviceRegistryService,
  DevicesService,
  SimsService,
  WorkerService,
} from '../types';
import type {
  ActivationAttemptRow,
  ActivationEventRow,
  ActivationGateway,
  ActivationOrderRow,
  ActivationTaskRow,
  DeviceRow,
  DeviceSimRow,
  PairingRow,
} from './activationGateway';
import { postgrestReason, toAppError } from './errors';

const LIST_LIMIT = 200;

// ─── Rows → records ─────────────────────────────────────────────────────────────

export function toDeviceRecord(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.device_name,
    deviceIdentifier: row.device_identifier,
    platform: row.platform === 'ANDROID' ? 'ANDROID' : null,
    appVersion: row.app_version,
    status: row.status === 'ACTIVE' || row.status === 'DISABLED' ? row.status : 'UNREGISTERED',
    capabilities: capabilitiesFromWire(row.capabilities),
    telemetry: telemetryFromWire(row.telemetry),
    lastSeenAt: row.last_seen_at,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** SIMs of an operator this app version does not know are left out (never shown as another network). */
export function toSimRecord(row: DeviceSimRow): DeviceSimRecord | null {
  if (!isOperator(row.operator)) return null;
  const caps = typeof row.capabilities === 'object' && row.capabilities !== null && !Array.isArray(row.capabilities) ? row.capabilities : {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deviceId: row.device_id,
    slotIndex: row.slot_index,
    operator: row.operator,
    phoneNumber: row.phone_number,
    status: row.status === 'ACTIVE' || row.status === 'DISABLED' ? row.status : 'UNAVAILABLE',
    unavailableReason: row.unavailable_reason === 'SIM_CHANGED' || row.unavailable_reason === 'NOT_DETECTED' ? row.unavailable_reason : null,
    capabilities: {
      ussd: typeof caps.ussd === 'boolean' ? caps.ussd : undefined,
      sms: typeof caps.sms === 'boolean' ? caps.sms : undefined,
    },
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTaskRecord(row: ActivationTaskRow): ActivationTaskRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    productId: row.product_id,
    deviceId: row.device_id,
    simId: row.sim_id,
    // Unknown (newer) statuses surface as needing a person — never as success.
    status: isTaskStatus(row.status) ? row.status : 'UNKNOWN',
    priority: row.priority,
    operator: isOperator(row.operator) ? row.operator : ('vodacom' as Operator),
    ussdFlow: parseUssdFlow(row.ussd_flow),
    flowVersion: row.flow_version,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    resultCode: row.result_code,
    resultMessage: row.result_message,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAttemptRecord(row: ActivationAttemptRow): ActivationAttemptRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sequence: row.sequence,
    attemptNumber: row.attempt_number,
    deviceId: row.device_id,
    simId: row.sim_id,
    slotIndex: row.slot_index,
    outcome: row.outcome === 'SUCCESS' || row.outcome === 'FAILED' ? row.outcome : 'UNKNOWN',
    resultCode: row.result_code,
    retryable: row.retryable,
    source: row.source === 'SYSTEM' || row.source === 'MANUAL' ? row.source : 'WORKER',
    ussdTrace: row.ussd_trace,
    operatorResponse: row.operator_response,
    note: row.note,
    decidedBy: row.decided_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function toEventRecord(row: ActivationEventRow): ActivationTaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.event_type,
    fromStatus: row.from_status && isTaskStatus(row.from_status) ? row.from_status : null,
    toStatus: isTaskStatus(row.to_status) ? row.to_status : 'UNKNOWN',
    deviceId: row.device_id,
    simId: row.sim_id,
    actorUserId: row.actor_user_id,
    at: row.created_at,
  };
}

const toPairing = (row: PairingRow | undefined): DevicePairing => {
  if (!row) throw new AppError('NOT_FOUND', 'Dispositivo não encontrado.');
  return { deviceId: row.device_id, pairingCode: row.pairing_code, expiresAt: row.pairing_expires_at };
};

const known = <T>(values: (T | null)[]): T[] => values.filter((value): value is T => value !== null);

// ─── Read models of the existing screens ───────────────────────────────────────

const NETWORK: Record<string, NetworkType> = { '5G': '5G', '4G': '4G', '3G': '3G', '2G': '2G', WIFI: 'WiFi', NONE: 'none' };

export const EVENT_TEXT: Record<string, string> = {
  'activation_task.created': 'Tarefa criada (pedido pago)',
  'activation_task.assigned': 'Atribuída a um dispositivo',
  'activation_task.unassigned': 'Devolvida à fila',
  'activation_task.started': 'Execução iniciada',
  'activation_task.submitted': 'USSD submetido à operadora',
  'activation_task.verifying': 'A verificar o resultado',
  'activation_task.completed': 'Ativação confirmada',
  'activation_task.failed': 'Falhou',
  'activation_task.unknown': 'Sem confirmação (UNKNOWN)',
  'activation_task.retried': 'Nova tentativa',
  'activation_task.resolved': 'Decidido manualmente',
};

const ATTEMPT_RESULT: Record<ActivationAttemptRecord['outcome'], AttemptResult> = {
  SUCCESS: 'success',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
};

type DeviceContext = {
  sims: DeviceSimRecord[];
  attempts: ActivationAttemptRecord[];
  events: ActivationTaskEventRecord[];
  timeoutSeconds: number;
  now: number;
};

export function toDeviceView(record: DeviceRecord, { sims, attempts, events, timeoutSeconds, now }: DeviceContext): Device {
  const online = isDeviceOnline(record, now, timeoutSeconds);
  const t = record.telemetry;
  const today = attempts.filter((a) => a.deviceId === record.id && a.source === 'WORKER' && isToday(a.finishedAt, now));
  const recent = attempts.filter(
    (a) => a.deviceId === record.id && a.outcome !== 'SUCCESS' && Date.parse(a.finishedAt) >= now - 24 * 3600_000
  );
  const history: DeviceEvent[] = events
    .filter((e) => e.deviceId === record.id)
    .slice(0, 10)
    .map((e) => ({ id: e.id, at: e.at, type: 'task', title: EVENT_TEXT[e.type] ?? e.type }));
  if (record.registeredAt) history.push({ id: `${record.id}-registered`, at: record.registeredAt, type: 'sync', title: 'Telemóvel emparelhado' });
  history.push({ id: `${record.id}-created`, at: record.createdAt, type: 'sync', title: 'Dispositivo criado' });
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    role: 'worker',
    model: t.model ?? null,
    androidVersion: t.osVersion ? `Android ${t.osVersion}` : null,
    appVersion: record.appVersion,
    status:
      record.status === 'UNREGISTERED' ? 'unregistered' : record.status === 'DISABLED' ? 'paused' : online ? 'online' : 'offline',
    battery: typeof t.batteryLevel === 'number' ? { level: t.batteryLevel, charging: t.charging ?? false } : null,
    network: t.networkType ? { type: NETWORK[t.networkType] ?? 'none', signal: t.signalLevel ?? 0 } : null,
    lastSeenAt: record.lastSeenAt,
    syncedAt: record.lastSeenAt,
    simIds: sims.filter((s) => s.deviceId === record.id).map((s) => s.id),
    capabilities: {
      ussd: !!record.capabilities.ussd,
      ussdInteractive: !!record.capabilities.ussdInteractive,
      sms: !!record.capabilities.sms,
      dualSim: !!record.capabilities.multiSim,
    },
    usage: {
      tasksToday: today.length,
      successToday: today.filter((a) => a.outcome === 'SUCCESS').length,
      failedToday: today.filter((a) => a.outcome !== 'SUCCESS').length,
      capacityPerDay: null,
    },
    errors: recent.map((a) => ({
      id: a.id,
      at: a.finishedAt,
      code: a.resultCode,
      message: resultCodeText(a.resultCode) ?? a.resultCode,
      severity: a.outcome === 'UNKNOWN' ? 'warning' : 'danger',
    })),
    history: history.sort((a, b) => b.at.localeCompare(a.at)),
  };
}

type SimContext = {
  devices: DeviceRecord[];
  tasks: ActivationTaskRecord[];
  attempts: ActivationAttemptRecord[];
  timeoutSeconds: number;
  now: number;
};

export function toSimView(record: DeviceSimRecord, { devices, tasks, attempts, timeoutSeconds, now }: SimContext): Sim {
  const device = devices.find((d) => d.id === record.deviceId);
  const busy = tasks.some((t) => t.simId === record.id && RUNNING_TASK_STATUSES.includes(t.status));
  const own = attempts.filter((a) => a.simId === record.id && a.source === 'WORKER');
  let status: Sim['status'];
  if (record.status === 'DISABLED') status = 'paused';
  else if (record.status === 'UNAVAILABLE') status = 'unavailable';
  else if (!device || !isDeviceOnline(device, now, timeoutSeconds)) status = 'offline';
  else status = busy ? 'busy' : 'available';
  return {
    id: record.id,
    tenantId: record.tenantId,
    deviceId: record.deviceId,
    deviceName: device?.name ?? 'Dispositivo',
    slot: record.slotIndex + 1,
    operator: record.operator,
    msisdn: record.phoneNumber,
    status,
    unavailableReason: record.unavailableReason,
    activationsToday: own.filter((a) => a.outcome === 'SUCCESS' && isToday(a.finishedAt, now)).length,
    dailyLimit: null,
    dataUsedMb: null,
    dataTotalMb: null,
    paymentWallet: null,
    balance: null,
    lastUsedAt: own[0]?.finishedAt ?? null,
  };
}

type TaskContext = {
  orders: Map<ID, ActivationOrderRow>;
  attempts: ActivationAttemptRecord[];
  devices: DeviceRecord[];
  sims: DeviceSimRecord[];
};

export function toTaskView(record: ActivationTaskRecord, { orders, attempts, devices, sims }: TaskContext): ActivationTask {
  const order = orders.get(record.orderId);
  const deviceName = (id: ID | null) => devices.find((d) => d.id === id)?.name ?? 'Dispositivo';
  const sim = sims.find((s) => s.id === record.simId);
  const own = attempts
    .filter((a) => a.taskId === record.id && a.source !== 'MANUAL')
    .sort((a, b) => a.sequence - b.sequence);
  const values = order
    ? ussdValuesFor(
        {
          dataAmount: order.data_amount_snapshot === null ? null : Number(order.data_amount_snapshot),
          dataUnit: order.data_unit_snapshot === 'MB' || order.data_unit_snapshot === 'GB' ? order.data_unit_snapshot : null,
          price: Number(order.product_price_snapshot),
        },
        // What the worker really dials (same as private.activation_payload): local 9 digits in Mozambique.
        order.customer_phone.replace(/^\+258/, '')
      )
    : {};
  const attemptsView: TaskAttempt[] = own.map((a) => ({
    id: a.id,
    deviceId: a.deviceId ?? '',
    deviceName: deviceName(a.deviceId),
    simId: a.simId ?? '',
    simSlot: (a.slotIndex ?? 0) + 1,
    result: ATTEMPT_RESULT[a.outcome],
    reason: resultCodeText(a.resultCode),
    at: a.finishedAt,
    durationMs: a.startedAt ? Math.max(0, Date.parse(a.finishedAt) - Date.parse(a.startedAt)) : undefined,
  }));
  return {
    id: record.id,
    tenantId: record.tenantId,
    code: order?.public_reference ?? record.id.slice(0, 8).toUpperCase(),
    orderId: record.orderId,
    orderCode: order?.public_reference ?? '',
    productName: order?.product_name_snapshot ?? 'Produto',
    destination: order?.customer_phone ?? '',
    status: record.status,
    ussdCode: record.ussdFlow ? describeUssdFlow(record.ussdFlow, values) : '',
    attempts: attemptsView,
    operatorResponse: record.resultMessage ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deviceId: record.deviceId,
    deviceName: record.deviceId ? deviceName(record.deviceId) : null,
    simSlot: sim ? sim.slotIndex + 1 : null,
    attemptCount: record.attemptCount,
    maxAttempts: record.maxAttempts,
    resultCode: record.resultCode,
    failureReason: record.failureReason,
  };
}

export function toAutomationStats(tasks: ActivationTaskRecord[], attempts: ActivationAttemptRecord[], now = Date.now()): AutomationStats {
  const today = tasks.filter((t) => isToday(t.createdAt, now));
  const success = today.filter((t) => t.status === 'SUCCESS');
  const finished = today.filter((t) => t.status === 'SUCCESS' || t.status === 'FAILED');
  const durations = success
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => (Date.parse(t.completedAt as string) - Date.parse(t.startedAt as string)) / 1000);
  return {
    tasksToday: today.length,
    successRate: finished.length ? success.length / finished.length : 1,
    avgActivationSeconds: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
    failoversToday: today.filter((t) => new Set(attempts.filter((a) => a.taskId === t.id && a.simId).map((a) => a.simId)).size > 1).length,
    unknownToday: today.filter((t) => t.status === 'UNKNOWN' || t.status === 'VERIFYING').length,
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────────

const REASONS: Record<string, { code: AppErrorCode; reason?: AppErrorReason; message?: string }> = {
  TENANT_SUSPENDED: { code: 'PERMISSION_DENIED', reason: 'TENANT_SUSPENDED' },
  DEVICE_WRITE_DENIED: { code: 'PERMISSION_DENIED', reason: 'DEVICE_WRITE_DENIED' },
  DEVICE_NOT_FOUND: { code: 'NOT_FOUND' },
  SIM_NOT_FOUND: { code: 'NOT_FOUND' },
  TASK_NOT_FOUND: { code: 'NOT_FOUND' },
  PAIRING_CODE_INVALID: { code: 'VALIDATION_ERROR', reason: 'PAIRING_CODE_INVALID' },
  DEVICE_DISABLED: { code: 'PERMISSION_DENIED', reason: 'DEVICE_DISABLED' },
  DEVICE_NOT_REGISTERED: { code: 'CONFLICT', reason: 'DEVICE_NOT_REGISTERED' },
  DEVICE_IDENTIFIER_TAKEN: { code: 'CONFLICT', reason: 'DEVICE_IDENTIFIER_TAKEN' },
  SIM_SLOT_TAKEN: { code: 'CONFLICT', reason: 'SIM_SLOT_TAKEN' },
  SIM_BUSY: { code: 'CONFLICT' },
  TASK_NOT_RETRYABLE: { code: 'CONFLICT', reason: 'TASK_NOT_RETRYABLE' },
  TASK_NOT_UNKNOWN: { code: 'CONFLICT', reason: 'TASK_NOT_UNKNOWN' },
  TASK_NOT_ASSIGNED: { code: 'CONFLICT', reason: 'TASK_NOT_ASSIGNED' },
  INVALID_TRANSITION: { code: 'CONFLICT', reason: 'INVALID_TRANSITION', message: 'Esta ação não é possível no estado atual da tarefa.' },
  INVALID_DEVICE_NAME: { code: 'VALIDATION_ERROR' },
  INVALID_STATUS: { code: 'VALIDATION_ERROR' },
  INVALID_SLOT: { code: 'VALIDATION_ERROR' },
  INVALID_OPERATOR: { code: 'VALIDATION_ERROR' },
  INVALID_PHONE: { code: 'VALIDATION_ERROR', reason: 'INVALID_PHONE' },
  INVALID_REASON: { code: 'VALIDATION_ERROR' },
  INVALID_RESULT: { code: 'VALIDATION_ERROR' },
  INVALID_DEVICE_IDENTIFIER: { code: 'VALIDATION_ERROR' },
  INVALID_PLATFORM: { code: 'VALIDATION_ERROR' },
  INVALID_APP_VERSION: { code: 'VALIDATION_ERROR' },
  INVALID_CAPABILITIES: { code: 'VALIDATION_ERROR' },
  INVALID_TELEMETRY: { code: 'VALIDATION_ERROR' },
  INVALID_SIMS: { code: 'VALIDATION_ERROR' },
  IMMUTABLE_SIM: { code: 'CONFLICT' },
  IMMUTABLE_DEVICE: { code: 'CONFLICT' },
};

export function toActivationError(error: unknown): AppError {
  const tagged = postgrestReason(error);
  if (!tagged) return toAppError(error);
  const known = REASONS[tagged.hint];
  if (!known) return toAppError(error);
  return new AppError(known.code, known.message ?? tagged.message, { reason: known.reason, detail: `${tagged.hint} | ${tagged.message}` });
}

// ─── Services ───────────────────────────────────────────────────────────────────

export type SupabaseActivationServices = {
  devices: DevicesService;
  sims: SimsService;
  automation: AutomationService;
  deviceRegistry: DeviceRegistryService;
  activationTasks: ActivationTasksService;
  worker: WorkerService;
};

export function createSupabaseActivationServices(
  gateway: ActivationGateway,
  /** Automation switches are not on the backend yet: they keep their current behaviour. */
  settings: Pick<AutomationService, 'getSettings' | 'updateSettings'>,
  getTenantId: () => ID | null = () => serviceContext.getTenant(),
  clock: () => number = () => Date.now()
): SupabaseActivationServices {
  const tenantId = () => {
    const id = getTenantId();
    if (!id) throw new AppError('AUTH_ERROR', 'Sessão expirada. Entre novamente.', { reason: 'SESSION_EXPIRED' });
    return id;
  };

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toActivationError(error);
    }
  }

  const first = <T>(rows: T[], entity: string): T => {
    const [row] = rows;
    if (!row) throw new AppError('NOT_FOUND', `${entity} não encontrado.`);
    return row;
  };

  const sinceYesterday = () => new Date(clock() - 24 * 3600_000).toISOString();

  /** Everything the device / SIM read models need, in parallel. */
  async function loadFleet(tenant: string) {
    const [deviceRows, simRows, taskRows, attemptRows, eventRows, automation] = await Promise.all([
      gateway.listDevices(tenant),
      gateway.listSims(tenant, null),
      gateway.listTasks(tenant, { status: null, orderId: null, ids: null, limit: LIST_LIMIT }),
      gateway.listAttempts(tenant, { taskIds: null, deviceId: null, since: sinceYesterday(), limit: 500 }),
      gateway.listEvents(tenant, { taskId: null, deviceId: null, limit: LIST_LIMIT }),
      gateway.automationSettings(tenant),
    ]);
    return {
      devices: deviceRows.map(toDeviceRecord),
      sims: known(simRows.map(toSimRecord)),
      tasks: taskRows.map(toTaskRecord),
      attempts: attemptRows.map(toAttemptRecord),
      events: eventRows.map(toEventRecord),
      timeoutSeconds: heartbeatTimeoutSeconds(automation),
      now: clock(),
    };
  }

  const deviceView = (fleet: Awaited<ReturnType<typeof loadFleet>>, record: DeviceRecord) =>
    toDeviceView(record, { sims: fleet.sims, attempts: fleet.attempts, events: fleet.events, timeoutSeconds: fleet.timeoutSeconds, now: fleet.now });

  const simView = (fleet: Awaited<ReturnType<typeof loadFleet>>, record: DeviceSimRecord) =>
    toSimView(record, { devices: fleet.devices, tasks: fleet.tasks, attempts: fleet.attempts, timeoutSeconds: fleet.timeoutSeconds, now: fleet.now });

  // ── Existing screens ──

  const devices: DevicesService = {
    async list() {
      const tenant = tenantId();
      return run(async () => {
        const fleet = await loadFleet(tenant);
        return fleet.devices.map((d) => deviceView(fleet, d));
      });
    },

    async summary() {
      const tenant = tenantId();
      return run(async (): Promise<DevicesSummary> => {
        const fleet = await loadFleet(tenant);
        const views = fleet.devices.map((d) => deviceView(fleet, d));
        const sims = fleet.sims.map((s) => simView(fleet, s));
        return {
          online: views.filter((d) => d.status === 'online').length,
          total: views.length,
          simsAvailable: sims.filter((s) => s.status === 'available').length,
          simsTotal: sims.length,
          capacityUsed: fleet.attempts.filter((a) => a.source === 'WORKER' && a.outcome === 'SUCCESS' && isToday(a.finishedAt, fleet.now)).length,
          capacityTotal: null,
        };
      });
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => {
        const fleet = await loadFleet(tenant);
        const record = fleet.devices.find((d) => d.id === id);
        if (!record) throw new AppError('NOT_FOUND', 'Dispositivo não encontrado.');
        return deviceView(fleet, record);
      });
    },

    async setPaused(id, paused) {
      tenantId();
      return run(async () => {
        await gateway.updateDevice(id, null, paused ? 'DISABLED' : 'ACTIVE');
        return devices.get(id);
      });
    },

    // The USSD test runs on the phone itself (worker mode), not from the panel.
    testUssd: async () =>
      Promise.reject(
        new AppError('CONFLICT', 'O teste de USSD é feito no próprio telemóvel, no Modo worker, quando o módulo USSD nativo estiver instalado.', {
          reason: 'FEATURE_NOT_AVAILABLE',
        })
      ),
  };

  const sims: SimsService = {
    async list(params = {}) {
      const tenant = tenantId();
      return run(async () => {
        const fleet = await loadFleet(tenant);
        return fleet.sims.filter((s) => !params.deviceId || s.deviceId === params.deviceId).map((s) => simView(fleet, s));
      });
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => {
        const fleet = await loadFleet(tenant);
        const record = fleet.sims.find((s) => s.id === id);
        if (!record) throw new AppError('NOT_FOUND', 'SIM não encontrado.');
        return simView(fleet, record);
      });
    },

    async setPaused(id, paused) {
      tenantId();
      return run(async () => {
        await gateway.updateSim(id, null, null, paused ? 'DISABLED' : 'ACTIVE');
        return sims.get(id);
      });
    },
  };

  async function taskViews(tenant: string, rows: ActivationTaskRow[]) {
    const records = rows.map(toTaskRecord);
    const [orderRows, attemptRows, deviceRows, simRows] = await Promise.all([
      gateway.listOrders(tenant, [...new Set(records.map((t) => t.orderId))]),
      records.length
        ? gateway.listAttempts(tenant, { taskIds: records.map((t) => t.id), deviceId: null, since: null, limit: 1000 })
        : Promise.resolve([]),
      gateway.listDevices(tenant),
      gateway.listSims(tenant, null),
    ]);
    const context: TaskContext = {
      orders: new Map(orderRows.map((o) => [o.id, o])),
      attempts: attemptRows.map(toAttemptRecord),
      devices: deviceRows.map(toDeviceRecord),
      sims: known(simRows.map(toSimRecord)),
    };
    return records.map((record) => toTaskView(record, context));
  }

  const automation: AutomationService = {
    getSettings: () => settings.getSettings(),
    updateSettings: (patch) => settings.updateSettings(patch),

    async getStats() {
      const tenant = tenantId();
      return run(async () => {
        const rows = await gateway.listTasks(tenant, { status: null, orderId: null, ids: null, limit: LIST_LIMIT });
        const records = rows.map(toTaskRecord);
        const attempts = records.length
          ? (await gateway.listAttempts(tenant, { taskIds: records.map((t) => t.id), deviceId: null, since: null, limit: 1000 })).map(
              toAttemptRecord
            )
          : [];
        return toAutomationStats(records, attempts, clock());
      });
    },

    async listTasks() {
      const tenant = tenantId();
      return run(async () => taskViews(tenant, await gateway.listTasks(tenant, { status: null, orderId: null, ids: null, limit: LIST_LIMIT })));
    },

    async getTask(id) {
      const tenant = tenantId();
      return run(async () => {
        const [view] = await taskViews(tenant, await gateway.listTasks(tenant, { status: null, orderId: null, ids: [id], limit: 1 }));
        if (!view) throw new AppError('NOT_FOUND', 'Tarefa não encontrada.');
        return view;
      });
    },
  };

  // ── Financial-grade records (registry, tasks) ──

  const deviceRegistry: DeviceRegistryService = {
    async listDevices() {
      const tenant = tenantId();
      return run(async () => (await gateway.listDevices(tenant)).map(toDeviceRecord));
    },

    async getDevice(id) {
      const tenant = tenantId();
      return run(async () => toDeviceRecord(first(await gateway.listDevices(tenant, [id]), 'Dispositivo')));
    },

    async createDevice(name) {
      const valid = assertValidDeviceName(name);
      const tenant = tenantId();
      return run(async () => toPairing((await gateway.createDevice(tenant, valid))[0]));
    },

    async createPairingCode(deviceId) {
      tenantId();
      return run(async () => toPairing((await gateway.createPairingCode(deviceId))[0]));
    },

    async updateDevice(id, input) {
      const valid = assertValidDeviceUpdate(input);
      tenantId();
      return run(async () => toDeviceRecord(first(await gateway.updateDevice(id, valid.name ?? null, valid.status ?? null), 'Dispositivo')));
    },

    async listSims(params = {}) {
      const tenant = tenantId();
      return run(async () => known((await gateway.listSims(tenant, params.deviceId ?? null)).map(toSimRecord)));
    },

    async registerSim(input) {
      const valid = assertValidSimInput(input);
      tenantId();
      return run(async () => {
        const sim = toSimRecord(first(await gateway.registerSim(valid.deviceId, valid.slotIndex, valid.operator, valid.phoneNumber), 'SIM'));
        if (!sim) throw new AppError('NOT_FOUND', 'SIM não encontrado.');
        return sim;
      });
    },

    async updateSim(id, input) {
      const valid = assertValidSimUpdate(input);
      tenantId();
      return run(async () => {
        const sim = toSimRecord(
          first(await gateway.updateSim(id, valid.operator ?? null, valid.phoneNumber ?? null, valid.status ?? null), 'SIM')
        );
        if (!sim) throw new AppError('NOT_FOUND', 'SIM não encontrado.');
        return sim;
      });
    },
  };

  const activationTasks: ActivationTasksService = {
    async list(params = {}) {
      const tenant = tenantId();
      return run(async () =>
        (await gateway.listTasks(tenant, { status: params.status ?? null, orderId: params.orderId ?? null, ids: null, limit: LIST_LIMIT })).map(
          toTaskRecord
        )
      );
    },

    async get(id) {
      const tenant = tenantId();
      return run(async () => {
        const task = toTaskRecord(first(await gateway.listTasks(tenant, { status: null, orderId: null, ids: [id], limit: 1 }), 'Tarefa'));
        const [attemptRows, eventRows, orderRows, deviceRows, simRows] = await Promise.all([
          gateway.listAttempts(tenant, { taskIds: [id], deviceId: null, since: null, limit: 100 }),
          gateway.listEvents(tenant, { taskId: id, deviceId: null, limit: 100 }),
          gateway.listOrders(tenant, [task.orderId]),
          gateway.listDevices(tenant),
          gateway.listSims(tenant, null),
        ]);
        const order = orderRows[0];
        const sims = known(simRows.map(toSimRecord));
        const devices = deviceRows.map(toDeviceRecord);
        return {
          task,
          attempts: attemptRows.map(toAttemptRecord).sort((a, b) => a.sequence - b.sequence),
          events: eventRows.map(toEventRecord).sort((a, b) => a.at.localeCompare(b.at)),
          order: order
            ? {
                code: order.public_reference,
                productName: order.product_name_snapshot,
                destination: order.customer_phone,
                price: Number(order.product_price_snapshot),
                currency: order.currency_snapshot,
              }
            : null,
          device: devices.find((d) => d.id === task.deviceId) ?? null,
          sim: sims.find((s) => s.id === task.simId) ?? null,
        };
      });
    },

    async dispatch() {
      const tenant = tenantId();
      return run(() => gateway.dispatch(tenant));
    },

    async retry(id, note) {
      const valid = normalizeDecisionNote(note, { required: false });
      tenantId();
      return run(async () => toTaskRecord(first(await gateway.retryTask(id, valid), 'Tarefa')));
    },

    async resolve(id, outcome, note) {
      if (outcome !== 'SUCCESS' && outcome !== 'FAILED') throw new AppError('VALIDATION_ERROR', 'Decisão inválida.');
      const valid = normalizeDecisionNote(note, { required: true }) as string;
      tenantId();
      return run(async () => toTaskRecord(first(await gateway.resolveTask(id, outcome, valid), 'Tarefa')));
    },
  };

  // ── Worker protocol ──

  const payloadOf = (value: unknown): ActivationPayload => {
    const payload = parseActivationPayload(value);
    // Fail closed: a payload the app cannot fully validate is never executed.
    if (!payload) throw new AppError('DATABASE_ERROR', 'Pedido de execução inválido recebido do servidor.');
    return payload;
  };

  const worker: WorkerService = {
    async register({ pairingCode, deviceIdentifier, appVersion }) {
      const code = normalizePairingCode(pairingCode);
      if (!code) throw new AppError('VALIDATION_ERROR', 'Código de emparelhamento inválido (8 caracteres, ex.: ABCD-EF23).', { reason: 'PAIRING_CODE_INVALID' });
      if (!/^[A-Za-z0-9._:-]{4,128}$/.test(deviceIdentifier)) throw new AppError('VALIDATION_ERROR', 'Identificador do dispositivo inválido.');
      return run(async () => {
        const row = first(await gateway.registerDevice(formatPairingCode(code), deviceIdentifier, appVersion), 'Dispositivo');
        const identity: WorkerIdentity = { deviceId: row.device_id, deviceToken: row.device_token, deviceName: row.device_name, tenantId: row.tenant_id };
        return identity;
      });
    },

    async heartbeat(identity, report) {
      return run(async () => {
        const result = await gateway.heartbeat({
          deviceId: identity.deviceId,
          deviceToken: identity.deviceToken,
          appVersion: report.appVersion ?? null,
          capabilities: report.capabilities ? capabilitiesToWire(report.capabilities) : null,
          telemetry: report.telemetry ? telemetryToWire(report.telemetry) : null,
          sims:
            report.sims === undefined || report.sims === null
              ? null
              : report.sims.map((s) => ({ slot_index: s.slotIndex, fingerprint: s.fingerprint })),
        });
        const value = (typeof result === 'object' && result !== null && !Array.isArray(result) ? result : {}) as Record<string, unknown>;
        return {
          deviceId: typeof value.device_id === 'string' ? value.device_id : identity.deviceId,
          serverTime: typeof value.server_time === 'string' ? value.server_time : new Date(clock()).toISOString(),
          heartbeatTimeoutSeconds:
            typeof value.heartbeat_timeout_seconds === 'number' ? value.heartbeat_timeout_seconds : ACTIVATION_RULES.heartbeatTimeoutSeconds,
          taskId: typeof value.task_id === 'string' ? value.task_id : null,
        };
      });
    },

    async fetchTask(identity) {
      return run(async () => {
        const value = await gateway.fetchTask(identity.deviceId, identity.deviceToken);
        return value === null ? null : payloadOf(value);
      });
    },

    async startTask(identity, taskId) {
      return run(async () => payloadOf(await gateway.startTask(identity.deviceId, identity.deviceToken, taskId)));
    },

    async reportProgress(identity, taskId, status) {
      return run(async () => {
        await gateway.reportProgress(identity.deviceId, identity.deviceToken, taskId, status);
      });
    },

    async reportResult(identity, taskId, report) {
      if (!isActivationResultCode(report.resultCode)) throw new AppError('VALIDATION_ERROR', 'Código de resultado inválido.');
      return run(async () =>
        toTaskRecord(
          first(
            await gateway.reportResult({
              deviceId: identity.deviceId,
              deviceToken: identity.deviceToken,
              taskId,
              outcome: report.outcome,
              resultCode: report.resultCode,
              operatorResponse: report.operatorResponse?.slice(0, ACTIVATION_RULES.responseMax) ?? null,
              ussdTrace: report.ussdTrace?.slice(0, ACTIVATION_RULES.traceMax) ?? null,
            }),
            'Tarefa'
          )
        )
      );
    },
  };

  return { devices, sims, automation, deviceRegistry, activationTasks, worker };
}
