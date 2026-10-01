import { buildSignUpPayload, parseRecoveryUrl } from '../gateway';

describe('buildSignUpPayload', () => {
  it('sends business_name in options.data so the database trigger can provision the tenant', () => {
    const payload = buildSignUpPayload({
      name: '  Ana Langa ',
      businessName: '  MegaBot Test ',
      email: ' ana@megabot.test ',
      password: 'segredo123',
    });
    expect(payload).toEqual({
      email: 'ana@megabot.test',
      password: 'segredo123',
      options: { data: { name: 'Ana Langa', business_name: 'MegaBot Test' } },
    });
  });

  it('never includes tenant fields or a password confirmation', () => {
    const payload = buildSignUpPayload({ name: 'Ana', businessName: 'Loja', email: 'a@b.co', password: 'segredo123' });
    expect(Object.keys(payload).sort()).toEqual(['email', 'options', 'password']);
    expect(Object.keys(payload.options.data).sort()).toEqual(['business_name', 'name']);
    expect(JSON.stringify(payload)).not.toMatch(/tenant|role|confirm/i);
  });
});

describe('parseRecoveryUrl', () => {
  it('reads tokens from the fragment (implicit flow)', () => {
    expect(
      parseRecoveryUrl('megabot://reset-password#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery')
    ).toEqual({ kind: 'tokens', accessToken: 'abc', refreshToken: 'def' });
  });

  it('reads tokens from Expo Go URLs too', () => {
    expect(parseRecoveryUrl('exp://192.168.1.5:8081/--/reset-password#access_token=a&refresh_token=b')).toEqual({
      kind: 'tokens',
      accessToken: 'a',
      refreshToken: 'b',
    });
  });

  it('reads a PKCE code from the query string', () => {
    expect(parseRecoveryUrl('megabot://reset-password?code=xyz')).toEqual({ kind: 'code', code: 'xyz' });
  });

  it('reports errors sent by Supabase (e.g. expired link)', () => {
    expect(
      parseRecoveryUrl('megabot://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
    ).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid' });
  });

  it('returns none without recovery parameters', () => {
    expect(parseRecoveryUrl('megabot://reset-password')).toEqual({ kind: 'none' });
    expect(parseRecoveryUrl('megabot://reset-password#access_token=only-access')).toEqual({ kind: 'none' });
  });
});
