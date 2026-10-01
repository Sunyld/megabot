/**
 * Service contracts. The UI depends only on these interfaces; `services/mock`
 * implements them today, a Supabase implementation will replace it later.
 * Every call is implicitly scoped to the signed-in tenant.
 */
import type {
  Activity,
  ActivationTask,
  AppNotification,
  AuditLogEntry,
  AuditLogQuery,
  AutomationSettings,
  AutomationStats,
  Conversation,
  DashboardSummary,
  Device,
  DevicesSummary,
  ID,
  Order,
  OrderCounts,
  OrderFilter,
  Payment,
  PaymentAccount,
  PaymentFilter,
  PaymentsSummary,
  PlatformAdminContext,
  PlatformTenant,
  PlatformTenantListParams,
  Product,
  Session,
  SignInCredentials,
  SignUpInput,
  Sim,
  TenantStatusChangeInput,
  WhatsAppConnection,
  WhatsAppGroup,
} from '@/types';

/**
 * Auth changes reported by the backend outside the app's own calls
 * (token refresh, sign-out elsewhere, recovery links…).
 */
export type AuthEvent =
  | { type: 'SIGNED_IN'; userId: ID }
  | { type: 'SIGNED_OUT' }
  | { type: 'TOKEN_REFRESHED'; expiresAt: string }
  | { type: 'USER_UPDATED'; email: string | null; name: string | null }
  | { type: 'PASSWORD_RECOVERY' };

export interface AuthService {
  /** Signs in and loads the tenant context (membership → tenant → settings). */
  signIn(credentials: SignInCredentials): Promise<Session>;
  /**
   * Creates the account. The tenant is provisioned by the backend (database
   * trigger), never by the app; resolves once the tenant context is loaded.
   */
  signUp(input: SignUpInput): Promise<Session>;
  /** Ends the session on the server when possible and always locally. */
  signOut(): Promise<void>;
  /** Restores the persisted session and reloads its tenant context. */
  restore(): Promise<Session | null>;
  /** Subscribes to backend auth events. Returns an unsubscribe function. */
  onAuthEvent(listener: (event: AuthEvent) => void): () => void;
  /** Sends a password-reset email with a link back into the app. */
  requestPasswordReset(email: string): Promise<void>;
  /** Exchanges a password-recovery deep link for a temporary recovery session. */
  startPasswordRecovery(url: string): Promise<void>;
  /** Sets a new password for the signed-in (or recovering) user. */
  updatePassword(newPassword: string): Promise<void>;
  /** Demo credentials for the prototype; `null` in production backends. */
  getDemoCredentials(): SignInCredentials | null;
}

export interface DashboardService {
  getSummary(): Promise<DashboardSummary>;
  listActivity(limit?: number): Promise<Activity[]>;
}

export type OrderListParams = { filter?: OrderFilter; search?: string };

export interface OrdersService {
  list(params?: OrderListParams): Promise<Order[]>;
  counts(): Promise<OrderCounts>;
  get(id: ID): Promise<Order>;
  /** Re-runs a failed activation, optionally correcting the destination number. */
  retryActivation(id: ID, input?: { destination?: string }): Promise<Order>;
  /** For UNKNOWN results: checks with the operator before any retry (never duplicates). */
  verifyActivation(id: ID): Promise<Order>;
  cancel(id: ID): Promise<Order>;
  resendConfirmation(id: ID): Promise<void>;
}

export type PaymentListParams = { filter?: PaymentFilter; search?: string };

export interface PaymentsService {
  list(params?: PaymentListParams): Promise<Payment[]>;
  summary(): Promise<PaymentsSummary>;
  get(id: ID): Promise<Payment>;
  /** Human override for payments under review. */
  approve(id: ID): Promise<Payment>;
  reject(id: ID, reason: string): Promise<Payment>;
  /** Wallet accounts the tenant receives payments on. */
  listAccounts(): Promise<PaymentAccount[]>;
}

export interface ProductsService {
  list(): Promise<Product[]>;
  get(id: ID): Promise<Product>;
  setActive(id: ID, active: boolean): Promise<Product>;
}

export interface DevicesService {
  list(): Promise<Device[]>;
  summary(): Promise<DevicesSummary>;
  get(id: ID): Promise<Device>;
  setPaused(id: ID, paused: boolean): Promise<Device>;
  /** Asks the device to run a harmless USSD (e.g. balance) to prove it works. */
  testUssd(id: ID): Promise<{ ok: boolean; response: string; durationMs: number }>;
}

export interface SimsService {
  list(params?: { deviceId?: ID }): Promise<Sim[]>;
  get(id: ID): Promise<Sim>;
  setPaused(id: ID, paused: boolean): Promise<Sim>;
}

export interface NotificationsService {
  list(): Promise<AppNotification[]>;
  markRead(id: ID): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface WhatsAppService {
  getConnection(): Promise<WhatsAppConnection>;
  listGroups(): Promise<WhatsAppGroup[]>;
  setGroupMonitored(id: ID, monitored: boolean): Promise<WhatsAppGroup>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: ID): Promise<Conversation>;
}

export interface AutomationService {
  getSettings(): Promise<AutomationSettings>;
  updateSettings(patch: Partial<AutomationSettings>): Promise<AutomationSettings>;
  getStats(): Promise<AutomationStats>;
  listTasks(): Promise<ActivationTask[]>;
  getTask(id: ID): Promise<ActivationTask>;
}

/**
 * Platform administration (MegaBot staff) — the only cross-tenant service.
 * Unlike every other service it is NOT scoped to the signed-in tenant; access
 * is decided by the backend from platform_admins, never by the app. Tenant
 * calls by non-admins reject with PERMISSION_DENIED (reason
 * PLATFORM_ACCESS_DENIED); audit logs are filtered instead (empty list).
 */
export interface PlatformAdminService {
  /** The caller's platform role/permissions as computed by the backend. Never throws for non-admins. */
  getPlatformAdminContext(): Promise<PlatformAdminContext>;
  listTenants(params?: PlatformTenantListParams): Promise<PlatformTenant[]>;
  getTenant(id: ID): Promise<PlatformTenant>;
  /** active → suspended, audited as tenant.suspended. */
  suspendTenant(id: ID, input?: TenantStatusChangeInput): Promise<PlatformTenant>;
  /** suspended → active, audited as tenant.reactivated. */
  reactivateTenant(id: ID, input?: TenantStatusChangeInput): Promise<PlatformTenant>;
  /** Newest first; empty for non-admins (RLS). Read-only: the audit trail cannot be changed. */
  getAuditLogs(query?: AuditLogQuery): Promise<AuditLogEntry[]>;
}

export type Services = {
  auth: AuthService;
  dashboard: DashboardService;
  orders: OrdersService;
  payments: PaymentsService;
  products: ProductsService;
  devices: DevicesService;
  sims: SimsService;
  notifications: NotificationsService;
  whatsapp: WhatsAppService;
  automation: AutomationService;
  platformAdmin: PlatformAdminService;
};
