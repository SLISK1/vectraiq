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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      price_history: {
        Row: {
          close_price: number
          created_at: string
          date: string
          high_price: number
          id: string
          low_price: number
          open_price: number
          source: string
          symbol_id: string
          volume: number | null
        }
        Insert: {
          close_price: number
          created_at?: string
          date: string
          high_price: number
          id?: string
          low_price: number
          open_price: number
          source: string
          symbol_id: string
          volume?: number | null
        }
        Update: {
          close_price?: number
          created_at?: string
          date?: string
          high_price?: number
          id?: string
          low_price?: number
          open_price?: number
          source?: string
          symbol_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          settings: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          settings?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          settings?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rank_runs: {
        Row: {
          completed_at: string | null
          config_snapshot: Json | null
          created_at: string
          data_sources_status: Json | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id: string
          total_assets_ranked: number
        }
        Insert: {
          completed_at?: string | null
          config_snapshot?: Json | null
          created_at?: string
          data_sources_status?: Json | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id?: string
          total_assets_ranked?: number
        }
        Update: {
          completed_at?: string | null
          config_snapshot?: Json | null
          created_at?: string
          data_sources_status?: Json | null
          horizon?: Database["public"]["Enums"]["horizon_type"]
          id?: string
          total_assets_ranked?: number
        }
        Relationships: []
      }
      raw_prices: {
        Row: {
          change_24h: number | null
          change_percent_24h: number | null
          created_at: string
          high_price: number | null
          id: string
          low_price: number | null
          market_cap: number | null
          open_price: number | null
          price: number
          recorded_at: string
          source: string
          symbol_id: string
          volume: number | null
        }
        Insert: {
          change_24h?: number | null
          change_percent_24h?: number | null
          created_at?: string
          high_price?: number | null
          id?: string
          low_price?: number | null
          market_cap?: number | null
          open_price?: number | null
          price: number
          recorded_at?: string
          source: string
          symbol_id: string
          volume?: number | null
        }
        Update: {
          change_24h?: number | null
          change_percent_24h?: number | null
          created_at?: string
          high_price?: number | null
          id?: string
          low_price?: number | null
          market_cap?: number | null
          open_price?: number | null
          price?: number
          recorded_at?: string
          source?: string
          symbol_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_prices_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          confidence: number
          coverage: number
          created_at: string
          direction: Database["public"]["Enums"]["signal_direction"]
          evidence: Json | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id: string
          module: string
          rank_run_id: string | null
          strength: number
          symbol_id: string
        }
        Insert: {
          confidence: number
          coverage?: number
          created_at?: string
          direction: Database["public"]["Enums"]["signal_direction"]
          evidence?: Json | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id?: string
          module: string
          rank_run_id?: string | null
          strength: number
          symbol_id: string
        }
        Update: {
          confidence?: number
          coverage?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["signal_direction"]
          evidence?: Json | null
          horizon?: Database["public"]["Enums"]["horizon_type"]
          id?: string
          module?: string
          rank_run_id?: string | null
          strength?: number
          symbol_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      symbols: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          currency: string
          exchange: string | null
          id: string
          is_active: boolean
          metadata: Json | null
          name: string
          sector: string | null
          ticker: string
          updated_at: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency?: string
          exchange?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          name: string
          sector?: string | null
          ticker: string
          updated_at?: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          currency?: string
          exchange?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          name?: string
          sector?: string | null
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      watchlist_cases: {
        Row: {
          confidence_at_save: number
          created_at: string
          entry_price: number
          entry_price_source: string
          exit_price: number | null
          expected_move: number | null
          hit: boolean | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id: string
          model_snapshot_id: string | null
          prediction_direction: Database["public"]["Enums"]["signal_direction"]
          result_locked_at: string | null
          return_pct: number | null
          symbol_id: string
          target_end_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_at_save: number
          created_at?: string
          entry_price: number
          entry_price_source: string
          exit_price?: number | null
          expected_move?: number | null
          hit?: boolean | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id?: string
          model_snapshot_id?: string | null
          prediction_direction: Database["public"]["Enums"]["signal_direction"]
          result_locked_at?: string | null
          return_pct?: number | null
          symbol_id: string
          target_end_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_at_save?: number
          created_at?: string
          entry_price?: number
          entry_price_source?: string
          exit_price?: number | null
          expected_move?: number | null
          hit?: boolean | null
          horizon?: Database["public"]["Enums"]["horizon_type"]
          id?: string
          model_snapshot_id?: string | null
          prediction_direction?: Database["public"]["Enums"]["signal_direction"]
          result_locked_at?: string | null
          return_pct?: number | null
          symbol_id?: string
          target_end_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_cases_model_snapshot_id_fkey"
            columns: ["model_snapshot_id"]
            isOneToOne: false
            referencedRelation: "rank_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchlist_cases_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      asset_type: "stock" | "crypto" | "metal"
      horizon_type: "1s" | "1m" | "1h" | "1d" | "1w" | "1mo" | "1y"
      signal_direction: "UP" | "DOWN" | "NEUTRAL"
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
    Enums: {
      asset_type: ["stock", "crypto", "metal"],
      horizon_type: ["1s", "1m", "1h", "1d", "1w", "1mo", "1y"],
      signal_direction: ["UP", "DOWN", "NEUTRAL"],
    },
  },
} as const
