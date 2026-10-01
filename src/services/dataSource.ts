/**
 * Which backend the app talks to, from EXPO_PUBLIC_DATA_SOURCE:
 *  • "mock" (default) — demo data, no network.
 *  • "supabase"       — real auth + tenant; not-yet-migrated domains stay mock.
 */
export type DataSource = 'mock' | 'supabase';

export function parseDataSource(value: string | undefined): DataSource {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'mock') return 'mock';
  if (normalized === 'supabase') return 'supabase';
  throw new Error(`EXPO_PUBLIC_DATA_SOURCE inválido: "${value}". Use "mock" ou "supabase".`);
}

export const dataSource: DataSource = parseDataSource(process.env.EXPO_PUBLIC_DATA_SOURCE);
