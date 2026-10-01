import type { ID, ISODateString, Operator, PaymentMethod, TenantScoped } from './common';

export type DeviceStatus = 'online' | 'offline' | 'paused';
export type DeviceRole = 'primary' | 'worker';
export type NetworkType = '5G' | '4G' | '3G' | 'WiFi' | 'none';

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
  model: string;
  androidVersion: string;
  appVersion: string;
  status: DeviceStatus;
  battery: { level: number; charging: boolean };
  network: { type: NetworkType; signal: 0 | 1 | 2 | 3 | 4 };
  lastSeenAt: ISODateString;
  syncedAt: ISODateString;
  simIds: ID[];
  capabilities: { ussd: boolean; sms: boolean; dualSim: boolean };
  usage: {
    tasksToday: number;
    successToday: number;
    failedToday: number;
    /** Max activations per day across all SIMs of the device. */
    capacityPerDay: number;
  };
  errors: DeviceError[];
  history: DeviceEvent[];
};

export type SimStatus = 'available' | 'busy' | 'limit_reached' | 'error' | 'paused' | 'offline';

export type Sim = TenantScoped & {
  id: ID;
  deviceId: ID;
  deviceName: string;
  slot: 1 | 2;
  operator: Operator;
  msisdn: string;
  status: SimStatus;
  activationsToday: number;
  dailyLimit: number;
  dataUsedMb: number;
  dataTotalMb: number;
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
  capacityTotal: number;
};
