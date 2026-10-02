/**
 * Database types for the Supabase client, in the format produced by
 * `supabase gen types typescript`. Written by hand for migrations 001–006
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
      devices: {
        Row: {
          id: string;
          tenant_id: string;
          device_name: string;
          device_identifier: string | null;
          platform: string | null;
          app_version: string | null;
          status: string;
          capabilities: Json;
          telemetry: Json;
          last_seen_at: string | null;
          registered_at: string | null;
          registered_by: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        /** Not writable through the API: create_device / update_device / register_device / device_heartbeat. */
        Insert: {
          id?: string;
          tenant_id: string;
          device_name: string;
          device_identifier?: string | null;
          platform?: string | null;
          app_version?: string | null;
          status?: string;
          capabilities?: Json;
          telemetry?: Json;
          last_seen_at?: string | null;
          registered_at?: string | null;
          registered_by?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'devices_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      device_sims: {
        Row: {
          id: string;
          tenant_id: string;
          device_id: string;
          slot_index: number;
          operator: string;
          phone_number: string | null;
          status: string;
          unavailable_reason: string | null;
          capabilities: Json;
          sim_fingerprint: string | null;
          last_seen_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        /** Not writable through the API: register_device_sim / update_device_sim / device_heartbeat. */
        Insert: {
          id?: string;
          tenant_id?: string;
          device_id: string;
          slot_index: number;
          operator: string;
          phone_number?: string | null;
          status?: string;
          unavailable_reason?: string | null;
          capabilities?: Json;
          sim_fingerprint?: string | null;
          last_seen_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'device_sims_device_id_fkey';
            columns: ['device_id'];
            isOneToOne: false;
            referencedRelation: 'devices';
            referencedColumns: ['id'];
          },
        ];
      };
      activation_tasks: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          product_id: string;
          device_id: string | null;
          sim_id: string | null;
          status: string;
          priority: number;
          operator: string;
          ussd_flow: Json | null;
          flow_version: number;
          attempt_count: number;
          max_attempts: number;
          assigned_at: string | null;
          started_at: string | null;
          submitted_at: string | null;
          completed_at: string | null;
          result_code: string | null;
          result_message: string | null;
          failure_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        /** Created by the database when an order becomes PAID; moved only by the engine's functions. */
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          product_id: string;
          operator: string;
          ussd_flow?: Json | null;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'activation_tasks_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: true;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      activation_task_attempts: {
        Row: {
          id: string;
          tenant_id: string;
          task_id: string;
          sequence: number;
          attempt_number: number;
          device_id: string | null;
          sim_id: string | null;
          slot_index: number | null;
          outcome: string;
          result_code: string;
          retryable: boolean;
          source: string;
          ussd_trace: string | null;
          operator_response: string | null;
          note: string | null;
          decided_by: string | null;
          started_at: string | null;
          finished_at: string;
          created_at: string;
        };
        /** Immutable; written only by the engine. */
        Insert: {
          id?: string;
          tenant_id: string;
          task_id: string;
          sequence: number;
          attempt_number: number;
          outcome: string;
          result_code: string;
          source: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'activation_task_attempts_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'activation_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      activation_task_events: {
        Row: {
          id: string;
          tenant_id: string;
          task_id: string;
          event_type: string;
          from_status: string | null;
          to_status: string;
          device_id: string | null;
          sim_id: string | null;
          actor_user_id: string | null;
          metadata: Json;
          created_at: string;
        };
        /** Append-only; written only by a trigger. */
        Insert: {
          id?: string;
          tenant_id: string;
          task_id: string;
          event_type: string;
          to_status: string;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [
          {
            foreignKeyName: 'activation_task_events_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'activation_tasks';
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
      create_device: {
        Args: { p_tenant_id: string; p_device_name: string };
        Returns: { device_id: string; pairing_code: string; pairing_expires_at: string }[];
      };
      create_device_pairing_code: {
        Args: { p_device_id: string };
        Returns: { device_id: string; pairing_code: string; pairing_expires_at: string }[];
      };
      update_device: {
        Args: { p_device_id: string; p_device_name?: string; p_status?: string };
        Returns: Database['public']['Tables']['devices']['Row'][];
      };
      register_device_sim: {
        Args: { p_device_id: string; p_slot_index: number; p_operator: string; p_phone_number?: string };
        Returns: Database['public']['Tables']['device_sims']['Row'][];
      };
      update_device_sim: {
        Args: { p_sim_id: string; p_operator?: string; p_phone_number?: string; p_status?: string };
        Returns: Database['public']['Tables']['device_sims']['Row'][];
      };
      dispatch_activation_tasks: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      retry_activation_task: {
        Args: { p_task_id: string; p_note?: string };
        Returns: Database['public']['Tables']['activation_tasks']['Row'][];
      };
      resolve_activation_task: {
        Args: { p_task_id: string; p_outcome: string; p_note: string };
        Returns: Database['public']['Tables']['activation_tasks']['Row'][];
      };
      register_device: {
        Args: { p_pairing_code: string; p_device_identifier: string; p_platform: string; p_app_version: string };
        Returns: { device_id: string; device_token: string; device_name: string; tenant_id: string }[];
      };
      device_heartbeat: {
        Args: {
          p_device_id: string;
          p_device_token: string;
          p_app_version?: string;
          p_capabilities?: Json;
          p_telemetry?: Json;
          p_sims?: Json;
        };
        Returns: Json;
      };
      worker_fetch_task: {
        Args: { p_device_id: string; p_device_token: string };
        Returns: Json;
      };
      worker_start_task: {
        Args: { p_device_id: string; p_device_token: string; p_task_id: string };
        Returns: Json;
      };
      worker_report_progress: {
        Args: { p_device_id: string; p_device_token: string; p_task_id: string; p_status: string };
        Returns: Database['public']['Tables']['activation_tasks']['Row'][];
      };
      worker_report_result: {
        Args: {
          p_device_id: string;
          p_device_token: string;
          p_task_id: string;
          p_outcome: string;
          p_result_code: string;
          p_operator_response?: string;
          p_ussd_trace?: string;
        };
        Returns: Database['public']['Tables']['activation_tasks']['Row'][];
      };
      platform_list_tenant_devices: {
        Args: { p_tenant_id: string };
        Returns: Database['public']['Tables']['devices']['Row'][];
      };
      platform_list_tenant_activation_tasks: {
        Args: { p_tenant_id: string; p_limit?: number };
        Returns: Database['public']['Tables']['activation_tasks']['Row'][];
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
