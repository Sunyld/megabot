import type { AuthEvent, AuthService } from '@/services/types';
import type { Session, SignInCredentials, SignUpInput } from '@/types';

import { createSessionController } from '../sessionController';

const appSession = (userId = 'user-a', tenant: Partial<Session['tenant']> = {}): Session => ({
  user: { id: userId, name: 'Ana', email: `${userId}@megabot.test`, phone: '', role: 'owner' },
  tenant: {
    id: `tenant-of-${userId}`,
    name: 'MegaBot Test',
    slug: 'megabot-test',
    status: 'active',
    plan: null,
    currency: 'MZN',
    timezone: 'Africa/Maputo',
    locale: 'pt-MZ',
    ...tenant,
  },
  expiresAt: '2026-10-01T12:00:00.000Z',
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  let emitEvent: (event: AuthEvent) => void = () => {};
  const mocks = {
    signIn: jest.fn((credentials: SignInCredentials) => Promise.resolve(appSession())),
    signUp: jest.fn((input: SignUpInput) => Promise.resolve(appSession())),
    signOut: jest.fn(() => Promise.resolve()),
    restore: jest.fn(() => Promise.resolve<Session | null>(null)),
    onAuthEvent: jest.fn((listener: (event: AuthEvent) => void) => {
      emitEvent = listener;
      return () => {};
    }),
    requestPasswordReset: jest.fn((email: string) => Promise.resolve()),
    startPasswordRecovery: jest.fn((url: string) => Promise.resolve()),
    updatePassword: jest.fn((password: string) => Promise.resolve()),
    getDemoCredentials: () => null,
  };
  const auth: AuthService = mocks;
  const effects = { clearUserData: jest.fn(), setTenantScope: jest.fn((tenantId: string | null) => {}) };
  const controller = createSessionController(auth, effects);
  return { controller, mocks, effects, emit: (event: AuthEvent) => emitEvent(event) };
}

const credentials = { email: 'ana@megabot.test', password: 'segredo123' };

describe('restore on launch', () => {
  it('opens the app with the restored tenant context', async () => {
    const { controller, mocks, effects } = setup();
    mocks.restore.mockResolvedValueOnce(appSession());
    controller.start();
    await flush();
    expect(controller.getState()).toMatchObject({ status: 'signedIn', session: { tenant: { id: 'tenant-of-user-a' } } });
    expect(effects.setTenantScope).toHaveBeenLastCalledWith('tenant-of-user-a');
  });

  it('starts signed out without a session, or when restoring fails', async () => {
    const a = setup();
    a.controller.start();
    await flush();
    expect(a.controller.getState().status).toBe('signedOut');

    const b = setup();
    b.mocks.restore.mockRejectedValueOnce(new Error('offline'));
    b.controller.start();
    await flush();
    expect(b.controller.getState().status).toBe('signedOut');
  });

  it('routes suspended tenants to the suspended state without tenant data access', async () => {
    const { controller, mocks, effects } = setup();
    mocks.restore.mockResolvedValueOnce(appSession('user-a', { status: 'suspended' }));
    controller.start();
    await flush();
    expect(controller.getState().status).toBe('suspended');
    expect(effects.setTenantScope).toHaveBeenLastCalledWith(null);
  });
});

describe('sign in / sign out', () => {
  it('signs in, then signs out clearing session, tenant scope and user data', async () => {
    const { controller, effects } = setup();
    await controller.signIn(credentials);
    expect(controller.getState().status).toBe('signedIn');

    effects.clearUserData.mockClear();
    await controller.signOut();
    expect(controller.getState()).toEqual({ status: 'signedOut', session: null });
    expect(effects.setTenantScope).toHaveBeenLastCalledWith(null);
    expect(effects.clearUserData).toHaveBeenCalled();
  });

  it('signs out locally even if the server call fails', async () => {
    const { controller, mocks } = setup();
    await controller.signIn(credentials);
    mocks.signOut.mockRejectedValueOnce(new Error('offline'));
    await expect(controller.signOut()).rejects.toThrow('offline');
    expect(controller.getState().status).toBe('signedOut');
  });

  it('SIGN_IN → SIGN_OUT → SIGN_IN: a slow first sign-in never overwrites the newer session', async () => {
    const { controller, mocks } = setup();
    const slow = deferred<Session>();
    mocks.signIn.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(appSession('user-b'));

    const first = controller.signIn(credentials);
    await controller.signOut();
    await controller.signIn(credentials);
    slow.resolve(appSession('user-a'));
    await first;

    expect(controller.getState().session?.user.id).toBe('user-b');
  });

  it('a sign-in that resolves after sign-out stays signed out', async () => {
    const { controller, mocks } = setup();
    const slow = deferred<Session>();
    mocks.signIn.mockReturnValueOnce(slow.promise);

    const pending = controller.signIn(credentials);
    await controller.signOut();
    slow.resolve(appSession());
    await pending;

    expect(controller.getState().status).toBe('signedOut');
  });

  it('clears cached data when a different user signs in', async () => {
    const { controller, mocks, effects } = setup();
    await controller.signIn(credentials);
    effects.clearUserData.mockClear();
    mocks.signIn.mockResolvedValueOnce(appSession('user-b'));
    await controller.signIn(credentials);
    expect(effects.clearUserData).toHaveBeenCalled();
  });
});

describe('auth events', () => {
  it('SIGNED_OUT from the backend returns to the auth flow', async () => {
    const { controller, emit } = setup();
    controller.start();
    await controller.signIn(credentials);
    emit({ type: 'SIGNED_OUT' });
    expect(controller.getState()).toEqual({ status: 'signedOut', session: null });
  });

  it('SIGNED_IN from elsewhere reloads the tenant context (deferred)', async () => {
    const { controller, mocks, emit } = setup();
    controller.start();
    await flush();
    mocks.restore.mockResolvedValueOnce(appSession('user-b'));
    emit({ type: 'SIGNED_IN', userId: 'user-b' });
    await flush();
    await flush();
    expect(controller.getState().session?.user.id).toBe('user-b');
  });

  it('ignores SIGNED_IN emitted by its own sign-in', async () => {
    const { controller, mocks, emit } = setup();
    controller.start();
    await flush();
    mocks.restore.mockClear();
    mocks.signIn.mockImplementationOnce(async () => {
      emit({ type: 'SIGNED_IN', userId: 'user-a' });
      return appSession();
    });
    await controller.signIn(credentials);
    await flush();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('TOKEN_REFRESHED and USER_UPDATED update the session in place', async () => {
    const { controller, emit } = setup();
    controller.start();
    await controller.signIn(credentials);
    emit({ type: 'TOKEN_REFRESHED', expiresAt: '2026-10-01T13:00:00.000Z' });
    emit({ type: 'USER_UPDATED', email: 'novo@megabot.test', name: null });
    expect(controller.getState()).toMatchObject({
      status: 'signedIn',
      session: { expiresAt: '2026-10-01T13:00:00.000Z', user: { email: 'novo@megabot.test', name: 'Ana' } },
    });
  });
});

describe('password recovery', () => {
  it('keeps the app locked until the new password is saved', async () => {
    const { controller, mocks, emit } = setup();
    controller.start();
    await flush();

    await controller.startPasswordRecovery('megabot://reset-password#access_token=a&refresh_token=b');
    expect(controller.getState().status).toBe('recovering');

    // The recovery link signs in temporarily: must not open the dashboard.
    emit({ type: 'SIGNED_IN', userId: 'user-a' });
    await flush();
    expect(controller.getState().status).toBe('recovering');

    mocks.restore.mockResolvedValueOnce(appSession());
    await controller.completePasswordRecovery('nova-segura-1');
    expect(mocks.updatePassword).toHaveBeenCalledWith('nova-segura-1');
    expect(controller.getState().status).toBe('signedIn');
  });

  it('returns to sign-in when the link is invalid', async () => {
    const { controller, mocks } = setup();
    mocks.startPasswordRecovery.mockRejectedValueOnce(new Error('invalid link'));
    await expect(controller.startPasswordRecovery('megabot://reset-password')).rejects.toThrow('invalid link');
    expect(controller.getState().status).toBe('signedOut');
  });
});
