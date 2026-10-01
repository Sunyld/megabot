/**
 * Thin adapter between the products service and supabase-js: raw rows in,
 * raw rows / errors out. Every query is scoped to the active tenant; RLS
 * (migration 003) is what actually enforces isolation, roles and the
 * suspended-tenant rule.
 */
import type { Database, MegabotSupabaseClient } from '@/lib/supabase';

type ProductsTable = Database['public']['Tables']['products'];

export type ProductRow = ProductsTable['Row'];
export type ProductInsertRow = ProductsTable['Insert'];
export type ProductUpdateRow = ProductsTable['Update'];

export interface ProductsGateway {
  /** Live products of the tenant, newest first. */
  list(tenantId: string): Promise<ProductRow[]>;
  get(tenantId: string, id: string): Promise<ProductRow | null>;
  insert(row: ProductInsertRow): Promise<ProductRow>;
  /** `null` when no row was visible/updatable (unknown id, other tenant, archived). */
  update(tenantId: string, id: string, patch: ProductUpdateRow): Promise<ProductRow | null>;
}

const PRODUCT_COLUMNS =
  'id, tenant_id, name, description, category, price, currency, data_amount, data_unit, validity_hours, operator, status, ussd_flow, archived_at, created_at, updated_at';

export function createProductsGateway(getClient: () => MegabotSupabaseClient): ProductsGateway {
  return {
    async list(tenantId) {
      const { data, error } = await getClient()
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async get(tenantId, id) {
      const { data, error } = await getClient()
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async insert(row) {
      const { data, error } = await getClient().from('products').insert(row).select(PRODUCT_COLUMNS).single();
      if (error) throw error;
      return data;
    },

    async update(tenantId, id, patch) {
      const { data, error } = await getClient()
        .from('products')
        .update(patch)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select(PRODUCT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
