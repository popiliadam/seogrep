// Generated Supabase database types — DO NOT EDIT BY HAND.
//
// Source of truth: packages/db/supabase/migrations/*.sql, applied to the local Supabase stack.
// Everything below this banner is the byte-for-byte output of:
//
//   node packages/db/scripts/gen-db-types.mjs
//   (which runs `supabase gen types typescript --local --schema public --workdir packages/db`)
//
// Regenerate with that command after every migration. A hand edit here — or a migration that
// lands without a regeneration — is caught by the drift gate:
//
//   node packages/db/scripts/gen-db-types.mjs --check
//
// which guardrails/verify-db.sh runs after it boots the stack and resets it to the committed
// migrations. The gate byte-diffs a fresh generation against this file, so schema drift fails
// the gate instead of production.
//
// ONE thing below is not from the CLI: the `__InternalSupabase.PostgrestVersion` block, which the
// generator splices in (see scripts/gen-db-types.mjs, POSTGREST_VERSION). The CLI stopped emitting
// it and supabase-js reads it to decide which client methods type-check. It is spliced rather than
// hand-edited so that writing and `--check` agree by construction.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.14"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_content_runs: {
        Row: {
          crawl_job_id: string
          created_at: string
          id: string
          project_id: string
          pull_job_id: string
          report: Json
          user_id: string
        }
        Insert: {
          crawl_job_id: string
          created_at?: string
          id?: string
          project_id: string
          pull_job_id: string
          report: Json
          user_id: string
        }
        Update: {
          crawl_job_id?: string
          created_at?: string
          id?: string
          project_id?: string
          pull_job_id?: string
          report?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_content_runs_user_id_crawl_job_id_fkey"
            columns: ["user_id", "crawl_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "audit_content_runs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "audit_content_runs_user_id_pull_job_id_fkey"
            columns: ["user_id", "pull_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          crawl_job_id: string
          created_at: string
          id: string
          project_id: string
          report: Json
          tool: string
          user_id: string
        }
        Insert: {
          crawl_job_id: string
          created_at?: string
          id?: string
          project_id: string
          report: Json
          tool: string
          user_id: string
        }
        Update: {
          crawl_job_id?: string
          created_at?: string
          id?: string
          project_id?: string
          report?: Json
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_user_id_crawl_job_id_fkey"
            columns: ["user_id", "crawl_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "audit_runs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      crawl_pages: {
        Row: {
          canonical: string | null
          created_at: string
          h1s: Json | null
          id: string
          issues: Json | null
          job_id: string
          json_ld_types: Json | null
          kind: string
          links: Json | null
          meta_description: string | null
          project_id: string
          reason: string | null
          robots_meta: string | null
          seq: number
          status: number | null
          title: string | null
          url: string
          user_id: string
          word_count: number | null
        }
        Insert: {
          canonical?: string | null
          created_at?: string
          h1s?: Json | null
          id?: string
          issues?: Json | null
          job_id: string
          json_ld_types?: Json | null
          kind: string
          links?: Json | null
          meta_description?: string | null
          project_id: string
          reason?: string | null
          robots_meta?: string | null
          seq: number
          status?: number | null
          title?: string | null
          url: string
          user_id: string
          word_count?: number | null
        }
        Update: {
          canonical?: string | null
          created_at?: string
          h1s?: Json | null
          id?: string
          issues?: Json | null
          job_id?: string
          json_ld_types?: Json | null
          kind?: string
          links?: Json | null
          meta_description?: string | null
          project_id?: string
          reason?: string | null
          robots_meta?: string | null
          seq?: number
          status?: number | null
          title?: string | null
          url?: string
          user_id?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crawl_pages_user_id_job_id_fkey"
            columns: ["user_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "crawl_pages_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          id: number
          job_id: string | null
          kind: string
          reason: string | null
          reserve_id: string | null
          tool: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: never
          job_id?: string | null
          kind: string
          reason?: string | null
          reserve_id?: string | null
          tool?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: never
          job_id?: string | null
          kind?: string
          reason?: string | null
          reserve_id?: string | null
          tool?: string | null
          user_id?: string
        }
        Relationships: []
      }
      dfs_spend: {
        Row: {
          actual_usd: number | null
          created_at: string
          endpoint: string
          estimated_usd: number
          id: string
          row_count: number | null
          settled_at: string | null
          spend_day: string
          status: string
        }
        Insert: {
          actual_usd?: number | null
          created_at?: string
          endpoint: string
          estimated_usd: number
          id?: string
          row_count?: number | null
          settled_at?: string | null
          spend_day: string
          status?: string
        }
        Update: {
          actual_usd?: number | null
          created_at?: string
          endpoint?: string
          estimated_usd?: number
          id?: string
          row_count?: number | null
          settled_at?: string | null
          spend_day?: string
          status?: string
        }
        Relationships: []
      }
      domain_lookup_runs: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          report: Json
          target: string
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          report: Json
          target: string
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          report?: Json
          target?: string
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_lookup_runs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: number
          kind: string
          meta: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          meta?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          meta?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      gsc_accounts: {
        Row: {
          created_at: string
          encrypted_refresh_token: string
          google_account_email: string
          google_account_sub: string
          id: string
          token_checked_at: string | null
          token_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_refresh_token: string
          google_account_email: string
          google_account_sub: string
          id?: string
          token_checked_at?: string | null
          token_status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_refresh_token?: string
          google_account_email?: string
          google_account_sub?: string
          id?: string
          token_checked_at?: string | null
          token_status?: string
          user_id?: string
        }
        Relationships: []
      }
      gsc_connections: {
        Row: {
          account_id: string | null
          created_at: string
          gsc_property: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          gsc_property?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          gsc_property?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gsc_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_connections_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      gsc_discovery_runs: {
        Row: {
          created_at: string
          id: string
          project_id: string
          pull_job_id: string
          report: Json
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          pull_job_id: string
          report: Json
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          pull_job_id?: string
          report?: Json
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_discovery_runs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "gsc_discovery_runs_user_id_pull_job_id_fkey"
            columns: ["user_id", "pull_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          project_id: string | null
          reserve_id: string | null
          result: Json | null
          started_at: string | null
          status: string
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string | null
          reserve_id?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string | null
          reserve_id?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      keyword_position_measurements: {
        Row: {
          best_rank_absolute: number | null
          best_rank_group: number | null
          created_at: string
          depth_requested: number
          device: string
          domain_match_rule: string
          fetched_at: string
          id: string
          keyword: string
          language_code: string
          location_name: string
          not_measured_reason: string | null
          organic_items_examined: number | null
          project_id: string | null
          report: Json
          search_engine: string
          status: string
          target_domain: string
          user_id: string
          vendor_reported_time_field: string | null
          vendor_reported_time_value: string | null
        }
        Insert: {
          best_rank_absolute?: number | null
          best_rank_group?: number | null
          created_at?: string
          depth_requested: number
          device: string
          domain_match_rule: string
          fetched_at: string
          id?: string
          keyword: string
          language_code: string
          location_name: string
          not_measured_reason?: string | null
          organic_items_examined?: number | null
          project_id?: string | null
          report: Json
          search_engine: string
          status: string
          target_domain: string
          user_id: string
          vendor_reported_time_field?: string | null
          vendor_reported_time_value?: string | null
        }
        Update: {
          best_rank_absolute?: number | null
          best_rank_group?: number | null
          created_at?: string
          depth_requested?: number
          device?: string
          domain_match_rule?: string
          fetched_at?: string
          id?: string
          keyword?: string
          language_code?: string
          location_name?: string
          not_measured_reason?: string | null
          organic_items_examined?: number | null
          project_id?: string | null
          report?: Json
          search_engine?: string
          status?: string
          target_domain?: string
          user_id?: string
          vendor_reported_time_field?: string | null
          vendor_reported_time_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_position_measurements_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      keyword_research_runs: {
        Row: {
          created_at: string
          id: string
          keyword_set: string[]
          report: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword_set: string[]
          report: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword_set?: string[]
          report?: Json
          user_id?: string
        }
        Relationships: []
      }
      paddle_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          payload: Json
          processed_at?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          domain: string
          id: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          domain: string
          id?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          domain?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          html: string | null
          id: string
          job_id: string | null
          public_slug: string | null
          title: string | null
          tool: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          html?: string | null
          id?: string
          job_id?: string | null
          public_slug?: string | null
          title?: string | null
          tool?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          html?: string | null
          id?: string
          job_id?: string | null
          public_slug?: string | null
          title?: string | null
          tool?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_user_id_job_id_fkey"
            columns: ["user_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      subject_lookup_runs: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          report: Json
          subject: string[]
          subject_kind: string
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          report: Json
          subject: string[]
          subject_kind: string
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          report?: Json
          subject?: string[]
          subject_kind?: string
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_lookup_runs_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          occurred_at: string | null
          paddle_subscription_id: string | null
          plan: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          occurred_at?: string | null
          paddle_subscription_id?: string | null
          plan: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          occurred_at?: string | null
          paddle_subscription_id?: string | null
          plan?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      tracked_keywords: {
        Row: {
          created_at: string
          device: string
          id: string
          keyword: string
          language_code: string
          location_name: string
          project_id: string
          untracked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device: string
          id?: string
          keyword: string
          language_code: string
          location_name: string
          project_id: string
          untracked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device?: string
          id?: string
          keyword?: string
          language_code?: string
          location_name?: string
          project_id?: string
          untracked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_keywords_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      trial_claims: {
        Row: {
          collision_count: number
          disposable_domain: boolean
          email_domain: string | null
          email_fingerprint: string
          last_collision_at: string | null
          recorded_at: string
          user_id: string | null
        }
        Insert: {
          collision_count?: number
          disposable_domain?: boolean
          email_domain?: string | null
          email_fingerprint: string
          last_collision_at?: string | null
          recorded_at?: string
          user_id?: string | null
        }
        Update: {
          collision_count?: number
          disposable_domain?: boolean
          email_domain?: string | null
          email_fingerprint?: string
          last_collision_at?: string | null
          recorded_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      users_profile: {
        Row: {
          created_at: string
          id: string
          trial_granted_at: string | null
          welcomed_at: string | null
        }
        Insert: {
          created_at?: string
          id: string
          trial_granted_at?: string | null
          welcomed_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          trial_granted_at?: string | null
          welcomed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      credit_balances: {
        Row: {
          balance: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_subscription_event: {
        Args: {
          p_current_period_end: string
          p_occurred_at: string
          p_paddle_subscription_id: string
          p_plan: string
          p_status: string
          p_user_id: string
        }
        Returns: boolean
      }
      claim_trial: {
        Args: {
          p_amount: number
          p_disposable_domain?: boolean
          p_email_domain?: string
          p_email_fingerprint?: string
          p_user_id: string
        }
        Returns: boolean
      }
      commit_reserve: { Args: { p_reserve_id: string }; Returns: undefined }
      dfs_daily_budget_usd: { Args: never; Returns: number }
      dfs_spend_today_usd: { Args: never; Returns: number }
      process_paddle_purchase: {
        Args: {
          p_amount: number
          p_event_id: string
          p_ref: string
          p_user_id: string
        }
        Returns: boolean
      }
      release_reserve: { Args: { p_reserve_id: string }; Returns: undefined }
      reserve_credits: {
        Args: {
          p_amount: number
          p_job_id: string
          p_tool: string
          p_user_id: string
        }
        Returns: string
      }
      reserve_dfs_spend: {
        Args: { p_endpoint: string; p_estimated_usd: number }
        Returns: string
      }
      settle_dfs_spend: {
        Args: {
          p_actual_usd: number
          p_reservation_id: string
          p_row_count: number
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

