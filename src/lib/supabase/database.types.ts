/**
 * Database types for the Supabase client, in the format produced by
 * `supabase gen types typescript`. Written by hand for migrations 001–004
 * because the database is not reachable from this environment — regenerate
 * once the CLI/MCP is available and keep in sync with supabase/migrations.
 *
 * Text columns constrained by CHECKs are typed as `string` (as the generator
 * does); services narrow them when mapping to domain types.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Row returned by the platform_* tenant RPCs (private.tenant_overview, migration 002). */
type PlatformTenantOverviewRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
  /** From tenant_settings (left join): null only if a tenant has no settings row. */
  currency: string | null;
  timezone: string | null;
  locale: string | null;
  member_count: number;
  owner_count: number;
  admin_count: number;
  operator_count: number;
};

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_users: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          role?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_users_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_settings: {
        Row: {
          tenant_id: string;
          currency: string;
          timezone: string;
          locale: string;
          payments: Json;
          whatsapp: Json;
          automation: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          currency?: string;
          timezone?: string;
          locale?: string;
          payments?: Json;
          whatsapp?: Json;
          automation?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          currency?: string;
          timezone?: string;
          locale?: string;
          payments?: Json;
          whatsapp?: Json;
          automation?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_admins: {
        Row: {
          id: string;
          user_id: string;
          role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          category: string;
          /** numeric(12,2) — serialized as a JSON number by PostgREST. */
          price: number;
          currency: string;
          data_amount: number | null;
          data_unit: string | null;
          validity_hours: number;
          operator: string;
          status: string;
          ussd_flow: Json | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          category: string;
          price: number;
          /** Defaults to the tenant's currency (trigger) when omitted. */
          currency?: string;
          data_amount?: number | null;
          data_unit?: string | null;
          validity_hours: number;
          operator: string;
          status?: string;
          ussd_flow?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          description?: string | null;
          category?: string;
          price?: number;
          currency?: string;
          data_amount?: number | null;
          data_unit?: string | null;
          validity_hours?: number;
          operator?: string;
          status?: string;
          ussd_flow?: Json | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          public_reference: string;
          customer_name: string | null;
          customer_phone: string;
          product_name_snapshot: string;
          product_price_snapshot: number;
          currency_snapshot: string;
          data_amount_snapshot: number | null;
          data_unit_snapshot: string | null;
          validity_hours_snapshot: number;
          operator_snapshot: string;
          status: string;
          status_changed_at: string;
          cancel_reason: string | null;
          idempotency_key: string | null;
          created_at: string;
          updated_at: string;
        };
        /** Not writable through the API (no grants): use the create_order / cancel_order… RPCs. */
        Insert: {
          id?: string;
          tenant_id: string;
          product_id: string;
          public_reference?: string;
          customer_name?: string | null;
          customer_phone: string;
          product_name_snapshot?: string;
          product_price_snapshot?: number;
          currency_snapshot?: string;
          data_amount_snapshot?: number | null;
          data_unit_snapshot?: string | null;
          validity_hours_snapshot?: number;
          operator_snapshot?: string;
          status?: string;
          status_changed_at?: string;
          cancel_reason?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          cancel_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      order_events: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          event_type: string;
          actor_user_id: string | null;
          from_status: string | null;
          to_status: string;
          metadata: Json;
          created_at: string;
        };
        /** Written only by the database (triggers). */
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          event_type: string;
          actor_user_id?: string | null;
          from_status?: string | null;
          to_status: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'order_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_user_id: string | null;
          tenant_id: string | null;
          action: string;
          resource_type: string;
          resource_id: string | null;
          metadata: Json;
          /** `inet` — the generator types it as unknown; arrives as a string. */
          ip_address: unknown;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_user_id?: string | null;
          tenant_id?: string | null;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          metadata?: Json;
          ip_address?: unknown;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_user_id?: string | null;
          tenant_id?: string | null;
          action?: string;
          resource_type?: string;
          resource_id?: string | null;
          metadata?: Json;
          ip_address?: unknown;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_tenant: {
        Args: { p_name: string };
        Returns: string;
      };
      platform_admin_context: {
        Args: never;
        Returns: { role: string; status: string; permissions: string[] }[];
      };
      platform_list_tenants: {
        Args: { p_status?: string; p_search?: string; p_limit?: number; p_offset?: number };
        Returns: PlatformTenantOverviewRow[];
      };
      platform_get_tenant: {
        Args: { p_tenant_id: string };
        Returns: PlatformTenantOverviewRow[];
      };
      platform_set_tenant_status: {
        Args: { p_tenant_id: string; p_status: string; p_reason?: string };
        Returns: PlatformTenantOverviewRow[];
      };
      platform_list_tenant_products: {
        Args: { p_tenant_id: string };
        Returns: Database['public']['Tables']['products']['Row'][];
      };
      create_order: {
        Args: { p_product_id: string; p_customer_phone: string; p_customer_name?: string; p_idempotency_key?: string };
        Returns: Database['public']['Tables']['orders']['Row'][];
      };
      mark_order_awaiting_payment: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'][];
      };
      cancel_order: {
        Args: { p_order_id: string; p_reason?: string };
        Returns: Database['public']['Tables']['orders']['Row'][];
      };
      order_status_counts: {
        Args: { p_tenant_id: string };
        Returns: { status: string; total: number }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
