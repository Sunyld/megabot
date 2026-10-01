import type { ID, ISODateString, TenantScoped } from './common';

export type WhatsAppConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export type WhatsAppConnection = TenantScoped & {
  status: WhatsAppConnectionStatus;
  phone: string;
  displayName: string;
  connectedSince: ISODateString;
  lastEventAt: ISODateString;
  groupsMonitored: number;
  messagesProcessed: number;
  ordersCreated: number;
  /** Share of conversations fully handled without human intervention (0..1). */
  automationRate: number;
};

export type WhatsAppGroup = TenantScoped & {
  id: ID;
  name: string;
  members: number;
  monitored: boolean;
  ordersToday: number;
  lastMessageAt: ISODateString;
};

/** Intents produced by the (future) AI layer. Informative only. */
export type MessageIntent =
  | 'SHOW_PRICES'
  | 'SHOW_PAYMENT_METHODS'
  | 'CREATE_ORDER'
  | 'PROVIDE_DESTINATION'
  | 'PAYMENT_PROOF'
  | 'PAYMENT_STATUS'
  | 'SUPPORT'
  | 'UNKNOWN';

export type ChatMessage = {
  id: ID;
  direction: 'in' | 'out' | 'system';
  text: string;
  at: ISODateString;
  intent?: MessageIntent;
};

export type ConversationStatus = 'bot' | 'needs_human' | 'resolved';

export type Conversation = TenantScoped & {
  id: ID;
  customerName: string;
  customerPhone: string;
  groupName: string | null;
  status: ConversationStatus;
  unread: number;
  orderId: ID | null;
  orderCode: string | null;
  lastMessageAt: ISODateString;
  messages: ChatMessage[];
};
