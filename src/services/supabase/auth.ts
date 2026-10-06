import type { PlatformAdminContext, Session } from '@/types';

import { assertValidNewPassword, assertValidSignUp, isValidEmail } from '../authValidation';
import { AppError } from '../errors';
import type { AuthEvent, AuthService } from '../types';
import { logAuthError, toAppError, type AuthErrorContext } from './errors';
import {
  buildSignUpPayload,
  parseRecoveryUrl,
  type AuthGateway,
  type GatewayAuthEvent,
  type GatewaySession,
} from './gateway';
import { toPlatformAdminContext } from './platformAdmin';
import { readDisplayName, selectMembership, toSessionIdentity, toSessionUser } from './tenancy';

export type SupabaseAuthOptions = {
  /** Deep link Supabase sends users back to from the reset email (e.g. megabot://reset-password). */
  recoveryRedirectUrl: () => string;
};

const LOGGED_CODES = new Set(['DATABASE_ERROR', 'UNKNOWN_ERROR', 'CONFIG_ERROR']);

function fail(operation: AuthErrorContext, error: unknown): never {
  const appError = toAppError(error, operation);
  if (LOGGED_CODES.has(appError.code) || appError.reason === 'AUTH_UNKNOWN_ERROR') {
    logAuthError(operation, appError);
  }
  throw appError;
}

const invalidRecoveryLink = (detail: string) =>
  new AppError('AUTH_ERROR', 'O link de recuperação é inválido ou expirou. Peça um novo link.', {
    reason: 'RECOVERY_LINK_INVALID',
    detail,
  });

/** Maps raw Supabase auth events to the app's AuthEvent (null = not relevant). */
export function mapAuthEvent(event: GatewayAuthEvent, session: GatewaySession | null): AuthEvent | null {
  switch (event) {
    case 'SIGNED_IN':
      return session ? { type: 'SIGNED_IN', userId: session.user.id } : null;
    case 'SIGNED_OUT':
      return { type: 'SIGNED_OUT' };
    case 'TOKEN_REFRESHED':
      return session ? { type: 'TOKEN_REFRESHED', expiresAt: session.expiresAt } : null;
    case 'USER_UPDATED':
      return session
        ? { type: 'USER_UPDATED', email: session.user.email ?? null, name: readDisplayName(session.user) }
        : null;
    case 'PASSWORD_RECOVERY':
      return { type: 'PASSWORD_RECOVERY' };
    default:
      // INITIAL_SESSION is handled by restore(); MFA events are not used yet.
      return null;
  }
}

/** Why an authenticated user cannot open any area of the app. */
type AccessDenied = { denied: 'TENANT_NOT_FOUND' | 'PLATFORM_ADMIN_SUSPENDED' };
type ContextResult = { session: Session } | AccessDenied;

function accessDeniedError(result: AccessDenied): AppError {
  return result.denied === 'PLATFORM_ADMIN_SUSPENDED'
    ? new AppError(
        'PERMISSION_DENIED',
        'O seu acesso de administração da plataforma está suspenso. Contacte um super-administrador do MegaBot.',
        { reason: 'PLATFORM_ADMIN_SUSPENDED' }
      )
    : new AppError(
        'NOT_FOUND',
        'Esta conta não está associada a nenhuma empresa. Se acabou de se registar, tente novamente; caso contrário contacte o suporte.',
        { reason: 'TENANT_NOT_FOUND' }
      );
}

/** The backend answered that platform_admin_context() does not exist (PostgREST / Postgres). */
function isMissingFunction(error: unknown): boolean {
  const sqlState = toAppError(error).detail?.split(' | ')[0];
  return sqlState === 'PGRST202' || sqlState === '42883';
}

/**
 * Platform access could not be read. Never treated as "not a platform admin":
 * that would send an admin without a tenant to "no company" (TENANT_NOT_FOUND)
 * and hide the real problem (migration 002 missing or not exposed by the API).
 */
const platformAccessUnavailable = (error: unknown) =>
  new AppError(
    'CONFIG_ERROR',
    'Não foi possível verificar o acesso de administração da plataforma. Tente novamente; se persistir, contacte o suporte.',
    { reason: 'PLATFORM_ACCESS_UNAVAILABLE', detail: toAppError(error).detail }
  );

/**
 * Supabase Auth + app context.
 *
 * The app only ever calls auth endpoints and reads its own memberships and
 * platform access: tenants, memberships and settings are provisioned by the
 * database trigger (migration 001), never inserted from here. The tenant is
 * derived from tenant_users under RLS (auth.uid()), never from client input,
 * and platform access only from platform_admins (migration 002).
 */
