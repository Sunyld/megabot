import { AuthApiError, AuthRetryableFetchError, PostgrestError } from '@supabase/supabase-js';

import { SupabaseConfigError } from '@/lib/supabase/config';

import { AppError } from '../../errors';
import { toAppError } from '../errors';

const postgrest = (code: string, message = 'boom') => new PostgrestError({ code, message, details: '', hint: '' });

describe('toAppError', () => {
  it('keeps AppErrors untouched', () => {
    const original = new AppError('CONFLICT', 'x');
    expect(toAppError(original)).toBe(original);
  });

  it('maps configuration problems to CONFIG_ERROR with the original message', () => {
    const error = toAppError(new SupabaseConfigError('Configuração do Supabase em falta: EXPO_PUBLIC_SUPABASE_URL.'));
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.message).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('maps auth API errors by code', () => {
    expect(toAppError(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')).code).toBe('AUTH_ERROR');
    expect(toAppError(new AuthApiError('User already registered', 422, 'user_already_exists')).code).toBe('CONFLICT');
    expect(toAppError(new AuthApiError('Email address is invalid', 400, 'email_address_invalid')).code).toBe('VALIDATION_ERROR');
    expect(toAppError(new AuthApiError('Database error saving new user', 500, 'unexpected_failure')).code).toBe('DATABASE_ERROR');
  });

  it('explains email confirmation as a project setting, not a user step', () => {
    expect(toAppError(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed')).message).toMatch(/Confirm email/);
  });

  it('maps network failures to NETWORK_ERROR', () => {
    expect(toAppError(new AuthRetryableFetchError('Failed to fetch', 0)).code).toBe('NETWORK_ERROR');
    expect(toAppError(new TypeError('Network request failed')).code).toBe('NETWORK_ERROR');
    expect(toAppError(postgrest('', 'TypeError: Network request failed')).code).toBe('NETWORK_ERROR');
  });

  it('maps PostgREST errors by SQLSTATE / PGRST code', () => {
    expect(toAppError(postgrest('42501')).code).toBe('PERMISSION_DENIED');
    expect(toAppError(postgrest('PGRST116')).code).toBe('NOT_FOUND');
    expect(toAppError(postgrest('P0002')).code).toBe('NOT_FOUND');
    expect(toAppError(postgrest('23505')).code).toBe('CONFLICT');
    expect(toAppError(postgrest('55000')).code).toBe('CONFLICT');
    expect(toAppError(postgrest('23514')).code).toBe('VALIDATION_ERROR');
    expect(toAppError(postgrest('PGRST301')).code).toBe('AUTH_ERROR');
    expect(toAppError(postgrest('XX000')).code).toBe('DATABASE_ERROR');
  });

  it('shows the user-facing message raised by our SQL functions', () => {
    const error = toAppError(postgrest('22023', 'O nome da empresa deve ter entre 2 e 80 caracteres'));
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'O nome da empresa deve ter entre 2 e 80 caracteres' });
  });

  it('points to the migrations when tables are missing', () => {
    expect(toAppError(postgrest('PGRST205')).message).toMatch(/supabase\/migrations/);
    expect(toAppError(postgrest('42P01')).code).toBe('DATABASE_ERROR');
  });

  it('treats a server failure during sign-up as tenant provisioning failure', () => {
    const raw = new AuthApiError('Database error saving new user', 500, 'unexpected_failure');
    expect(toAppError(raw, 'sign_up')).toMatchObject({ code: 'DATABASE_ERROR', reason: 'TENANT_PROVISIONING_ERROR' });
    expect(toAppError(raw, 'sign_in').reason).toBeUndefined();
  });

  it('never shows Supabase technical text to the user (kept in detail)', () => {
    const error = toAppError(new AuthApiError('User already registered', 422, 'user_already_exists'), 'sign_up');
    expect(error).toMatchObject({ reason: 'EMAIL_ALREADY_REGISTERED', detail: 'User already registered' });
    expect(error.message).not.toContain('User already registered');
  });

  it('maps rate limits', () => {
    expect(toAppError(new AuthApiError('rate limit', 429, 'over_request_rate_limit')).reason).toBe('AUTH_RATE_LIMIT');
  });

  it('falls back to UNKNOWN_ERROR', () => {
    expect(toAppError('weird').code).toBe('UNKNOWN_ERROR');
  });
});
