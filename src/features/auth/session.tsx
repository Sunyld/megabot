import { createContext, use, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';

import { clearQueryCache } from '@/lib/query';
import { api, serviceContext } from '@/services';
import type { PlatformSession, Session, SignInCredentials, SignUpInput, TenantSession } from '@/types';

import { createSessionController, type SessionController, type SessionStatus } from './sessionController';

type SessionContextValue = {
  status: SessionStatus;
  session: Session | null;
  hasOnboarded: boolean;
  completeOnboarding: () => void;
  signIn: (credentials: SignInCredentials) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  startPasswordRecovery: (url: string) => Promise<void>;
  completePasswordRecovery: (newPassword: string) => Promise<void>;
  cancelPasswordRecovery: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function createAppSessionController(): SessionController {
  return createSessionController(api.auth, {
    clearUserData: clearQueryCache,
    setTenantScope: (tenantId) => serviceContext.setTenant(tenantId),
  });
}

/**
 * Owns authentication state for the whole app (mock or Supabase): restores the
 * persisted session on launch, follows backend auth events and exposes the
 * auth actions. All logic lives in the testable session controller.
 */
export function SessionProvider({ children }: PropsWithChildren) {
  const [controller] = useState(createAppSessionController);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [onboarded, setOnboarded] = useState(false);

  // Anyone who has had a session already knows the app: never show onboarding
  // again after sign-out or an expired session.
  if (state.session && !onboarded) setOnboarded(true);

  useEffect(() => controller.start(), [controller]);

  return (
    <SessionContext
      value={{
        status: state.status,
        session: state.session,
        hasOnboarded: onboarded,
        completeOnboarding: () => setOnboarded(true),
        signIn: controller.signIn,
        signUp: controller.signUp,
        signOut: controller.signOut,
        reload: controller.reload,
        requestPasswordReset: (email) => api.auth.requestPasswordReset(email),
        startPasswordRecovery: controller.startPasswordRecovery,
        completePasswordRecovery: controller.completePasswordRecovery,
        cancelPasswordRecovery: controller.cancelPasswordRecovery,
      }}>
      {children}
    </SessionContext>
  );
}

export function useSession() {
  const context = use(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

/** Tenant session (only call from tenant-app screens, which are guarded by status). */
export function useCurrentSession(): TenantSession {
  const { session } = useSession();
  if (session?.kind !== 'tenant') throw new Error('No active tenant session');
  return session;
}

/** Platform admin session (only call from platform-area screens). */
export function usePlatformSession(): PlatformSession {
  const { session } = useSession();
  if (session?.kind !== 'platform') throw new Error('No active platform session');
  return session;
}
