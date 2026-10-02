import type { ID, ISODateString, Operator, PaymentMethod, TenantScoped } from './common';

/**
 * View model of the Devices screens. In Supabase mode it is built from the
 * devices table (migration 006): online / offline is derived from the last
 * heartbeat, paused = DISABLED, unregistered = created but not paired yet.
 * Fields the backend does not know (yet) are `null` — never invented.
 */
export type DeviceStatus = 'online' | 'offline' | 'paused' | 'unregistered';
export type DeviceRole = 'primary' | 'worker';
export type NetworkType = '5G' | '4G' | '3G' | '2G' | 'WiFi' | 'none';

export type DeviceError = {
  id: ID;
  at: ISODateString;
  code: string;
  message: string;
  severity: 'warning' | 'danger';
};

export type DeviceEventType = 'online' | 'offline' | 'task' | 'sim' | 'battery' | 'sync' | 'error';

export type DeviceEvent = {
  id: ID;
  at: ISODateString;
  type: DeviceEventType;
  title: string;
  description?: string;
};

export type Device = TenantScoped & {
  id: ID;
  name: string;
  role: DeviceRole;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  status: DeviceStatus;
  battery: { level: number; charging: boolean } | null;
  network: { type: NetworkType; signal: 0 | 1 | 2 | 3 | 4 } | null;
  lastSeenAt: ISODateString | null;
  syncedAt: ISODateString | null;
  simIds: ID[];
  /** ussdInteractive: multi-step menus — required by every product flow. */
  capabilities: { ussd: boolean; ussdInteractive: boolean; sms: boolean; dualSim: boolean };
  usage: {
    tasksToday: number;
    successToday: number;
    failedToday: number;
    /** Max activations per day across all SIMs of the device; `null` = no limit configured. */
    capacityPerDay: number | null;
  };
  errors: DeviceError[];
  history: DeviceEvent[];
};

export type SimStatus = 'available' | 'busy' | 'limit_reached' | 'error' | 'paused' | 'offline' | 'unavailable';

export type Sim = TenantScoped & {
  id: ID;
  deviceId: ID;
  deviceName: string;
  /** 1-based, as people count slots. */
  slot: number;
  operator: Operator;
  msisdn: string | null;
  status: SimStatus;
  /** Why an 'unavailable' SIM is out of rotation. */
  unavailableReason?: 'NOT_DETECTED' | 'SIM_CHANGED' | null;
  activationsToday: number;
  dailyLimit: number | null;
  dataUsedMb: number | null;
  dataTotalMb: number | null;
  /**
   * Wallet whose confirmation SMS this SIM receives (payment monitoring).
   * `null` when the SIM is used only for activations.
   */
  paymentWallet: PaymentMethod | null;
  /** Airtime balance in MT, when the operator allows reading it. */
  balance: number | null;
  lastUsedAt: ISODateString | null;
};

export type DevicesSummary = {
  online: number;
  total: number;
  simsAvailable: number;
  simsTotal: number;
  capacityUsed: number;
  /** Sum of the SIMs' daily limits; `null` when no limit is configured. */
  capacityTotal: number | null;
};
