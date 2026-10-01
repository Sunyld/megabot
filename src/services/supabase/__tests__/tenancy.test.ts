import { readDisplayName, selectMembership, toSessionUser, toTenant, type MembershipRecord } from '../tenancy';

const settings = { currency: 'MZN', timezone: 'Africa/Maputo', locale: 'pt-MZ' };

const membership = (
  role: string,
  createdAt: string,
  tenant: Partial<NonNullable<MembershipRecord['tenant']>> = {}
): MembershipRecord => ({
  role,
  created_at: createdAt,
  tenant: {
    id: `t-${role}-${createdAt}`,
    name: 'Loja',
    slug: 'loja',
    status: 'active',
    settings,
    ...tenant,
  },
});

describe('selectMembership (Supabase rows → tenant context)', () => {
  it('returns null when the user has no membership', () => {
    expect(selectMembership([])).toBeNull();
  });

  it('maps membership + tenant + settings to the domain context', () => {
    const result = selectMembership([
      membership('owner', '2026-09-01', { id: 'tenant-1', name: 'ByteStore', slug: 'bytestore' }),
    ]);
    expect(result).toEqual({
      role: 'owner',
      tenant: {
        id: 'tenant-1',
        name: 'ByteStore',
        slug: 'bytestore',
        status: 'active',
        plan: null,
        currency: 'MZN',
        timezone: 'Africa/Maputo',
        locale: 'pt-MZ',
      },
    });
  });

  it('prefers the highest role, then the oldest membership', () => {
    const records = [
      membership('operator', '2026-01-01', { id: 'op' }),
      membership('owner', '2026-06-01', { id: 'owner-new' }),
      membership('owner', '2026-03-01', { id: 'owner-old' }),
      membership('admin', '2026-02-01', { id: 'admin' }),
    ];
    expect(selectMembership(records)?.tenant.id).toBe('owner-old');
  });

  it('prefers an active tenant over a suspended one', () => {
    const records = [
      membership('owner', '2026-01-01', { id: 'suspended', status: 'suspended' }),
      membership('operator', '2026-02-01', { id: 'active' }),
    ];
    expect(selectMembership(records)).toMatchObject({ role: 'operator', tenant: { id: 'active' } });
  });

  it('returns the suspended tenant when it is the only one (the app shows the suspended state)', () => {
    expect(selectMembership([membership('owner', '2026-01-01', { status: 'suspended' })])?.tenant.status).toBe(
      'suspended'
    );
  });

  it('ignores unknown roles and rows without a tenant', () => {
    const records: MembershipRecord[] = [
      membership('superuser', '2026-01-01'),
      { role: 'owner', created_at: '2026-01-02', tenant: null },
    ];
    expect(selectMembership(records)).toBeNull();
  });
});

describe('toTenant', () => {
  it('falls back to default settings and fails closed on unknown status', () => {
    expect(toTenant({ id: 'x', name: 'X', slug: 'x', status: 'archived', settings: null })).toMatchObject({
      status: 'suspended',
      currency: 'MZN',
      timezone: 'Africa/Maputo',
      locale: 'pt-MZ',
    });
  });
});

describe('session user', () => {
  it('uses the sign-up name, falling back to the email', () => {
    expect(toSessionUser({ id: 'u1', email: 'ana@loja.co.mz', user_metadata: { name: ' Ana ' } }, 'owner')).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'ana@loja.co.mz',
      phone: '',
      role: 'owner',
    });
    expect(toSessionUser({ id: 'u2', email: 'joao@loja.co.mz', user_metadata: {} }, 'operator').name).toBe('joao');
  });

  it('reads the display name from user metadata', () => {
    expect(readDisplayName({ id: 'u', user_metadata: { name: '  Ana ' } })).toBe('Ana');
    expect(readDisplayName({ id: 'u', user_metadata: { name: 42 } })).toBeNull();
    expect(readDisplayName({ id: 'u', user_metadata: null })).toBeNull();
  });
});
