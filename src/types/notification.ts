import type { ID, ISODateString, Severity, TenantScoped } from './common';

export type NotificationKind =
  | 'activation'
  | 'order'
  | 'payment'
  | 'device'
  | 'sim'
  | 'whatsapp'
  | 'system';

/** Entity a notification or activity item points to (drives navigation). */
export type EntityRef =
  | { type: 'order'; id: ID }
  | { type: 'payment'; id: ID }
  | { type: 'device'; id: ID }
  | { type: 'sim'; id: ID }
  | { type: 'conversation'; id: ID }
  | { type: 'task'; id: ID }
  | { type: 'whatsapp' }
  | { type: 'automation' };

export type AppNotification = TenantScoped & {
  id: ID;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body: string;
  createdAt: ISODateString;
  read: boolean;
  target?: EntityRef;
};
