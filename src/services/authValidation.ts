import type { SignUpInput } from '@/types';

import { AppError } from './errors';

/**
 * Account rules shared by the auth screens (instant UX feedback) and the auth
 * services (defence before calling the backend). The database repeats the
 * business-name rule in its trigger/CHECKs; Supabase Auth enforces its own
 * password policy (set its minimum length to 8 to match — see supabase/README.md).
 */
export const AUTH_RULES = {
  nameMin: 2,
  businessNameMin: 2,
  businessNameMax: 80,
  passwordMin: 8,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (email: string) => EMAIL_PATTERN.test(email.trim());

export const isValidBusinessName = (name: string) => {
  const length = name.trim().length;
  return length >= AUTH_RULES.businessNameMin && length <= AUTH_RULES.businessNameMax;
};

export const isValidNewPassword = (password: string) => password.length >= AUTH_RULES.passwordMin;

export type SignUpField = 'name' | 'businessName' | 'email' | 'password' | 'confirmPassword';

/** Field-level messages for the register form. Empty object = valid. */
export function validateSignUpForm(
  input: SignUpInput & { confirmPassword: string }
): Partial<Record<SignUpField, string>> {
  const errors: Partial<Record<SignUpField, string>> = {};
  if (input.name.trim().length < AUTH_RULES.nameMin) errors.name = 'Indique o seu nome.';
  if (!isValidBusinessName(input.businessName)) {
    errors.businessName = `Entre ${AUTH_RULES.businessNameMin} e ${AUTH_RULES.businessNameMax} caracteres.`;
  }
  if (!isValidEmail(input.email)) errors.email = 'Introduza um email válido.';
  if (!isValidNewPassword(input.password)) errors.password = `Mínimo de ${AUTH_RULES.passwordMin} caracteres.`;
  if (input.confirmPassword !== input.password) errors.confirmPassword = 'As palavras-passe não coincidem.';
  return errors;
}

/** Service-side guard (the confirmation is a UI concern and never reaches here). */
export function assertValidSignUp(input: SignUpInput): void {
  if (!isValidBusinessName(input.businessName)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `O nome da loja deve ter entre ${AUTH_RULES.businessNameMin} e ${AUTH_RULES.businessNameMax} caracteres.`,
      { reason: 'INVALID_BUSINESS_NAME' }
    );
  }
  if (!isValidEmail(input.email)) {
    throw new AppError('VALIDATION_ERROR', 'O endereço de email não é válido.', { reason: 'INVALID_EMAIL' });
  }
  if (!isValidNewPassword(input.password)) {
    throw new AppError('VALIDATION_ERROR', `A palavra-passe deve ter pelo menos ${AUTH_RULES.passwordMin} caracteres.`, {
      reason: 'WEAK_PASSWORD',
    });
  }
}

export function assertValidNewPassword(password: string): void {
  if (!isValidNewPassword(password)) {
    throw new AppError('VALIDATION_ERROR', `A palavra-passe deve ter pelo menos ${AUTH_RULES.passwordMin} caracteres.`, {
      reason: 'WEAK_PASSWORD',
    });
  }
}
