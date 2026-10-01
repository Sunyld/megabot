import type { AuthEvent, AuthService } from '@/services/types';
import type { Session, SignInCredentials, SignUpInput } from '@/types';

/**
 * App session state machine (no React, testable).
 *
 *  restoring ─▶ signedOut ◀──────────────┐
 *      │            │ signIn / signUp     │ signOut / SIGNED_OUT
 *      ▼            ▼                     │
 *   signedIn ◀── context loaded ─▶ suspended (tenant.status = suspended)
 *      ▲
 *  recovering (password-recovery link) ── new password ──┘
 *
 * Race safety: every operation takes a new "epoch"; results from an older
 * epoch are dropped, so a slow sign-in can never overwrite a later sign-out.
 */
export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn' | 'suspended' | 'recovering';

export type SessionState = {
  status: SessionStatus;
  session: Session | null;
};

export type SessionEffects = {
  /** Drops every cached piece of user/tenant data (query cache…). */
  clearUserData(): void;
  /** Tenant scope for data services; `null` blocks tenant data access. */
  setTenantScope(tenantId: string | null): void;
};

export type SessionController = ReturnType<typeof createSessionController>;

export function createSessionController(auth: AuthService, effects: SessionEffects) {
  let state: SessionState = { status: 'restoring', session: null };
  const listeners = new Set<() => void>();
  let epoch = 0;
  /** True while the app itself is signing in/up (its own SIGNED_IN events are expected). */
  let ownAuthAction = false;
  /** True between opening a recovery link and setting the new password. */
  let recovering = false;

  const set = (next: SessionState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const enter = (session: Session) => {
    const sameUser = state.session?.user.id === session.user.id && state.session.tenant.id === session.tenant.id;
    if (!sameUser) effects.clearUserData();
    const suspended = session.tenant.status === 'suspended';
    effects.setTenantScope(suspended ? null : session.tenant.id);
    set({ status: suspended ? 'suspended' : 'signedIn', session });
  };

  const leave = () => {
    effects.setTenantScope(null);
    effects.clearUserData();
    set({ status: 'signedOut', session: null });
  };

  /** Runs an auth operation under a fresh epoch; stale results are discarded. */
  async function run(task: () => Promise<Session | null>): Promise<void> {
    const current = ++epoch;
    try {
      const session = await task();
      if (current !== epoch) return;
      if (session) enter(session);
      else leave();
    } catch (error) {
      if (current === epoch && state.status === 'restoring') leave();
      throw error;
    }
  }

  async function ownAction(task: () => Promise<Session>): Promise<void> {
    ownAuthAction = true;
    try {
      await run(task);
    } finally {
      ownAuthAction = false;
    }
  }

  const reloadQuietly = () => {
    run(() => auth.restore()).catch(() => {
      // restore() already discarded an unusable session; the SIGNED_OUT event
      // (or this fallback) returns the app to the auth flow.
      if (state.status !== 'signedOut' && state.status !== 'recovering') leave();
    });
  };

  function handleEvent(event: AuthEvent) {
    switch (event.type) {
      case 'SIGNED_OUT':
        ++epoch;
        recovering = false;
        if (state.status !== 'signedOut') leave();
        return;

      case 'SIGNED_IN':
        // Our own sign-in/up already loads the context; a recovery link signs
        // in temporarily and must not open the app before the new password.
        if (ownAuthAction || recovering) return;
        if (state.session?.user.id === event.userId) return;
        // Signed in elsewhere (e.g. restored by the client): load the context.
        // Deferred: never chain auth calls inside the auth callback.
        setTimeout(reloadQuietly, 0);
        return;

      case 'TOKEN_REFRESHED':
        if (state.session) set({ ...state, session: { ...state.session, expiresAt: event.expiresAt } });
        return;

      case 'USER_UPDATED':
        if (state.session) {
          set({
            ...state,
            session: {
              ...state.session,
              user: {
                ...state.session.user,
                email: event.email ?? state.session.user.email,
                name: event.name ?? state.session.user.name,
              },
            },
          });
        }
        return;

      case 'PASSWORD_RECOVERY':
        recovering = true;
        ++epoch;
        effects.setTenantScope(null);
        effects.clearUserData();
        set({ status: 'recovering', session: null });
        return;
    }
  }

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Restores the persisted session and starts listening to auth events. */
    start(): () => void {
      const unsubscribe = auth.onAuthEvent(handleEvent);
      run(() => auth.restore()).catch(() => {
        // Unusable stored session (offline, no tenant…): start signed out.
      });
      return unsubscribe;
    },

    signIn: (credentials: SignInCredentials) => ownAction(() => auth.signIn(credentials)),

    signUp: (input: SignUpInput) => ownAction(() => auth.signUp(input)),

    async signOut(): Promise<void> {
      ++epoch;
      recovering = false;
      leave();
      await auth.signOut();
    },

    /** Re-reads tenant + membership + settings (e.g. "check again" when suspended). */
    reload: () => run(() => auth.restore()),

    async startPasswordRecovery(url: string): Promise<void> {
      recovering = true;
      ++epoch;
      effects.setTenantScope(null);
      effects.clearUserData();
      set({ status: 'recovering', session: null });
      try {
        await auth.startPasswordRecovery(url);
      } catch (error) {
        recovering = false;
        set({ status: 'signedOut', session: null });
        throw error;
      }
    },

    async completePasswordRecovery(newPassword: string): Promise<void> {
      await auth.updatePassword(newPassword);
      recovering = false;
      await run(() => auth.restore());
    },

    async cancelPasswordRecovery(): Promise<void> {
      recovering = false;
      ++epoch;
      leave();
      await auth.signOut();
    },
  };
}
