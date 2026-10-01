import { dataSource } from './dataSource';
import { mockServices } from './mock';
import { createSupabaseServices } from './supabase';
import type { Services } from './types';

/**
 * The single place that decides which backend the app talks to, driven by
 * EXPO_PUBLIC_DATA_SOURCE ("mock" by default, or "supabase").
 * Screens and hooks only ever see the `Services` contracts.
 */
export const api: Services = dataSource === 'supabase' ? createSupabaseServices(mockServices) : mockServices;

export { dataSource, type DataSource } from './dataSource';
export * from './context';
export * from './errors';
export { hasPlatformPermission, noPlatformAccess, PLATFORM_RULES } from './platformAdmin';
export * from './realtime';
export type * from './types';