export function createSupabaseAuthService(gateway: AuthGateway, options: SupabaseAuthOptions): AuthService {
  // Concurrent context loads for the same user share one request.
  let inflight: { userId: string; promise: Promise<ContextResult> } | null = null;

  async function readPlatformAccess(): Promise<PlatformAdminContext> {
    try {
      return toPlatformAdminContext(await gateway.fetchPlatformAccess());
    } catch (error) {
      if (isMissingFunction(error)) throw platformAccessUnavailable(error);
      throw error;
    }
  }

  /**
   * auth session → which area opens:
   *  1. ACTIVE platform admin → platform area (with or without a tenant);
   *  2. otherwise a tenant membership → tenant app (tenant + settings);
   *  3. otherwise no access (suspended platform admins get their own message).
   */
  function loadContext(session: GatewaySession): Promise<ContextResult> {
    if (inflight && inflight.userId === session.user.id) return inflight.promise;

    const promise = (async (): Promise<ContextResult> => {
      const [records, platformAdmin] = await Promise.all([
        gateway.fetchMemberships(session.user.id),
        readPlatformAccess(),
      ]);
      if (platformAdmin.isPlatformAdmin) {
        return {
          session: {
            kind: 'platform',
            user: toSessionIdentity(session.user),
            tenant: null,
            platformAdmin,
            expiresAt: session.expiresAt,
          },
        };
      }
      const membership = selectMembership(records);
      if (membership) {
        return {
          session: {
            kind: 'tenant',
            user: toSessionUser(session.user, membership.role),
            tenant: membership.tenant,
            platformAdmin: null,
            expiresAt: session.expiresAt,
          },
        };
      }
      return { denied: platformAdmin.status === 'SUSPENDED' ? 'PLATFORM_ADMIN_SUSPENDED' : 'TENANT_NOT_FOUND' };
    })();

    inflight = { userId: session.user.id, promise };
    const clear = () => {
      if (inflight?.promise === promise) inflight = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  return {
    async signUp(input) {
      assertValidSignUp(input);

      let session: GatewaySession | null;
      try {
        session = await gateway.signUp(buildSignUpPayload(input));
      } catch (error) {
        return fail('sign_up', error);
      }
      if (!session) {
        throw new AppError(
          'AUTH_ERROR',
          'O projeto Supabase exige confirmação de email. Desative "Confirm email" em Authentication › Sign In / Providers › Email.',
          { reason: 'EMAIL_CONFIRMATION_REQUIRED' }
        );
      }

      let context: ContextResult;
      try {
        context = await loadContext(session);
      } catch (error) {
        await gateway.signOutLocally();
        const appError = toAppError(error, 'sign_up');
        if (appError.code === 'NETWORK_ERROR') {
          throw new AppError(
            'NETWORK_ERROR',
            'A conta foi criada, mas a ligação falhou ao abrir a sua empresa. Entre com o seu email e palavra-passe.',
            { detail: appError.detail }
          );
        }
        return fail('sign_up', appError);
      }

      if ('denied' in context) {
        // The account exists but the backend did not provision its tenant.
        await gateway.signOutLocally();
        return fail(
          'sign_up',
          new AppError(
            'DATABASE_ERROR',
            'A conta foi criada, mas a sua empresa ainda não ficou pronta. Tente entrar dentro de instantes; se persistir, contacte o suporte.',
            { reason: 'TENANT_PROVISIONING_ERROR', detail: 'no tenant_users row after sign-up' }
          )
        );
      }
      return context.session;
    },

    async signIn({ email, password }) {
      let session: GatewaySession;
      try {
        session = await gateway.signIn(email.trim(), password);
      } catch (error) {
        return fail('sign_in', error);
      }

      let context: ContextResult;
      try {
        context = await loadContext(session);
      } catch (error) {
        await gateway.signOutLocally();
        return fail('sign_in', error);
      }

      if ('denied' in context) {
        await gateway.signOutLocally();
        throw accessDeniedError(context);
      }
      return context.session;
    },

    async signOut() {
      try {
        await gateway.signOut();
      } catch (error) {
        // Offline or already expired: the local session must still go.
        await gateway.signOutLocally();
        logAuthError('session', toAppError(error, 'session'));
      }
    },

    async restore() {
      let session: GatewaySession | null;
      try {
        session = await gateway.getSession();
      } catch (error) {
        return fail('session', error);
      }
      if (!session) return null;

      let context: ContextResult;
      try {
        context = await loadContext(session);
      } catch (error) {
        const appError = toAppError(error, 'session');
        // Offline: keep the stored session so the next launch can retry.
        if (appError.code !== 'NETWORK_ERROR') await gateway.signOutLocally();
        return fail('session', appError);
      }

      if ('denied' in context) {
        await gateway.signOutLocally();
        throw accessDeniedError(context);
      }
      return context.session;
    },

    onAuthEvent(listener) {
      try {
        // Keep the callback synchronous: Supabase warns against awaiting other
        // auth calls inside onAuthStateChange. Consumers schedule async work.
        return gateway.onAuthStateChange((event, session) => {
          const mapped = mapAuthEvent(event, session);
          if (mapped) listener(mapped);
        });
      } catch (error) {
        // Misconfigured client: sign-in reports the configuration error instead.
        logAuthError('session', toAppError(error, 'session'));
        return () => {};
      }
    },

    async requestPasswordReset(email) {
      if (!isValidEmail(email)) {
        throw new AppError('VALIDATION_ERROR', 'O endereço de email não é válido.', { reason: 'INVALID_EMAIL' });
      }
      try {
        // Supabase answers the same way whether or not the email exists.
        await gateway.resetPasswordForEmail(email.trim(), options.recoveryRedirectUrl());
      } catch (error) {
        return fail('password_reset', error);
      }
    },

    async startPasswordRecovery(url) {
      const parsed = parseRecoveryUrl(url);
      if (parsed.kind === 'none') throw invalidRecoveryLink('no recovery parameters in URL');
      if (parsed.kind === 'error') throw invalidRecoveryLink(`${parsed.code}: ${parsed.description}`);
      try {
        await gateway.establishRecoverySession(parsed);
      } catch (error) {
        const appError = toAppError(error, 'password_update');
        if (appError.code === 'NETWORK_ERROR') throw appError;
        throw invalidRecoveryLink(appError.detail ?? appError.message);
      }
    },

    async updatePassword(newPassword) {
      assertValidNewPassword(newPassword);
      try {
        await gateway.updatePassword(newPassword);
      } catch (error) {
        return fail('password_update', error);
      }
    },

    getDemoCredentials() {
      return null;
    },
  };
}
