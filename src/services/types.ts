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
  ConfirmPaymentInput,
  CreateOrderInput,
  CreatePaymentAccountInput,
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
  PaymentAccountRecord,
  PaymentEventRecord,
  PaymentFilter,
  PaymentMatchRecord,
  PaymentProofRecord,
  PaymentsSummary,
  PlatformAdminContext,
  PlatformTenant,
  PlatformTenantListParams,
  Product,
  ProductInput,
  ReconciliationStatus,
  RecordPaymentEventInput,
  Session,
  SignInCredentials,
  SignUpInput,
  Sim,
  SubmitPaymentProofInput,
  TenantStatusChangeInput,
  UpdatePaymentAccountInput,
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
  getDemoCredentials(): DemoCredentials | null;
}

/** Mock mode only: a tenant owner and a platform admin to explore both areas. */
export type DemoCredentials = { tenant: SignInCredentials; platform: SignInCredentials };

export interface DashboardService {
  getSummary(): Promise<DashboardSummary>;
  listActivity(limit?: number): Promise<Activity[]>;
}

export type OrderListParams = { filter?: OrderFilter; search?: string };

/**
 * Orders of the signed-in tenant (migration 004). Status changes are explicit
 * commands — there is no generic update — and the backend validates every
 * transition. Any member (owner / admin / operator) of an active tenant can
 * run them.
 */
export interface OrdersService {
  list(params?: OrderListParams): Promise<Order[]>;
  counts(): Promise<OrderCounts>;
  /** The order with its history (events). */
  get(id: ID): Promise<Order>;
  /** Registers a PENDING order for an active product; snapshot taken by the backend. Idempotent by key. */
  create(input: CreateOrderInput): Promise<Order>;
  /** PENDING → AWAITING_PAYMENT (payment instructions sent to the customer). */
  markAwaitingPayment(id: ID): Promise<Order>;
  /** Cancels where the state machine allows it; already cancelled = no-op. */
  cancel(id: ID, input?: { reason?: string }): Promise<Order>;
  /** Activation phase: re-runs a failed activation, optionally correcting the destination number. */
  retryActivation(id: ID, input?: { destination?: string }): Promise<Order>;
  /** Activation phase: for UNKNOWN results, checks with the operator before any retry (never duplicates). */
  verifyActivation(id: ID): Promise<Order>;
  /** WhatsApp phase: resends the delivery confirmation to the customer. */
  resendConfirmation(id: ID): Promise<void>;
}

export type PaymentListParams = { filter?: PaymentFilter; search?: string };

/**
 * Payments screens: "payment cases" (a customer's proof and / or a real wallet
 * event, with the reconciliation result). In Supabase mode this is a read
 * model over the financial core below; `approve` / `reject` delegate to
 * PaymentMatchesService.confirmManually / PaymentProofsService.reject.
 */
export interface PaymentsService {
  list(params?: PaymentListParams): Promise<Payment[]>;
  summary(): Promise<PaymentsSummary>;
  get(id: ID): Promise<Payment>;
  /** Human decision on a case under review: confirms it against the real wallet event. */
  approve(id: ID): Promise<Payment>;
  /** Rejects the customer's proof (a real wallet event can never be rejected). */
  reject(id: ID, reason: string): Promise<Payment>;
  /** Wallet accounts the tenant receives payments on. */
  listAccounts(): Promise<PaymentAccount[]>;
}

/**
 * Financial core (migration 005). Receiving accounts of the tenant. Reads: any
 * member; writes: owner / admin of an active tenant (audited). Never holds
 * credentials — only the provider, the holder name and the identifier.
 */
export interface PaymentAccountsService {
  list(): Promise<PaymentAccountRecord[]>;
  create(input: CreatePaymentAccountInput): Promise<PaymentAccountRecord>;
  /** Name / status only: provider and identifier are fixed (create a new account instead). */
  update(id: ID, input: UpdatePaymentAccountInput): Promise<PaymentAccountRecord>;
}

export type PaymentEventListParams = { paymentAccountId?: ID };

/**
 * Real wallet movements (immutable facts). `record` is the safe manual way to
 * register one (owner / admin, audited, idempotent per provider + account +
 * transaction ID); it immediately runs the deterministic reconciliation.
 */
export interface PaymentEventsService {
  list(params?: PaymentEventListParams): Promise<PaymentEventRecord[]>;
  get(id: ID): Promise<PaymentEventRecord>;
  record(input: RecordPaymentEventInput): Promise<PaymentEventRecord>;
}

export type PaymentProofListParams = { orderId?: ID; status?: ReconciliationStatus };

/**
 * Customer proofs: evidence, never authority. Their status is decided by the
 * backend only (reconciliation or an owner / admin rejection).
 */
export interface PaymentProofsService {
  list(params?: PaymentProofListParams): Promise<PaymentProofRecord[]>;
  get(id: ID): Promise<PaymentProofRecord>;
  /** Any member. Stored, then reconciled — a proof alone never confirms. */
  submit(input: SubmitPaymentProofInput): Promise<PaymentProofRecord>;
  /** Re-runs the reconciliation (e.g. after the real event arrived). Idempotent. */
  reconcile(id: ID): Promise<PaymentProofRecord>;
  /** Owner / admin, audited. Final. */
  reject(id: ID, reason: string): Promise<PaymentProofRecord>;
}

export type PaymentMatchListParams = { orderId?: ID; paymentEventId?: ID; paymentProofId?: ID };

/** Reconciliation decisions (append-only). */
export interface PaymentMatchesService {
  list(params?: PaymentMatchListParams): Promise<PaymentMatchRecord[]>;
  /**
   * Owner / admin decision on a review: links a REAL event to an order. May
   * accept a checked time-window / sender doubt, never a wrong amount,
   * currency or account, a used event or an order that cannot be paid. Audited.
   */
  confirmManually(input: ConfirmPaymentInput): Promise<PaymentMatchRecord>;
}

/**
 * Products of the signed-in tenant. Reads: any member. Writes: tenant owner /
 * admin while the tenant is active — enforced by the backend (RLS), which
 * rejects other callers with PERMISSION_DENIED.
 */
export interface ProductsService {
  /** Live products (archived ones excluded). */
  list(): Promise<Product[]>;
  get(id: ID): Promise<Product>;
  create(input: ProductInput): Promise<Product>;
  /** Replaces the editable fields (the product form). */
  update(id: ID, input: ProductInput): Promise<Product>;
  /** Puts the product on sale; requires a USSD flow. */
  activate(id: ID): Promise<Product>;
  deactivate(id: ID): Promise<Product>;
  /** Soft delete: hidden and frozen, kept so orders keep a valid reference. */
  archive(id: ID): Promise<void>;
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
  /** Every product of one tenant, archived included (read-only, permission tenants.read). */
  listTenantProducts(tenantId: ID): Promise<Product[]>;
}

export type Services = {
  auth: AuthService;
  dashboard: DashboardService;
  orders: OrdersService;
  payments: PaymentsService;
  paymentAccounts: PaymentAccountsService;
  paymentEvents: PaymentEventsService;
  paymentProofs: PaymentProofsService;
  paymentMatches: PaymentMatchesService;
  products: ProductsService;
  devices: DevicesService;
  sims: SimsService;
  notifications: NotificationsService;
  whatsapp: WhatsAppService;
  automation: AutomationService;
  platformAdmin: PlatformAdminService;
};
