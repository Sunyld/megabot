import * as Linking from 'expo-linking';

import { getSupabaseClient } from '@/lib/supabase/client';
import { readSupabaseConfig } from '@/lib/supabase/config';

import { stopServingDemoData } from '../mock/db';
import type { Services } from '../types';
import { createSupabaseAuthService } from './auth';
import { createSupabaseGateway } from './gateway';
import { createSupabaseOrdersService } from './orders';
import { createOrdersGateway } from './ordersGateway';
import { createSupabasePaymentServices } from './payments';
import { createPaymentsGateway } from './paymentsGateway';
import { createSupabasePlatformAdminService } from './platformAdmin';
import { createPlatformAdminGateway } from './platformAdminGateway';
import { createSupabaseProductsService } from './products';
import { createProductsGateway } from './productsGateway';

/**
 * Supabase-backed services, migrated domain by domain. Domains without a
 * Supabase implementation yet keep using `fallback` (the mock services), so
 * the app stays fully usable during the progressive mock → Supabase move.
 *
 * Migrated: auth + app context (001/002), platform administration (002),
 * products with per-product USSD flows (003), orders (004), payments —
 * accounts, real events, customer proofs and deterministic reconciliation (005).
 */
export function createSupabaseServices(fallback: Services): Services {
  // Domains still on the fallback show the real tenant's (empty) data, never demo fixtures.
  stopServingDemoData();

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
    orders: createSupabaseOrdersService(createOrdersGateway(getSupabaseClient)),
    ...createSupabasePaymentServices(createPaymentsGateway(getSupabaseClient)),
    platformAdmin: createSupabasePlatformAdminService(createPlatformAdminGateway(getSupabaseClient)),
  };
}
