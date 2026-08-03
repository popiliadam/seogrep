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
      gsc_connections: {
        Row: {
          created_at: string
          encrypted_refresh_token: string | null
          gsc_property: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_refresh_token?: string | null
          gsc_property?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_refresh_token?: string | null
          gsc_property?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_connections_user_id_project_id_fkey"
            columns: ["user_id", "project_id"]
            isOneToOne: true
            referencedRelation: "projects"
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
          created_at: string
          domain: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          user_id: string
        }
        Update: {
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

