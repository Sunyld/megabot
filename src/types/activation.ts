import type { TaskStatus } from './automation';
import type { ID, ISODateString, Operator, TenantScoped } from './common';
import type { UssdFlow, UssdInputSource } from './ussd';

/**
 * Activation engine (migration 006). Where the backend ends and the phone begins:
 *
 *   backend  : devices, SIMs, activation tasks (one per PAID order), dispatcher,
 *              result verification, history — all in the database
 *   protocol : ActivationPayload (megabot.activation.v1) ⇄ WorkerResultReport
 *   phone    : src/features/worker — heartbeat, task polling, the UssdExecutor
 *              (a native Android module, not part of Expo Go)
 */

/** Stored lifecycle. Online / offline is DERIVED from lastSeenAt (see activationRules). */
export type DeviceRegistrationStatus = 'UNREGISTERED' | 'ACTIVE' | 'DISABLED';

export type DeviceConnectivity = 'ONLINE' | 'OFFLINE';

/** What the worker reported it can do. */
export type DeviceCapabilities = {
  /** The native USSD executor is installed and allowed. */
  ussd?: boolean;
  /** Multi-step menus (select / input / confirm) — every product flow needs it. */
  ussdInteractive?: boolean;
  sms?: boolean;
  multiSim?: boolean;
};

export type DeviceNetworkType = '5G' | '4G' | '3G' | '2G' | 'WIFI' | 'NONE';

/** Non-sensitive health data sent with the heartbeat (no IMEI, no numbers). */
export type DeviceTelemetry = {
  batteryLevel?: number;
  charging?: boolean;
  networkType?: DeviceNetworkType;
  signalLevel?: 0 | 1 | 2 | 3 | 4;
  model?: string;
  osVersion?: string;
};

