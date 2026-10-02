/**
 * Activation engine rules shared by every backend, the screens and the Android
 * worker. They mirror migration 006 (activation_task_transition_allowed,
 * activation_result_code_info, classify_ussd_response, device_is_online,
 * activation_payload). The database applies them again and stays the only
 * authority over task states, retries and orders.
 */
import type {
  ActivationOutcome,
  ActivationPayload,
  ActivationResultCode,
  CreateDeviceSimInput,
  DeviceCapabilities,
  DeviceRecord,
  DeviceTelemetry,
  ISODateString,
  Operator,
  TaskStatus,
  UpdateDeviceInput,
  UpdateDeviceSimInput,
  UssdFlow,
  UssdInputSource,
} from '@/types';
import { ACTIVATION_PROTOCOL } from '@/types';

import { AppError } from './errors';
import { normalizePhone } from './orderRules';
import { parseUssdFlow, USSD_INPUT_SOURCES } from './ussdFlow';

// ─── Task state machine ───────────────────────────────────────────────────────

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  QUEUED: ['ASSIGNED', 'FAILED'],
  ASSIGNED: ['QUEUED', 'EXECUTING', 'FAILED'],
  EXECUTING: ['SUBMITTED', 'SUCCESS', 'FAILED', 'UNKNOWN'],
  SUBMITTED: ['VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN'],
  VERIFYING: ['SUCCESS', 'FAILED', 'UNKNOWN'],
  // Back to the queue only with a retry decision (automatic policy or a person).
  FAILED: ['QUEUED'],
  // Only a person's decision leaves UNKNOWN.
  UNKNOWN: ['SUCCESS', 'FAILED'],
  SUCCESS: [],
};

export const TASK_STATUSES = Object.keys(TASK_TRANSITIONS) as TaskStatus[];

export const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === 'string' && (TASK_STATUSES as string[]).includes(value);

export const canTaskTransition = (from: TaskStatus, to: TaskStatus) => TASK_TRANSITIONS[from].includes(to);

/** Work holding a device and a SIM (one at a time per device and per SIM). */
export const RUNNING_TASK_STATUSES: readonly TaskStatus[] = ['ASSIGNED', 'EXECUTING', 'SUBMITTED', 'VERIFYING'];

/** Statuses after which the operator may have done the activation. */
export const SUBMITTED_TASK_STATUSES: readonly TaskStatus[] = ['SUBMITTED', 'VERIFYING'];

// ─── Result codes and retry policy ────────────────────────────────────────────

type CodeInfo = { outcomes: readonly ActivationOutcome[]; retryable: boolean; worker: boolean; text: string };

/**
 * Retryable = a FAILED attempt with this code goes back to the queue
 * automatically while attempts remain (nothing was confirmed on the network).
 * UNKNOWN is NEVER retried, whatever the code.
 */
export const ACTIVATION_RESULT_CODES: Readonly<Record<ActivationResultCode, CodeInfo>> = {
  ACTIVATED: { outcomes: ['SUCCESS'], retryable: false, worker: true, text: 'Pacote ativado (confirmado pelo texto da operadora).' },
  DEVICE_OFFLINE: { outcomes: ['FAILED'], retryable: true, worker: true, text: 'O dispositivo ficou sem ligação antes de executar.' },
  SIM_UNAVAILABLE: { outcomes: ['FAILED'], retryable: true, worker: true, text: 'O SIM pedido não estava disponível no telemóvel.' },
  USSD_NOT_SUPPORTED: { outcomes: ['FAILED'], retryable: true, worker: true, text: 'O telemóvel não consegue executar USSD (módulo nativo em falta).' },
  PERMISSION_DENIED: { outcomes: ['FAILED'], retryable: true, worker: true, text: 'O telemóvel não deu permissão para executar USSD.' },
  NETWORK_ERROR: { outcomes: ['FAILED', 'UNKNOWN'], retryable: true, worker: true, text: 'Erro de rede da operadora.' },
  TIMEOUT: { outcomes: ['FAILED', 'UNKNOWN'], retryable: true, worker: true, text: 'A operadora não respondeu a tempo.' },
  USSD_REJECTED: { outcomes: ['FAILED'], retryable: false, worker: true, text: 'A operadora recusou a operação.' },
  INVALID_DESTINATION: { outcomes: ['FAILED'], retryable: false, worker: true, text: 'Número de destino inválido.' },
  INSUFFICIENT_BALANCE: { outcomes: ['FAILED'], retryable: false, worker: true, text: 'Saldo insuficiente no SIM.' },
  FLOW_MISMATCH: { outcomes: ['FAILED'], retryable: false, worker: true, text: 'O menu da operadora não corresponde ao fluxo do produto.' },
  INVALID_FLOW: { outcomes: ['FAILED'], retryable: false, worker: false, text: 'O produto não tem fluxo USSD válido.' },
  UNKNOWN_RESPONSE: { outcomes: ['UNKNOWN'], retryable: false, worker: true, text: 'Resposta da operadora sem confirmação clara.' },
  MANUAL_CONFIRMED: { outcomes: ['SUCCESS'], retryable: false, worker: false, text: 'Confirmado manualmente.' },
  MANUAL_REJECTED: { outcomes: ['FAILED'], retryable: false, worker: false, text: 'Rejeitado manualmente.' },
};

