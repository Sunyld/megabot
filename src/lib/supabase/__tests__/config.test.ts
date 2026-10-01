import { isSecretKey, parseSupabaseConfig, SupabaseConfigError } from '../config';

const URL = 'https://abcdefghijklmnop.supabase.co';
const PUBLISHABLE = 'sb_publishable_test_key_123';

/** Unsigned JWT with the given role — enough to exercise the role check. */
const jwtWithRole = (role: string) =>
  ['e30', btoa(JSON.stringify({ role, iss: 'supabase' })).replace(/=+$/, ''), 'signature'].join('.');

describe('parseSupabaseConfig', () => {
  it('accepts a project URL and a publishable key', () => {
    expect(parseSupabaseConfig({ url: URL, anonKey: PUBLISHABLE })).toEqual({ url: URL, anonKey: PUBLISHABLE });
  });

  it('accepts a legacy anon JWT', () => {
    const anon = jwtWithRole('anon');
    expect(parseSupabaseConfig({ url: URL, anonKey: anon }).anonKey).toBe(anon);
  });

  it('trims values and drops a trailing slash', () => {
    expect(parseSupabaseConfig({ url: `  ${URL}/ `, anonKey: ` ${PUBLISHABLE} ` })).toEqual({
      url: URL,
      anonKey: PUBLISHABLE,
    });
  });

  it('accepts local development URLs', () => {
    expect(parseSupabaseConfig({ url: 'http://127.0.0.1:54321', anonKey: PUBLISHABLE }).url).toBe('http://127.0.0.1:54321');
  });

  it('reports a missing URL by variable name', () => {
    expect(() => parseSupabaseConfig({ anonKey: PUBLISHABLE })).toThrow(SupabaseConfigError);
    expect(() => parseSupabaseConfig({ anonKey: PUBLISHABLE })).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('reports a missing key by variable name, including the Dashboard alternative', () => {
    expect(() => parseSupabaseConfig({ url: URL, anonKey: '   ' })).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => parseSupabaseConfig({ url: URL })).toThrow(/EXPO_PUBLIC_SUPABASE_KEY/);
  });

  it('reports both variables when both are missing', () => {
    expect(() => parseSupabaseConfig({})).toThrow(/EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('rejects malformed or insecure URLs', () => {
    expect(() => parseSupabaseConfig({ url: 'ssykspkfbblrwgixtast', anonKey: PUBLISHABLE })).toThrow(/inválido/);
    expect(() => parseSupabaseConfig({ url: 'http://example.supabase.co', anonKey: PUBLISHABLE })).toThrow(/inválido/);
  });

  it('refuses secret keys in the app', () => {
    expect(() => parseSupabaseConfig({ url: URL, anonKey: 'sb_secret_abc' })).toThrow(/chave secreta/);
    expect(() => parseSupabaseConfig({ url: URL, anonKey: jwtWithRole('service_role') })).toThrow(/chave secreta/);
  });
});

describe('isSecretKey', () => {
  it('distinguishes public from secret keys', () => {
    expect(isSecretKey(PUBLISHABLE)).toBe(false);
    expect(isSecretKey(jwtWithRole('anon'))).toBe(false);
    expect(isSecretKey('not.a.jwt')).toBe(false);
    expect(isSecretKey('sb_secret_x')).toBe(true);
    expect(isSecretKey(jwtWithRole('service_role'))).toBe(true);
  });
});
