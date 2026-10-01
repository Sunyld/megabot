import { createMockPlatformSession, createMockSession, DEMO_CREDENTIALS, DEMO_PLATFORM_CREDENTIALS } from '@/mocks';

import { assertValidNewPassword, assertValidSignUp, isValidEmail } from '../authValidation';
import { AppError } from '../errors';
import type { AuthService } from '../types';
import { simulationStore } from './simulation';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const assertOnline = () => {
  if (simulationStore.get().offline) {
    throw new AppError('NETWORK_ERROR', 'Sem ligação à internet. Verifique a sua rede.');
  }
};

export const mockAuthService: AuthService = {
  async signIn({ email, password }) {
    await sleep(900);
    assertOnline();
    const normalized = email.trim().toLowerCase();
    if (normalized === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
      return createMockSession();
    }
    if (normalized === DEMO_PLATFORM_CREDENTIALS.email && password === DEMO_PLATFORM_CREDENTIALS.password) {
      return createMockPlatformSession();
    }
    throw new AppError('AUTH_ERROR', 'Email ou palavra-passe incorretos.', { reason: 'INVALID_CREDENTIALS' });
  },

  async signUp(input) {
    assertValidSignUp(input);
    await sleep(1100);
    assertOnline();
    // Demo mode: nothing is stored; the demo data is shown under the typed names.
    return createMockSession({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      businessName: input.businessName.trim(),
    });
  },

  async signOut() {
    await sleep(300);
  },

  async restore() {
    // Demo sessions are not persisted (Supabase mode persists them).
    await sleep(700);
    return null;
  },

  onAuthEvent() {
    // Mock sessions never change on their own.
    return () => {};
  },

  async requestPasswordReset(email) {
    if (!isValidEmail(email)) {
      throw new AppError('VALIDATION_ERROR', 'O endereço de email não é válido.', { reason: 'INVALID_EMAIL' });
    }
    await sleep(600);
    assertOnline();
  },

  async startPasswordRecovery() {
    throw new AppError('AUTH_ERROR', 'A recuperação por email só está disponível no modo Supabase.', {
      reason: 'RECOVERY_LINK_INVALID',
    });
  },

  async updatePassword(newPassword) {
    assertValidNewPassword(newPassword);
    await sleep(600);
    assertOnline();
  },

  getDemoCredentials() {
    return { tenant: DEMO_CREDENTIALS, platform: DEMO_PLATFORM_CREDENTIALS };
  },
};
