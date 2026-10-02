/**
 * Structured service errors. Every service (mock or Supabase) rejects with an
 * AppError so the UI can react by category without knowing the backend.
 *
 * • `code`   — broad category, drives generic UI (offline banner, retry…).
 * • `reason` — optional precise cause for flows that need it (auth, onboarding).
 * • `message` is user-facing (pt-MZ); `detail` keeps technical context for logs
 *   and is never shown to the user.
 */
export type AppErrorCode =
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'DATABASE_ERROR'
  | 'CONFLICT'
  | 'CONFIG_ERROR'
  | 'UNKNOWN_ERROR';

export type AppErrorReason =
  // Registration
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'INVALID_BUSINESS_NAME'
  | 'TENANT_PROVISIONING_ERROR'
  // Sign-in / session
  | 'INVALID_CREDENTIALS'
  | 'TENANT_NOT_FOUND'
  | 'PLATFORM_ADMIN_SUSPENDED'
  | 'SESSION_EXPIRED'
  | 'EMAIL_CONFIRMATION_REQUIRED'
  // Password recovery
  | 'RECOVERY_LINK_INVALID'
  | 'SAME_PASSWORD'
  // Platform administration
  | 'PLATFORM_ACCESS_DENIED'
  | 'TENANT_ALREADY_SUSPENDED'
  | 'TENANT_ALREADY_ACTIVE'
  // Products
  | 'INVALID_PRODUCT'
  | 'PRODUCT_NAME_TAKEN'
  | 'PRODUCT_ARCHIVED'
  | 'PRODUCT_WRITE_DENIED'
  // Orders
  | 'INVALID_PHONE'
  | 'PRODUCT_NOT_AVAILABLE'
  | 'TENANT_SUSPENDED'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  // Payments (financial core)
  | 'PAYMENT_ACCOUNT_EXISTS'
  | 'PAYMENT_EVENT_CONFLICT'
  | 'PAYMENT_NOT_CONFIRMABLE'
  | 'PROOF_ALREADY_DECIDED'
  | 'PAYMENT_WRITE_DENIED'
  // Shared by domains still to come (payments, activation)
  | 'FEATURE_NOT_AVAILABLE'
  // Shared
  | 'AUTH_RATE_LIMIT'
  | 'AUTH_UNKNOWN_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly reason?: AppErrorReason;
  readonly detail?: string;

  constructor(code: AppErrorCode, message: string, options: { reason?: AppErrorReason; detail?: string } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.reason = options.reason;
    this.detail = options.detail;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
