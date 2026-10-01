import * as Linking from 'expo-linking';

import { getSupabaseClient } from '@/lib/supabase/client';
import { readSupabaseConfig } from '@/lib/supabase/config';

import type { Services } from '../types';
import { createSupabaseAuthService } from './auth';
import { createSupabaseGateway } from './gateway';
import { createSupabasePlatformAdminService } from './platformAdmin';
import { createPlatformAdminGateway } from './platformAdminGateway';
import { createSupabaseProductsService } from './products';
import { createProductsGateway } from './productsGateway';

/**
 * Supabase-backed services, migrated domain by domain. Domains without a
 * Supabase implementation yet keep using `fallback` (the mock services), so
 * the app stays fully usable during the progressive mock → Supabase move.
 *
 * Migrated: auth + tenant context (001), platform administration (002),
 * products with per-product USSD flows (003).
 */
export function createSupabaseServices(fallback: Services): Services {
  try {
    // Startup validation: surface a misconfigured .env immediately in the logs.
    // (Sign-in shows the same message to the user instead of crashing the app.)
    readSupabaseConfig();
  } catch (error) {
    console.error(`[MegaBot] ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ...fallback,
    auth: createSupabaseAuthService(createSupabaseGateway(getSupabaseClient), {
      // megabot://reset-password (dev/prod builds) or exp://…/--/reset-password (Expo Go).
      recoveryRedirectUrl: () => Linking.createURL('reset-password'),
    }),
    products: createSupabaseProductsService(createProductsGateway(getSupabaseClient)),
    platformAdmin: createSupabasePlatformAdminService(createPlatformAdminGateway(getSupabaseClient)),
  };
}
