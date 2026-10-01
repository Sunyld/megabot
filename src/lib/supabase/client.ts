import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { readSupabaseConfig } from './config';
import type { Database } from './database.types';

export type MegabotSupabaseClient = SupabaseClient<Database>;

let client: MegabotSupabaseClient | null = null;

/**
 * The app's single Supabase client, created on first use.
 * Throws a SupabaseConfigError when the public env vars are missing/invalid.
 *
 * Only the public key is used: every query runs as the signed-in user and is
 * constrained by Row Level Security.
 */
export function getSupabaseClient(): MegabotSupabaseClient {
  if (client) return client;

  const { url, anonKey } = readSupabaseConfig();
  const created = createClient<Database>(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  if (Platform.OS !== 'web') {
    // Refresh tokens only while the app is in the foreground (Supabase guidance for RN).
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void created.auth.startAutoRefresh();
      else void created.auth.stopAutoRefresh();
    });
  }

  client = created;
  return created;
}