export const isActivationResultCode = (value: unknown): value is ActivationResultCode =>
  typeof value === 'string' && value in ACTIVATION_RESULT_CODES;

export const resultCodeText = (code: string | null | undefined): string | undefined =>
  code ? (isActivationResultCode(code) ? ACTIVATION_RESULT_CODES[code].text : code) : undefined;

/** Would the backend put this attempt back in the queue by itself? */
export function isAutomaticRetry(outcome: ActivationOutcome, code: ActivationResultCode, attemptCount: number, maxAttempts: number) {
  return outcome === 'FAILED' && ACTIVATION_RESULT_CODES[code].retryable && attemptCount < maxAttempts;
}

// ─── Reading the operator's screen (UssdResponseParser) ───────────────────────

const matches = (text: string, entries: readonly string[] | undefined) =>
  (entries ?? []).some((entry) => entry.trim() !== '' && text.includes(entry.trim().toLowerCase()));

/**
 * Deterministic reading of the final screen with the product's own texts
 * (case-insensitive "contains"). Both or neither → UNKNOWN: never assume success.
 */
export function classifyUssdResponse(flow: Pick<UssdFlow, 'success' | 'failure'> | null, response: string | null | undefined): ActivationOutcome {
  const text = (response ?? '').trim().toLowerCase();
  if (!text || !flow) return 'UNKNOWN';
  const success = matches(text, flow.success?.contains);
  const failure = matches(text, flow.failure?.contains);
  if (success && !failure) return 'SUCCESS';
  if (failure && !success) return 'FAILED';
  return 'UNKNOWN';
}

/** A step's `expect` text is on the screen (no expectation = nothing to check). */
export function screenMatchesExpectation(screen: string | null | undefined, expect: { contains: string[] } | undefined): boolean {
  if (!expect) return true;
  return matches((screen ?? '').toLowerCase(), expect.contains);
}

/**
 * What the backend will record for a worker's claim (same as
 * private.worker_report_result) — used by the mock backend and to explain results.
 */
export function verifyWorkerClaim(
  flow: UssdFlow | null,
  claim: { outcome: ActivationOutcome; resultCode: ActivationResultCode; operatorResponse?: string | null },
  submitted: boolean
): { outcome: ActivationOutcome; resultCode: ActivationResultCode } {
  const seen = classifyUssdResponse(flow, claim.operatorResponse);
  if (claim.outcome === 'SUCCESS') {
    if (seen === 'FAILED') return { outcome: 'FAILED', resultCode: 'USSD_REJECTED' };
    if (seen === 'UNKNOWN') return { outcome: 'UNKNOWN', resultCode: 'UNKNOWN_RESPONSE' };
    return { outcome: 'SUCCESS', resultCode: claim.resultCode };
  }
  if (claim.outcome === 'FAILED' && (submitted || seen === 'SUCCESS')) {
    if (seen === 'SUCCESS') return { outcome: 'UNKNOWN', resultCode: 'UNKNOWN_RESPONSE' };
    if (seen === 'UNKNOWN') {
      return { outcome: 'UNKNOWN', resultCode: claim.resultCode === 'TIMEOUT' || claim.resultCode === 'NETWORK_ERROR' ? claim.resultCode : 'UNKNOWN_RESPONSE' };
    }
    const operatorCodes: ActivationResultCode[] = ['USSD_REJECTED', 'INVALID_DESTINATION', 'INSUFFICIENT_BALANCE'];
    return { outcome: 'FAILED', resultCode: operatorCodes.includes(claim.resultCode) ? claim.resultCode : 'USSD_REJECTED' };
  }
  return { outcome: claim.outcome, resultCode: claim.resultCode };
}

// ─── Devices ──────────────────────────────────────────────────────────────────

