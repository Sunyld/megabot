/**
 * Supabase configuration for the mobile app. Only PUBLIC values are allowed
 * here: EXPO_PUBLIC_* variables are embedded in the app bundle.
 */

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseEnv = {
  url?: string;
  anonKey?: string;
};

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

const URL_PATTERN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\/?$/i;
// Local development stacks (supabase start / Android emulator host).
const LOCAL_URL_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?\/?$/i;

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string') {
      return payload.role;
    }
    return null;
  } catch {
    return null;
  }
}

/** True for keys that must never ship in a client: new secret keys or a service_role JWT. */
export function isSecretKey(key: string): boolean {
  return key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role';
}

/** Validates the public Supabase settings; throws a SupabaseConfigError with a clear message. */
export function parseSupabaseConfig(env: SupabaseEnv): SupabaseConfig {
  const url = env.url?.trim() ?? '';
  const anonKey = env.anonKey?.trim() ?? '';

  const missing = [
    !url && 'EXPO_PUBLIC_SUPABASE_URL',
    !anonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY (ou EXPO_PUBLIC_SUPABASE_KEY)',
  ].filter(Boolean);
  if (missing.length) {
    throw new SupabaseConfigError(
      `Configuração do Supabase em falta: ${missing.join(', ')}. Copie .env.example para .env, preencha e reinicie o Expo.`
    );
  }

  if (!URL_PATTERN.test(url) && !LOCAL_URL_PATTERN.test(url)) {
    throw new SupabaseConfigError(
      `EXPO_PUBLIC_SUPABASE_URL inválido ("${url}"). Use o URL do projeto, por exemplo https://<ref>.supabase.co.`
    );
  }

  if (isSecretKey(anonKey)) {
    throw new SupabaseConfigError(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY contém uma chave secreta (service_role / sb_secret). Use a publishable key ou a anon key — segredos nunca podem ir para o app.'
    );
  }

  return { url: url.replace(/\/$/, ''), anonKey };
}

/**
 * Reads the configuration from Expo's public env vars.
 * (Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so they must be
 * referenced literally, as below.)
 *
 * The public key is accepted under either name: EXPO_PUBLIC_SUPABASE_ANON_KEY
 * (project convention) or EXPO_PUBLIC_SUPABASE_KEY (Supabase Dashboard snippet).
 */
export function readSupabaseConfig(): SupabaseConfig {
  return parseSupabaseConfig({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY,
  });
}