export type DeviceRecord = TenantScoped & {
  id: ID;
  name: string;
  /** Installation id reported at pairing — not an identity (the device token is). */
  deviceIdentifier: string | null;
  platform: 'ANDROID' | null;
  appVersion: string | null;
  status: DeviceRegistrationStatus;
  capabilities: DeviceCapabilities;
  telemetry: DeviceTelemetry;
  /** Server clock of the last heartbeat. */
  lastSeenAt: ISODateString | null;
  registeredAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

/** One-time pairing code (shown once, valid for 15 minutes). */
export type DevicePairing = {
  deviceId: ID;
  /** "ABCD-EF23" */
  pairingCode: string;
  expiresAt: ISODateString;
};

export type DeviceSimStatus = 'ACTIVE' | 'UNAVAILABLE' | 'DISABLED';

/** NOT_DETECTED: the phone does not see a SIM in the slot. SIM_CHANGED: a different SIM is there now. */
export type SimUnavailableReason = 'NOT_DETECTED' | 'SIM_CHANGED';

export type DeviceSimRecord = TenantScoped & {
  id: ID;
  deviceId: ID;
  /** Android SIM slot index (0-based). People see slot 1, 2… */
  slotIndex: number;
  /** Explicit network — never inferred from the number. */
  operator: Operator;
  /** E.164; sensitive. */
  phoneNumber: string | null;
  status: DeviceSimStatus;
  unavailableReason: SimUnavailableReason | null;
  capabilities: { ussd?: boolean; sms?: boolean };
  lastSeenAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type CreateDeviceSimInput = {
  deviceId: ID;
  slotIndex: number;
  operator: Operator;
  phoneNumber?: string | null;
};

export type UpdateDeviceSimInput = {
  operator?: Operator;
  phoneNumber?: string | null;
  status?: 'ACTIVE' | 'DISABLED';
};

export type UpdateDeviceInput = {
  name?: string;
  status?: 'ACTIVE' | 'DISABLED';
};

export type ActivationOutcome = 'SUCCESS' | 'FAILED' | 'UNKNOWN';

/**
 * Structured result codes (same table as private.activation_result_code_info).
 * MANUAL_* are people's decisions; INVALID_FLOW is set by the backend.
 */
export type ActivationResultCode =
  | 'ACTIVATED'
  | 'DEVICE_OFFLINE'
  | 'SIM_UNAVAILABLE'
  | 'USSD_NOT_SUPPORTED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'USSD_REJECTED'
  | 'INVALID_DESTINATION'
  | 'INSUFFICIENT_BALANCE'
  | 'FLOW_MISMATCH'
  | 'INVALID_FLOW'
  | 'UNKNOWN_RESPONSE'
  | 'MANUAL_CONFIRMED'
  | 'MANUAL_REJECTED';

export type ActivationTaskRecord = TenantScoped & {
  id: ID;
  orderId: ID;
  productId: ID;
  deviceId: ID | null;
  simId: ID | null;
  status: TaskStatus;
  priority: number;
  operator: Operator;
  /** The product's flow when the order was paid; `null` only for INVALID_FLOW. */
  ussdFlow: UssdFlow | null;
  flowVersion: number;
  attemptCount: number;
  maxAttempts: number;
  assignedAt: ISODateString | null;
  startedAt: ISODateString | null;
  submittedAt: ISODateString | null;
  completedAt: ISODateString | null;
  resultCode: string | null;
  /** The operator's final screen (truncated). */
  resultMessage: string | null;
  failureReason: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type ActivationAttemptSource = 'WORKER' | 'SYSTEM' | 'MANUAL';

/** Immutable record of one attempt (or a person's decision on UNKNOWN). */
export type ActivationAttemptRecord = {
  id: ID;
  taskId: ID;
  sequence: number;
  attemptNumber: number;
  deviceId: ID | null;
  simId: ID | null;
  slotIndex: number | null;
  outcome: ActivationOutcome;
  resultCode: string;
  retryable: boolean;
  source: ActivationAttemptSource;
  ussdTrace: string | null;
  operatorResponse: string | null;
  note: string | null;
  decidedBy: ID | null;
  startedAt: ISODateString | null;
  finishedAt: ISODateString;
};

/** Status change history (activation_task_events). */
export type ActivationTaskEventRecord = {
  id: ID;
  taskId: ID;
  /** "activation_task.assigned", ".started", ".completed"… */
  type: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  deviceId: ID | null;
  simId: ID | null;
  /** `null` = system (dispatcher, timeouts). */
  actorUserId: ID | null;
  at: ISODateString;
};

export type ActivationTaskDetail = {
  task: ActivationTaskRecord;
  attempts: ActivationAttemptRecord[];
  events: ActivationTaskEventRecord[];
  order: { code: string; productName: string; destination: string; price: number; currency: string } | null;
  device: DeviceRecord | null;
  sim: DeviceSimRecord | null;
};

export type ActivationTaskListParams = { status?: TaskStatus; orderId?: ID };

// ─── Worker protocol (megabot.activation.v1) ──────────────────────────────────

export const ACTIVATION_PROTOCOL = 'megabot.activation.v1';

/** What the worker keeps (secure storage) after pairing. The token is never shown again. */
export type WorkerIdentity = {
  deviceId: ID;
  deviceToken: string;
  deviceName: string;
  tenantId: ID;
};

export type WorkerRegistrationInput = {
  pairingCode: string;
  deviceIdentifier: string;
  appVersion: string;
};

export type WorkerSimReport = {
  slotIndex: number;
  /** Opaque value computed on the phone for the SIM in the slot; `null` when unreadable. */
  fingerprint: string | null;
};

export type WorkerHeartbeat = {
  appVersion?: string;
  capabilities?: DeviceCapabilities;
  telemetry?: DeviceTelemetry;
  /** `null` = the phone could not read its SIMs (permission) — the backend keeps the last state. */
  sims?: WorkerSimReport[] | null;
};

export type HeartbeatResult = {
  deviceId: ID;
  serverTime: ISODateString;
  heartbeatTimeoutSeconds: number;
  /** The device's current task, if the dispatcher gave it one. */
  taskId: ID | null;
};

/** Versioned, validated execution request. No secrets, no tenant, nothing to change price or payment. */
export type ActivationPayload = {
  protocol: typeof ACTIVATION_PROTOCOL;
  taskId: ID;
  orderId: ID;
  productId: ID;
  deviceId: ID;
  simId: ID;
  status: TaskStatus;
  attempt: number;
  operator: Operator;
  sim: { slotIndex: number; fingerprint: string | null; operator: Operator };
  /** E.164 (the customer's number). */
  destinationNumber: string;
  flowVersion: 1;
  flow: UssdFlow;
  /** Values for the flow's `input` steps, computed by the backend from the order snapshot. */
  values: Partial<Record<UssdInputSource, string>>;
  limits: { stepTimeoutMs: number; sessionTimeoutMs: number };
};

export type WorkerResultReport = {
  outcome: ActivationOutcome;
  resultCode: ActivationResultCode;
  /** The operator's final screen, verbatim (≤ 2000 chars). */
  operatorResponse?: string | null;
  /** What was dialled, e.g. "*111# › 5 › 840000001 › 1" (≤ 500 chars). */
  ussdTrace?: string | null;
};
