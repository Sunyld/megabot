import { parseDataSource } from '../dataSource';

describe('parseDataSource', () => {
  it('defaults to mock so the demo keeps working without configuration', () => {
    expect(parseDataSource(undefined)).toBe('mock');
    expect(parseDataSource('')).toBe('mock');
    expect(parseDataSource('mock')).toBe('mock');
  });

  it('accepts supabase (case/whitespace insensitive)', () => {
    expect(parseDataSource('supabase')).toBe('supabase');
    expect(parseDataSource(' Supabase ')).toBe('supabase');
  });

  it('rejects unknown values with a clear message', () => {
    expect(() => parseDataSource('firebase')).toThrow(/EXPO_PUBLIC_DATA_SOURCE inválido/);
  });
});
