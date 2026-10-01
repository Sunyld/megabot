import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';

import { SupabaseConfigError } from '@/lib/supabase/config';

import { AppError, type AppErrorCode, type AppErrorReason } from '../errors';

/**
 * Translates anything thrown by Supabase (auth, PostgREST, fetch, config) into
 * an AppError with a friendly pt-MZ message. Technical text from Supabase only
 * ever goes to `detail` (logs), never to the user.
 *
 * `context` disambiguates server failures: during sign-up a 500 almost always
 * means the database trigger could not provision the tenant.
 */
export type AuthErrorContext = 'sign_up' | 'sign_in' | 'session' | 'password_reset' | 'password_update' | 'data';

const NETWORK_PATTERN = /network request failed|failed to fetch|fetch failed|load failed|networkerror/i;
const MIGRATION_HINT =
  'A base de dados ainda não tem as tabelas necessárias. Aplique as migrations de supabase/migrations no Supabase.';

const MESSAGES = {
  network: 'Sem ligação ao servidor. Verifique a sua rede e tente novamente.',
  sessionExpired: 'A sua sessão expirou. Entre novamente.',
  invalidCredentials: 'Email ou palavra-passe incorretos.',
  emailTaken: 'Já existe uma conta com este email. Entre ou recupere a palavra-passe.',
  invalidEmail: 'O endereço de email não é válido.',
  weakPassword: 'A palavra-passe é demasiado fraca. Use pelo menos 8 caracteres, com letras e números.',
  samePassword: 'A nova palavra-passe tem de ser diferente da anterior.',
  rateLimit: 'Demasiadas tentativas. Aguarde alguns minutos e tente novamente.',
  provisioning: 'Não foi possível preparar a sua empresa. Tente novamente dentro de instantes.',
  emailConfirmation:
    'O projeto Supabase exige confirmação de email. Desative "Confirm email" em Authentication › Sign In / Providers › Email.',
  authUnknown: 'Não foi possível concluir a autenticação. Tente novamente.',
  server: 'O servidor não conseguiu concluir o pedido. Tente novamente.',
} as const;

type PostgrestLike = { code: string; message: string; details?: string | null; hint?: string | null };

function isPostgrestLike(error: unknown): error is PostgrestLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

const make = (code: AppErrorCode, message: string, detail: string, reason?: AppErrorReason) =>
  new AppError(code, message, { detail, reason });

function fromAuthError(code: string | undefined, status: number | undefined, detail: string, context: AuthErrorContext): AppError {
  switch (code) {
    case 'invalid_credentials':
      return make('AUTH_ERROR', MESSAGES.invalidCredentials, detail, 'INVALID_CREDENTIALS');
    case 'user_already_exists':
    case 'email_exists':
      return make('CONFLICT', MESSAGES.emailTaken, detail, 'EMAIL_ALREADY_REGISTERED');
    case 'weak_password':
      return make('VALIDATION_ERROR', MESSAGES.weakPassword, detail, 'WEAK_PASSWORD');
    case 'same_password':
      return make('VALIDATION_ERROR', MESSAGES.samePassword, detail, 'SAME_PASSWORD');
    case 'email_address_invalid':
    case 'email_address_not_authorized':
      return make('VALIDATION_ERROR', MESSAGES.invalidEmail, detail, 'INVALID_EMAIL');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return make('AUTH_ERROR', MESSAGES.rateLimit, detail, 'AUTH_RATE_LIMIT');
    case 'email_not_confirmed':
      return make('AUTH_ERROR', MESSAGES.emailConfirmation, detail, 'EMAIL_CONFIRMATION_REQUIRED');
    case 'signup_disabled':
    case 'email_provider_disabled':
      return make('AUTH_ERROR', 'O registo de contas por email está desativado no projeto Supabase.', detail, 'AUTH_UNKNOWN_ERROR');
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
      return make('AUTH_ERROR', MESSAGES.sessionExpired, detail, 'SESSION_EXPIRED');
    default:
      if (code === 'unexpected_failure' || (status !== undefined && status >= 500)) {
        // GoTrue reports a failing sign-up trigger as "Database error saving new user".
        return context === 'sign_up'
          ? make('DATABASE_ERROR', MESSAGES.provisioning, detail, 'TENANT_PROVISIONING_ERROR')
          : make('DATABASE_ERROR', MESSAGES.server, detail);
      }
      return make('AUTH_ERROR', MESSAGES.authUnknown, detail, 'AUTH_UNKNOWN_ERROR');
  }
}

function fromPostgrestError(error: PostgrestLike): AppError {
  const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(' | ');
  switch (error.code) {
    case '42501':
      return make('PERMISSION_DENIED', 'Não tem permissão para esta operação.', detail);
    case 'PGRST116':
    case 'P0002':
      return make('NOT_FOUND', 'Registo não encontrado.', detail);
    case '23505':
      return make('CONFLICT', 'Já existe um registo com estes dados.', detail);
    // Raised by our SQL functions for invalid state transitions (e.g. already suspended).
    case '55000':
      return make('CONFLICT', 'A operação não é possível no estado atual do registo.', detail);
    // Raised by our SQL functions with a user-facing (pt) message.
    case '22023':
    case '22004':
      return make('VALIDATION_ERROR', error.message, detail);
    case '23502':
    case '23503':
    case '23514':
    case '22P02':
      return make('VALIDATION_ERROR', 'Os dados enviados não são válidos.', detail);
    case '42P01':
    case '42883':
    case 'PGRST202':
    case 'PGRST205':
      return make('DATABASE_ERROR', MIGRATION_HINT, detail);
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return make('AUTH_ERROR', MESSAGES.sessionExpired, detail, 'SESSION_EXPIRED');
    default:
      if (!error.code && NETWORK_PATTERN.test(error.message)) {
        return make('NETWORK_ERROR', MESSAGES.network, detail);
      }
      return make('DATABASE_ERROR', 'Erro ao comunicar com a base de dados. Tente novamente.', detail);
  }
}

export function toAppError(error: unknown, context: AuthErrorContext = 'data'): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof SupabaseConfigError) return new AppError('CONFIG_ERROR', error.message);

  const detail = messageOf(error);
  if (isAuthRetryableFetchError(error) || (error instanceof TypeError && NETWORK_PATTERN.test(detail))) {
    return make('NETWORK_ERROR', MESSAGES.network, detail);
  }
  if (isAuthWeakPasswordError(error)) {
    return make('VALIDATION_ERROR', MESSAGES.weakPassword, detail, 'WEAK_PASSWORD');
  }
  if (isAuthError(error)) return fromAuthError(error.code, error.status, detail, context);
  if (isPostgrestLike(error)) return fromPostgrestError(error);

  return make('UNKNOWN_ERROR', 'Ocorreu um erro inesperado. Tente novamente.', detail);
}

/** Logs an auth/onboarding failure without personal data (no email, no password). */
export function logAuthError(operation: AuthErrorContext, error: AppError): void {
  console.warn(`[MegaBot][auth] ${operation} failed: ${error.code}${error.reason ? `/${error.reason}` : ''}`, error.detail ?? '');
}
