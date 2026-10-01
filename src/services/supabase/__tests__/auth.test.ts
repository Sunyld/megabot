import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js';

import { AppError } from '../../errors';
import type { AuthEvent } from '../../types';
import { createSupabaseAuthService, mapAuthEvent } from '../auth';
import type { AuthGateway, GatewayAuthEvent, GatewaySession, RecoveryCredentials, SignUpPayload } from '../gateway';
import type { MembershipRecord } from '../tenancy';

/*
 * The auth service is exercised against a fake gateway (no network). These
 * tests cover the app-side logic only — they do NOT prove database security;
 * RLS/tenant isolation is verified by supabase/tests/001_tenants.test.sql.
 */

const REDIRECT = 'megabot://reset-password';

const gatewaySession = (userId = 'user-a', metadata: Record<string, unknown> = { name: 'Ana', business_name: 'MegaBot Test' }): GatewaySession => ({
  user: { id: userId, email: 'ana@megabot.test', phone: null, user_metadata: metadata },
  expiresAt: '2026-10-01T12:00:00.000Z',
});

const membershipRow = (overrides: Partial<NonNullable<MembershipRecord['tenant']>> = {}, role = 'owner'): MembershipRecord => ({
  role,
  created_at: '2026-10-01T10:00:00.000Z',
  tenant: {
    id: 'tenant-a',
    name: 'MegaBot Test',
    slug: 'megabot-test',
    status: 'active',
    settings: { currency: 'MZN', timezone: 'Africa/Maputo', locale: 'pt-MZ' },
    ...overrides,
  },
});

function createFakeGateway() {
  let authListener: ((event: GatewayAuthEvent, session: GatewaySession | null) => void) | null = null;
  const mocks = {
    signUp: jest.fn((payload: SignUpPayload) => Promise.resolve<GatewaySession | null>(gatewaySession())),
    signIn: jest.fn((email: string, password: string) => Promise.resolve(gatewaySession())),
    signOut: jest.fn(() => Promise.resolve()),
    signOutLocally: jest.fn(() => Promise.resolve()),
    getSession: jest.fn(() => Promise.resolve<GatewaySession | null>(null)),
    fetchMemberships: jest.fn((userId: string) => Promise.resolve<MembershipRecord[]>([membershipRow()])),
    resetPasswordForEmail: jest.fn((email: string, redirectTo: string) => Promise.resolve()),
    establishRecoverySession: jest.fn((credentials: RecoveryCredentials) => Promise.resolve(gatewaySession())),
    updatePassword: jest.fn((password: string) => Promise.resolve()),
    onAuthStateChange: jest.fn((listener: (event: GatewayAuthEvent, session: GatewaySession | null) => void) => {
      authListener = listener;
      return () => {
        authListener = null;
      };
    }),
  };
  const gateway: AuthGateway = mocks;
  const emit = (event: GatewayAuthEvent, session: GatewaySession | null) => authListener?.(event, session);
  return { gateway, mocks, emit };
}

const setup = () => {
  const fake = createFakeGateway();
  const auth = createSupabaseAuthService(fake.gateway, { recoveryRedirectUrl: () => REDIRECT });
  return { ...fake, auth };
};