export const ACTIVATION_RULES = {
  deviceNameMin: 2,
  deviceNameMax: 80,
  maxSlots: 8,
  noteMax: 500,
  responseMax: 2000,
  traceMax: 500,
  /** tenant_settings.automation.heartbeat_timeout_seconds default (bounded 30..3600). */
  heartbeatTimeoutSeconds: 120,
  /** How often the worker sends a heartbeat (well under the timeout). */
  heartbeatIntervalMs: 30_000,
  /** How often an idle worker asks for work. */
  pollIntervalMs: 15_000,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** tenant_settings.automation.heartbeat_timeout_seconds (invalid → default). */
export function heartbeatTimeoutSeconds(automationSettings: unknown): number {
  const value = isRecord(automationSettings) ? automationSettings.heartbeat_timeout_seconds : undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= 30 && value <= 3600
    ? Math.floor(value)
    : ACTIVATION_RULES.heartbeatTimeoutSeconds;
}

/** Online = registered, enabled and seen within the timeout (server clock). */
export function isDeviceOnline(
  device: Pick<DeviceRecord, 'status' | 'lastSeenAt'>,
  now = Date.now(),
  timeoutSeconds: number = ACTIVATION_RULES.heartbeatTimeoutSeconds
): boolean {
  if (device.status !== 'ACTIVE' || !device.lastSeenAt) return false;
  return Date.parse(device.lastSeenAt) >= now - timeoutSeconds * 1000;
}

/** "abcd ef-23" → "ABCDEF23"; `null` when it cannot be a code. */
export function normalizePairingCode(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(value) ? value : null;
}

/** "ABCDEF23" → "ABCD-EF23". */
export const formatPairingCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

export const OPERATORS: readonly Operator[] = ['vodacom', 'movitel', 'tmcel'];

export const isOperator = (value: unknown): value is Operator => typeof value === 'string' && (OPERATORS as readonly string[]).includes(value);

const invalid = (message: string) => new AppError('VALIDATION_ERROR', message);

export function assertValidDeviceName(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  if (value.length < ACTIVATION_RULES.deviceNameMin || value.length > ACTIVATION_RULES.deviceNameMax) {
    throw invalid(`O nome do dispositivo deve ter entre ${ACTIVATION_RULES.deviceNameMin} e ${ACTIVATION_RULES.deviceNameMax} caracteres.`);
  }
  return value;
}

export function assertValidDeviceUpdate(input: UpdateDeviceInput): UpdateDeviceInput {
  const out: UpdateDeviceInput = {};
  if (input.name !== undefined) out.name = assertValidDeviceName(input.name);
  if (input.status !== undefined) {
    if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') throw invalid('Estado inválido.');
    out.status = input.status;
  }
  return out;
}

function optionalPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const phone = normalizePhone(raw);
  if (!phone) throw invalid('Número de telefone inválido.');
  return phone;
}

export function assertValidSimInput(input: CreateDeviceSimInput): CreateDeviceSimInput & { phoneNumber: string | null } {
  if (!input.deviceId) throw invalid('Escolha o dispositivo.');
  if (!Number.isInteger(input.slotIndex) || input.slotIndex < 0 || input.slotIndex >= ACTIVATION_RULES.maxSlots) {
    throw invalid('Slot inválido.');
  }
  if (!isOperator(input.operator)) throw invalid('Escolha a operadora (Vodacom, Movitel ou Tmcel).');
  return { deviceId: input.deviceId, slotIndex: input.slotIndex, operator: input.operator, phoneNumber: optionalPhone(input.phoneNumber) };
}

export function assertValidSimUpdate(input: UpdateDeviceSimInput): UpdateDeviceSimInput {
  const out: UpdateDeviceSimInput = {};
  if (input.operator !== undefined) {
    if (!isOperator(input.operator)) throw invalid('Operadora inválida.');
    out.operator = input.operator;
  }
  if (input.phoneNumber !== undefined) out.phoneNumber = optionalPhone(input.phoneNumber);
  if (input.status !== undefined) {
    if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') throw invalid('Estado inválido.');
    out.status = input.status;
  }
  return out;
}

/** Note of a person's decision: required for resolving UNKNOWN, optional for retries. */
export function normalizeDecisionNote(note: string | null | undefined, { required }: { required: boolean }): string | null {
  const value = note?.trim() || null;
  if (required && !value) throw invalid('Explique a decisão (o que foi verificado).');
  if (value && value.length > ACTIVATION_RULES.noteMax) {
    throw invalid(`A nota deve ter no máximo ${ACTIVATION_RULES.noteMax} caracteres.`);
  }
  return value;
}

// ─── Wire format: capabilities / telemetry (snake_case in the database) ──────

export function capabilitiesToWire(capabilities: DeviceCapabilities): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (capabilities.ussd !== undefined) out.ussd = capabilities.ussd;
  if (capabilities.ussdInteractive !== undefined) out.ussd_interactive = capabilities.ussdInteractive;
  if (capabilities.sms !== undefined) out.sms = capabilities.sms;
  if (capabilities.multiSim !== undefined) out.multi_sim = capabilities.multiSim;
  return out;
}

