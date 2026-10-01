import type { ID, ISODateString, Severity } from './common';
import type { EntityRef, NotificationKind } from './notification';
import type { WhatsAppConnectionStatus } from './whatsapp';

export type HourlyPoint = { hour: number; revenue: number; orders: number };

export type AttentionItem = {
  id: ID;
  severity: Severity;
  title: string;
  description: string;
  target: EntityRef;
};

export type DashboardSummary = {
  date: ISODateString;
  sales: number;
  revenue: number;
  /** Revenue change vs. yesterday at the same time (fraction, e.g. 0.12 = +12%). */
  revenueDelta: number;
  activated: number;
  pending: number;
  failed: number;
  avgActivationSeconds: number;
  hourly: HourlyPoint[];
  pipeline: {
    received: number;
    paid: number;
    activated: number;
    delivered: number;
  };
  systems: {
    devicesOnline: number;
    devicesTotal: number;
    whatsapp: WhatsAppConnectionStatus;
    paymentsMonitoring: boolean;
  };
  attention: AttentionItem[];
};

export type Activity = {
  id: ID;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  description: string;
  at: ISODateString;
  target?: EntityRef;
};