const signUpInput = { name: 'Ana Langa', businessName: 'MegaBot Test', email: 'ana@megabot.test', password: 'segredo123' };

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected AppError, got ${String(error)}`);
  }
  throw new Error('Expected the promise to reject');
}

describe('registration', () => {
  it('signs up with business_name in options.data and loads the provisioned tenant', async () => {
    const { auth, mocks } = setup();
    const session = await auth.signUp(signUpInput);

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'ana@megabot.test',
      password: 'segredo123',
      options: { data: { name: 'Ana Langa', business_name: 'MegaBot Test' } },
    });
    expect(mocks.fetchMemberships).toHaveBeenCalledWith('user-a');
    expect(session).toEqual({
      user: { id: 'user-a', name: 'Ana', email: 'ana@megabot.test', phone: '', role: 'owner' },
      tenant: {
        id: 'tenant-a',
        name: 'MegaBot Test',
        slug: 'megabot-test',
        status: 'active',
        plan: null,
        currency: 'MZN',
        timezone: 'Africa/Maputo',
        locale: 'pt-MZ',
      },
      expiresAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('validates before calling the backend', async () => {
    const { auth, mocks } = setup();
    expect((await failure(auth.signUp({ ...signUpInput, businessName: 'X' }))).reason).toBe('INVALID_BUSINESS_NAME');
    expect((await failure(auth.signUp({ ...signUpInput, email: 'ana@' }))).reason).toBe('INVALID_EMAIL');
    expect((await failure(auth.signUp({ ...signUpInput, password: '123' }))).reason).toBe('WEAK_PASSWORD');
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthApiError('User already registered', 422, 'user_already_exists'), 'CONFLICT', 'EMAIL_ALREADY_REGISTERED'],
    [new AuthApiError('Email address "x" is invalid', 400, 'email_address_invalid'), 'VALIDATION_ERROR', 'INVALID_EMAIL'],
    [new AuthWeakPasswordError('Password is too weak', 422, ['length']), 'VALIDATION_ERROR', 'WEAK_PASSWORD'],
    [new AuthApiError('Too many requests', 429, 'over_email_send_rate_limit'), 'AUTH_ERROR', 'AUTH_RATE_LIMIT'],
    [new AuthApiError('Database error saving new user', 500, 'unexpected_failure'), 'DATABASE_ERROR', 'TENANT_PROVISIONING_ERROR'],
    [new AuthApiError('Something odd', 400, 'mystery_code'), 'AUTH_ERROR', 'AUTH_UNKNOWN_ERROR'],
  ])('maps %p to a friendly %s/%s', async (raw, code, reason) => {
    const { auth, mocks } = setup();
    mocks.signUp.mockRejectedValueOnce(raw);
    const error = await failure(auth.signUp(signUpInput));
    expect(error).toMatchObject({ code, reason });
    expect(error.message).not.toMatch(/User already registered|Database error|Too many requests/);
  });

  it('reports network failures', async () => {
    const { auth, mocks } = setup();
    mocks.signUp.mockRejectedValueOnce(new AuthRetryableFetchError('Failed to fetch', 0));
    expect((await failure(auth.signUp(signUpInput))).code).toBe('NETWORK_ERROR');
  });

  it('does not pretend success when the backend did not provision the tenant', async () => {
    const { auth, mocks } = setup();
    mocks.fetchMemberships.mockResolvedValueOnce([]);
    const error = await failure(auth.signUp(signUpInput));
    expect(error).toMatchObject({ code: 'DATABASE_ERROR', reason: 'TENANT_PROVISIONING_ERROR' });
    // Half-created session is discarded; the app never inserts tenant rows itself.
    expect(mocks.signOutLocally).toHaveBeenCalled();
    // Logged for diagnosis, without personal data.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('TENANT_PROVISIONING_ERROR');
    expect(logged).not.toContain('ana@megabot.test');
    expect(logged).not.toContain('segredo123');
  });

  it('explains when the project still requires email confirmation', async () => {
    const { auth, mocks } = setup();
    mocks.signUp.mockResolvedValueOnce(null);
    expect((await failure(auth.signUp(signUpInput))).reason).toBe('EMAIL_CONFIRMATION_REQUIRED');
  });
});

describe('login', () => {
  it('signs in and loads tenant → membership → settings', async () => {
    const { auth, mocks } = setup();
    mocks.fetchMemberships.mockResolvedValueOnce([membershipRow({}, 'admin')]);
    const session = await auth.signIn({ email: ' ana@megabot.test ', password: 'segredo123' });
    expect(mocks.signIn).toHaveBeenCalledWith('ana@megabot.test', 'segredo123');
    expect(session.user.role).toBe('admin');
    expect(session.tenant.id).toBe('tenant-a');
  });

  it('maps invalid credentials', async () => {
    const { auth, mocks } = setup();
    mocks.signIn.mockRejectedValueOnce(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'));
    expect(await failure(auth.signIn({ email: 'a@b.co', password: 'x' }))).toMatchObject({
      code: 'AUTH_ERROR',
      reason: 'INVALID_CREDENTIALS',
      message: 'Email ou palavra-passe incorretos.',
    });
  });

  it('maps network failures', async () => {
    const { auth, mocks } = setup();
    mocks.signIn.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await failure(auth.signIn({ email: 'a@b.co', password: 'x' }))).code).toBe('NETWORK_ERROR');
  });

  it('refuses accounts without a tenant and clears the local session', async () => {
    const { auth, mocks } = setup();
    mocks.fetchMemberships.mockResolvedValueOnce([]);
    expect((await failure(auth.signIn({ email: 'a@b.co', password: 'x' }))).reason).toBe('TENANT_NOT_FOUND');
    expect(mocks.signOutLocally).toHaveBeenCalled();
  });

  it('returns suspended tenants as such (the app shows the suspended state)', async () => {
    const { auth, mocks } = setup();
    mocks.fetchMemberships.mockResolvedValueOnce([membershipRow({ status: 'suspended' })]);
    const session = await auth.signIn({ email: 'a@b.co', password: 'x' });
    expect(session.tenant.status).toBe('suspended');
  });
});

describe('session', () => {
  it('restores nothing without a stored session', async () => {
    const { auth } = setup();
    await expect(auth.restore()).resolves.toBeNull();
  });

  it('restores the stored session with its tenant context', async () => {
    const { auth, mocks } = setup();
    mocks.getSession.mockResolvedValueOnce(gatewaySession());
    await expect(auth.restore()).resolves.toMatchObject({ user: { id: 'user-a' }, tenant: { id: 'tenant-a' } });
  });

  it('shares one tenant load between concurrent restores', async () => {
    const { auth, mocks } = setup();
    mocks.getSession.mockResolvedValue(gatewaySession());
    await Promise.all([auth.restore(), auth.restore(), auth.restore()]);
    expect(mocks.fetchMemberships).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored session when offline (retry on next launch)', async () => {
    const { auth, mocks } = setup();
    mocks.getSession.mockResolvedValueOnce(gatewaySession());
    mocks.fetchMemberships.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await failure(auth.restore())).code).toBe('NETWORK_ERROR');
    expect(mocks.signOutLocally).not.toHaveBeenCalled();
  });

  it('always clears the local session on sign-out, even when the server call fails', async () => {
    const { auth, mocks } = setup();
    mocks.signOut.mockRejectedValueOnce(new AuthRetryableFetchError('Failed to fetch', 0));
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mocks.signOutLocally).toHaveBeenCalled();
  });

  it('forwards SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED and USER_UPDATED; ignores INITIAL_SESSION', () => {
    const { auth, emit } = setup();
    const events: AuthEvent[] = [];
    const unsubscribe = auth.onAuthEvent((event) => events.push(event));

    emit('INITIAL_SESSION', gatewaySession());
    emit('SIGNED_IN', gatewaySession('user-b'));
    emit('TOKEN_REFRESHED', { ...gatewaySession(), expiresAt: '2026-10-01T13:00:00.000Z' });
    emit('USER_UPDATED', gatewaySession('user-a', { name: 'Ana L.' }));
    emit('SIGNED_OUT', null);
    unsubscribe();
    emit('SIGNED_OUT', null);

    expect(events).toEqual([
      { type: 'SIGNED_IN', userId: 'user-b' },
      { type: 'TOKEN_REFRESHED', expiresAt: '2026-10-01T13:00:00.000Z' },
      { type: 'USER_UPDATED', email: 'ana@megabot.test', name: 'Ana L.' },
      { type: 'SIGNED_OUT' },
    ]);
  });

  it('maps PASSWORD_RECOVERY and drops events without a session', () => {
    expect(mapAuthEvent('PASSWORD_RECOVERY', null)).toEqual({ type: 'PASSWORD_RECOVERY' });
    expect(mapAuthEvent('SIGNED_IN', null)).toBeNull();
    expect(mapAuthEvent('TOKEN_REFRESHED', null)).toBeNull();
  });
});

describe('password recovery', () => {
  it('sends the reset email with the app deep link', async () => {
    const { auth, mocks } = setup();
    await auth.requestPasswordReset(' ana@megabot.test ');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('ana@megabot.test', REDIRECT);
  });

  it('validates the email first', async () => {
    const { auth, mocks } = setup();
    expect((await failure(auth.requestPasswordReset('nope'))).reason).toBe('INVALID_EMAIL');
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('exchanges the recovery link for a session', async () => {
    const { auth, mocks } = setup();
    await auth.startPasswordRecovery(`${REDIRECT}#access_token=at&refresh_token=rt&type=recovery`);
    expect(mocks.establishRecoverySession).toHaveBeenCalledWith({ kind: 'tokens', accessToken: 'at', refreshToken: 'rt' });
  });

  it('rejects invalid or expired links', async () => {
    const { auth, mocks } = setup();
    expect((await failure(auth.startPasswordRecovery(REDIRECT))).reason).toBe('RECOVERY_LINK_INVALID');
    expect((await failure(auth.startPasswordRecovery(`${REDIRECT}#error=access_denied&error_code=otp_expired`))).reason).toBe(
      'RECOVERY_LINK_INVALID'
    );
    mocks.establishRecoverySession.mockRejectedValueOnce(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'));
    expect((await failure(auth.startPasswordRecovery(`${REDIRECT}#access_token=a&refresh_token=b`))).reason).toBe(
      'RECOVERY_LINK_INVALID'
    );
  });

  it('updates the password and maps server rules', async () => {
    const { auth, mocks } = setup();
    await auth.updatePassword('nova-segura-1');
    expect(mocks.updatePassword).toHaveBeenCalledWith('nova-segura-1');

    expect((await failure(auth.updatePassword('curta'))).reason).toBe('WEAK_PASSWORD');
    mocks.updatePassword.mockRejectedValueOnce(new AuthApiError('New password should be different', 422, 'same_password'));
    expect((await failure(auth.updatePassword('nova-segura-1'))).reason).toBe('SAME_PASSWORD');
  });
});