export function capabilitiesFromWire(value: unknown): DeviceCapabilities {
  if (!isRecord(value)) return {};
  const pick = (key: string) => (typeof value[key] === 'boolean' ? (value[key] as boolean) : undefined);
  return { ussd: pick('ussd'), ussdInteractive: pick('ussd_interactive'), sms: pick('sms'), multiSim: pick('multi_sim') };
}

const NETWORK_TYPES = ['5G', '4G', '3G', '2G', 'WIFI', 'NONE'] as const;

export function telemetryToWire(telemetry: DeviceTelemetry): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (typeof telemetry.batteryLevel === 'number' && telemetry.batteryLevel >= 0 && telemetry.batteryLevel <= 100) {
    out.battery_level = Math.round(telemetry.batteryLevel);
  }
  if (typeof telemetry.charging === 'boolean') out.charging = telemetry.charging;
  if (telemetry.networkType && (NETWORK_TYPES as readonly string[]).includes(telemetry.networkType)) out.network_type = telemetry.networkType;
  if (telemetry.signalLevel !== undefined && [0, 1, 2, 3, 4].includes(telemetry.signalLevel)) out.signal_level = telemetry.signalLevel;
  if (telemetry.model?.trim()) out.model = telemetry.model.trim().slice(0, 60);
  if (telemetry.osVersion?.trim()) out.os_version = telemetry.osVersion.trim().slice(0, 60);
  return out;
}

export function telemetryFromWire(value: unknown): DeviceTelemetry {
  if (!isRecord(value)) return {};
  const out: DeviceTelemetry = {};
  if (typeof value.battery_level === 'number') out.batteryLevel = value.battery_level;
  if (typeof value.charging === 'boolean') out.charging = value.charging;
  if (typeof value.network_type === 'string' && (NETWORK_TYPES as readonly string[]).includes(value.network_type)) {
    out.networkType = value.network_type as DeviceTelemetry['networkType'];
  }
  if (typeof value.signal_level === 'number' && [0, 1, 2, 3, 4].includes(value.signal_level)) {
    out.signalLevel = value.signal_level as DeviceTelemetry['signalLevel'];
  }
  if (typeof value.model === 'string') out.model = value.model;
  if (typeof value.os_version === 'string') out.osVersion = value.os_version;
  return out;
}

// ─── Worker protocol: payload validation (fail closed) ────────────────────────

/** Backend JSON → payload; `null` if anything is missing, unknown or invalid. The worker never executes a doubtful request. */
export function parseActivationPayload(value: unknown): ActivationPayload | null {
  if (!isRecord(value) || value.protocol !== ACTIVATION_PROTOCOL) return null;
  const str = (key: string) => (typeof value[key] === 'string' && value[key] !== '' ? (value[key] as string) : null);
  const taskId = str('task_id');
  const orderId = str('order_id');
  const productId = str('product_id');
  const deviceId = str('device_id');
  const simId = str('sim_id');
  const destination = str('destination_number');
  const status = value.status;
  const flow = parseUssdFlow(value.flow);
  const sim = value.sim;
  const values = value.values;
  const limits = value.limits;
  if (!taskId || !orderId || !productId || !deviceId || !simId || !destination || !isTaskStatus(status) || !flow) return null;
  if (!isOperator(value.operator) || value.flow_version !== 1 || typeof value.attempt !== 'number') return null;
  if (!isRecord(sim) || typeof sim.slot_index !== 'number' || !Number.isInteger(sim.slot_index) || !isOperator(sim.operator)) return null;
  if (sim.operator !== value.operator) return null;
  if (!normalizePhone(destination)) return null;
  if (!isRecord(values) || Object.entries(values).some(([key, v]) => !(USSD_INPUT_SOURCES as readonly string[]).includes(key) || typeof v !== 'string')) {
    return null;
  }
  const stepTimeoutMs = isRecord(limits) && typeof limits.step_timeout_ms === 'number' ? limits.step_timeout_ms : 30_000;
  const sessionTimeoutMs = isRecord(limits) && typeof limits.session_timeout_ms === 'number' ? limits.session_timeout_ms : 120_000;
  return {
    protocol: ACTIVATION_PROTOCOL,
    taskId,
    orderId,
    productId,
    deviceId,
    simId,
    status,
    attempt: value.attempt,
    operator: value.operator,
    sim: {
      slotIndex: sim.slot_index,
      fingerprint: typeof sim.fingerprint === 'string' ? sim.fingerprint : null,
      operator: sim.operator,
    },
    destinationNumber: destination,
    flowVersion: 1,
    flow,
    values: values as Partial<Record<UssdInputSource, string>>,
    limits: { stepTimeoutMs, sessionTimeoutMs },
  };
}

/** Day boundary helper for "today" counters. */
export const isToday = (iso: ISODateString | null | undefined, now = Date.now()) => {
  if (!iso) return false;
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};
