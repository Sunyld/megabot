import type { ID, ISODateString, TenantScoped } from './common';

/**
 * Activation task lifecycle. `UNKNOWN` means the USSD was submitted but no
 * confirmation arrived: the system must verify before assuming failure.
 */
export type TaskStatus =
  | 'QUEUED'
  | 'ASSIGNED'
  | 'EXECUTING'
  | 'SUBMITTED'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'UNKNOWN';

export type AttemptResult =
  | 'skipped_offline'
  | 'skipped_unavailable'
  | 'skipped_limit'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  /** Submitted, result not proven (UNKNOWN). */
  | 'unknown';

export type TaskAttempt = {
  id: ID;
  deviceId: ID;
  deviceName: string;
  simId: ID;
  simSlot: number;
  result: AttemptResult;
  reason?: string;
  at: ISODateString;
  durationMs?: number;
};

export type ActivationTask = TenantScoped & {
  id: ID;
  code: string;
  orderId: ID;
  orderCode: string;
  productName: string;
  destination: string;
  status: TaskStatus;
  ussdCode: string;
  attempts: TaskAttempt[];
  operatorResponse?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Engine details (migration 006) — filled when known. */
  deviceId?: ID | null;
  deviceName?: string | null;
  simSlot?: number | null;
  attemptCount?: number;
  maxAttempts?: number;
  resultCode?: string | null;
  failureReason?: string | null;
};

export type AutomationSettings = {
  enabled: boolean;
  autoOrders: boolean;
  autoConfirm: boolean;
  autoUssd: boolean;
  failover: boolean;
  smsMonitoring: boolean;
};

export type AutomationStats = {
  tasksToday: number;
  successRate: number;
  avgActivationSeconds: number;
  failoversToday: number;
  unknownToday: number;
};
