/**
 * Database types for the Supabase client, in the format produced by
 * `supabase gen types typescript`. Written by hand for migrations 001–005
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
      payment_accounts: {
        Row: {
          id: string;
          tenant_id: string;
          provider: string;
          account_name: string;
          account_identifier: string;
          status: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        /** Not writable through the API (no grants): use create_payment_account / update_payment_account. */
        Insert: {
          id?: string;
          tenant_id: string;
          provider: string;
          account_name: string;
          account_identifier: string;
          status?: string;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          account_name?: string;
          status?: string;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_accounts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_events: {
        Row: {
          id: string;
          tenant_id: string;
          payment_account_id: string;
          provider: string;
          transaction_id: string;
          amount: number;
          currency: string;
          sender_identifier: string | null;
          recipient_identifier: string | null;
          occurred_at: string;
          received_at: string;
          raw_message: string | null;
          source: string;
          recorded_by: string | null;
          metadata: Json;
          created_at: string;
        };
        /** Immutable; the API records events only through record_payment_event. */
        Insert: {
          id?: string;
          tenant_id?: string;
          payment_account_id: string;
          provider?: string;
          transaction_id: string;
          amount: number;
          currency: string;
          sender_identifier?: string | null;
          recipient_identifier?: string | null;
          occurred_at: string;
          received_at?: string;
          raw_message?: string | null;
          source?: string;
          recorded_by?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_events_payment_account_id_fkey';
            columns: ['payment_account_id'];
            isOneToOne: false;
            referencedRelation: 'payment_accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_proofs: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string | null;
          provider: string | null;
          transaction_id: string | null;
          amount: number | null;
          currency: string | null;
          sender_identifier: string | null;
          recipient_identifier: string | null;
          raw_message: string | null;
          source: string;
          extracted_data: Json;
          status: string;
          status_reason: string | null;
          review_note: string | null;
          submitted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        /** Not writable through the API: submit_payment_proof / reconcile_payment_proof / reject_payment_proof. */
        Insert: {
          id?: string;
          tenant_id: string;
          order_id?: string | null;
          provider?: string | null;
          transaction_id?: string | null;
          amount?: number | null;
          currency?: string | null;
          sender_identifier?: string | null;
          recipient_identifier?: string | null;
          raw_message?: string | null;
          source?: string;
          extracted_data?: Json;
          submitted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          status_reason?: string | null;
          review_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_proofs_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      payment_matches: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          payment_proof_id: string | null;
          payment_event_id: string | null;
          match_status: string;
          match_methods: string[];
          reason: string | null;
          details: Json;
          matched_at: string;
          matched_by: string | null;
          metadata: Json;
          created_at: string;
        };
        /** Written only by the reconciliation functions (append-only). */
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          payment_proof_id?: string | null;
          payment_event_id?: string | null;
          match_status: string;
          match_methods?: string[];
          reason?: string | null;
          details?: Json;
          matched_at?: string;
          matched_by?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_matches_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_matches_payment_event_id_fkey';
            columns: ['payment_event_id'];
            isOneToOne: false;
            referencedRelation: 'payment_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_matches_payment_proof_id_fkey';
            columns: ['payment_proof_id'];
            isOneToOne: false;
            referencedRelation: 'payment_proofs';
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
      create_payment_account: {
        Args: { p_tenant_id: string; p_provider: string; p_account_name: string; p_account_identifier: string };
        Returns: Database['public']['Tables']['payment_accounts']['Row'][];
      };
      update_payment_account: {
        Args: { p_account_id: string; p_account_name?: string; p_status?: string };
        Returns: Database['public']['Tables']['payment_accounts']['Row'][];
      };
      record_payment_event: {
        Args: {
          p_payment_account_id: string;
          p_transaction_id: string;
          p_amount: number;
          p_occurred_at?: string;
          p_currency?: string;
          p_sender_identifier?: string;
          p_recipient_identifier?: string;
          p_raw_message?: string;
        };
        Returns: Database['public']['Tables']['payment_events']['Row'][];
      };
      submit_payment_proof: {
        Args: {
          p_order_id?: string;
          p_provider?: string;
          p_transaction_id?: string;
          p_amount?: number;
          p_currency?: string;
          p_sender_identifier?: string;
          p_recipient_identifier?: string;
          p_raw_message?: string;
          p_extracted_data?: Json;
          p_tenant_id?: string;
        };
        Returns: Database['public']['Tables']['payment_proofs']['Row'][];
      };
      reconcile_payment_proof: {
        Args: { p_proof_id: string };
        Returns: Database['public']['Tables']['payment_proofs']['Row'][];
      };
      reject_payment_proof: {
        Args: { p_proof_id: string; p_reason: string };
        Returns: Database['public']['Tables']['payment_proofs']['Row'][];
      };
      confirm_payment_manually: {
        Args: { p_order_id: string; p_payment_event_id: string; p_payment_proof_id?: string; p_note?: string };
        Returns: Database['public']['Tables']['payment_matches']['Row'][];
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
