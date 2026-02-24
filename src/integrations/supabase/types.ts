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
      alpha_indicators_cache: {
        Row: {
          data: Json
          fetched_at: string
          id: string
          indicator_type: string
          symbol_id: string
          timeframe: string
          valid_until: string
        }
        Insert: {
          data?: Json
          fetched_at?: string
          id?: string
          indicator_type: string
          symbol_id: string
          timeframe?: string
          valid_until?: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          id?: string
          indicator_type?: string
          symbol_id?: string
          timeframe?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "alpha_indicators_cache_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_tracker: {
        Row: {
          category: string
          date_key: string
          id: string
          last_updated: string
          searches_used: number
        }
        Insert: {
          category: string
          date_key: string
          id?: string
          last_updated?: string
          searches_used?: number
        }
        Update: {
          category?: string
          date_key?: string
          id?: string
          last_updated?: string
          searches_used?: number
        }
        Relationships: []
      }
      asset_predictions: {
        Row: {
          baseline_price: number | null
          baseline_ticker: string | null
          confidence: number
          created_at: string
          entry_price: number
          excess_return: number | null
          exit_price: number | null
          hit: boolean | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id: string
          model_version: string | null
          outcome: Database["public"]["Enums"]["signal_direction"] | null
          p_up: number | null
          predicted_direction: Database["public"]["Enums"]["signal_direction"]
          predicted_prob: number | null
          rank_run_id: string | null
          return_pct: number | null
          scored_at: string | null
          symbol_id: string
          total_score: number
          weights_version: string | null
        }
        Insert: {
          baseline_price?: number | null
          baseline_ticker?: string | null
          confidence: number
          created_at?: string
          entry_price: number
          excess_return?: number | null
          exit_price?: number | null
          hit?: boolean | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id?: string
          model_version?: string | null
          outcome?: Database["public"]["Enums"]["signal_direction"] | null
          p_up?: number | null
          predicted_direction: Database["public"]["Enums"]["signal_direction"]
          predicted_prob?: number | null
          rank_run_id?: string | null
          return_pct?: number | null
          scored_at?: string | null
          symbol_id: string
          total_score: number
          weights_version?: string | null
        }
        Update: {
          baseline_price?: number | null
          baseline_ticker?: string | null
          confidence?: number
          created_at?: string
          entry_price?: number
          excess_return?: number | null
          exit_price?: number | null
          hit?: boolean | null
          horizon?: Database["public"]["Enums"]["horizon_type"]
          id?: string
          model_version?: string | null
          outcome?: Database["public"]["Enums"]["signal_direction"] | null
          p_up?: number | null
          predicted_direction?: Database["public"]["Enums"]["signal_direction"]
          predicted_prob?: number | null
          rank_run_id?: string | null
          return_pct?: number | null
          scored_at?: string | null
          symbol_id?: string
          total_score?: number
          weights_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_predictions_rank_run_id_fkey"
            columns: ["rank_run_id"]
            isOneToOne: false
            referencedRelation: "rank_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_predictions_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      betting_matches: {
        Row: {
          away_score: number | null
          away_team: string
          closing_odds_away: number | null
          closing_odds_draw: number | null
          closing_odds_fetched_at: string | null
          closing_odds_home: number | null
          created_at: string
          external_id: string | null
          home_score: number | null
          home_team: string
          id: string
          league: string
          match_date: string
          source_data: Json | null
          sport: string
          status: string
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team: string
          closing_odds_away?: number | null
          closing_odds_draw?: number | null
          closing_odds_fetched_at?: string | null
          closing_odds_home?: number | null
          created_at?: string
          external_id?: string | null
          home_score?: number | null
          home_team: string
          id?: string
          league: string
          match_date: string
          source_data?: Json | null
          sport: string
          status?: string
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team?: string
          closing_odds_away?: number | null
          closing_odds_draw?: number | null
          closing_odds_fetched_at?: string | null
          closing_odds_home?: number | null
          created_at?: string
          external_id?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          league?: string
          match_date?: string
          source_data?: Json | null
          sport?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      betting_predictions: {
        Row: {
          ai_reasoning: string | null
          cap_reason: string | null
          clv: number | null
          confidence_capped: number
          confidence_raw: number
          created_at: string
          id: string
          is_value_bet: boolean | null
          key_factors: Json | null
          market_implied_prob: number | null
          market_odds_away: number | null
          market_odds_draw: number | null
          market_odds_home: number | null
          match_id: string
          model_edge: number | null
          model_version: string
          outcome: string | null
          predicted_prob: number
          predicted_winner: string
          scored_at: string | null
          sources_hash: string | null
          sources_used: Json | null
          suggested_stake_pct: number | null
        }
        Insert: {
          ai_reasoning?: string | null
          cap_reason?: string | null
          clv?: number | null
          confidence_capped: number
          confidence_raw: number
          created_at?: string
          id?: string
          is_value_bet?: boolean | null
          key_factors?: Json | null
          market_implied_prob?: number | null
          market_odds_away?: number | null
          market_odds_draw?: number | null
          market_odds_home?: number | null
          match_id: string
          model_edge?: number | null
          model_version?: string
          outcome?: string | null
          predicted_prob: number
          predicted_winner: string
          scored_at?: string | null
          sources_hash?: string | null
          sources_used?: Json | null
          suggested_stake_pct?: number | null
        }
        Update: {
          ai_reasoning?: string | null
          cap_reason?: string | null
          clv?: number | null
          confidence_capped?: number
          confidence_raw?: number
          created_at?: string
          id?: string
          is_value_bet?: boolean | null
          key_factors?: Json | null
          market_implied_prob?: number | null
          market_odds_away?: number | null
          market_odds_draw?: number | null
          market_odds_home?: number | null
          match_id?: string
          model_edge?: number | null
          model_version?: string
          outcome?: string | null
          predicted_prob?: number
          predicted_winner?: string
          scored_at?: string | null
          sources_hash?: string | null
          sources_used?: Json | null
          suggested_stake_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "betting_predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "betting_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      betting_watchlist: {
        Row: {
          id: string
          match_id: string
          notes: string | null
          prediction_id: string | null
          saved_at: string
          user_id: string
        }
        Insert: {
          id?: string
          match_id: string
          notes?: string | null
          prediction_id?: string | null
          saved_at?: string
          user_id: string
        }
        Update: {
          id?: string
          match_id?: string
          notes?: string | null
          prediction_id?: string | null
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "betting_watchlist_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "betting_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "betting_watchlist_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "betting_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_stats: {
        Row: {
          actual_up_count: number | null
          asset_type: string
          brier_score: number | null
          bucket_center: number
          horizon: string
          id: string
          predicted_count: number | null
          updated_at: string | null
        }
        Insert: {
          actual_up_count?: number | null
          asset_type: string
          brier_score?: number | null
          bucket_center: number
          horizon: string
          id?: string
          predicted_count?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_up_count?: number | null
          asset_type?: string
          brier_score?: number | null
          bucket_center?: number
          horizon?: string
          id?: string
          predicted_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      macro_cache: {
        Row: {
          fetched_at: string
          id: string
          series_key: string
          source_url: string | null
          unit: string | null
          valid_until: string | null
          value: number
        }
        Insert: {
          fetched_at?: string
          id?: string
          series_key: string
          source_url?: string | null
          unit?: string | null
          valid_until?: string | null
          value: number
        }
        Update: {
          fetched_at?: string
          id?: string
          series_key?: string
          source_url?: string | null
          unit?: string | null
          valid_until?: string | null
          value?: number
        }
        Relationships: []
      }
      module_reliability: {
        Row: {
          asset_type: string
          correct_predictions: number
          hit_rate: number | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id: string
          last_updated: string
          module: string
          reliability_weight: number | null
          total_predictions: number
          window_days: number
        }
        Insert: {
          asset_type: string
          correct_predictions?: number
          hit_rate?: number | null
          horizon: Database["public"]["Enums"]["horizon_type"]
          id?: string
          last_updated?: string
          module: string
          reliability_weight?: number | null
          total_predictions?: number
          window_days?: number
        }
        Update: {
          asset_type?: string
          correct_predictions?: number
          hit_rate?: number | null
          horizon?: Database["public"]["Enums"]["horizon_type"]
          id?: string
          last_updated?: string
          module?: string
          reliability_weight?: number | null
          total_predictions?: number
          window_days?: number
        }
        Relationships: []
      }
      news_cache: {
        Row: {
          created_at: string
          description: string | null
          fetched_at: string
          id: string
          published_at: string | null
          sentiment_score: number | null
          source_name: string | null
          ticker: string
          title: string
          url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          published_at?: string | null
          sentiment_score?: number | null
          source_name?: string | null
          ticker: string
          title: string
          url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          fetched_at?: string
          id?: string
          published_at?: string | null
          sentiment_score?: number | null
          source_name?: string | null
          ticker?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      paper_holdings: {
        Row: {
          avg_cost: number
          id: string
          portfolio_id: string
          qty: number
          symbol_id: string
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_cost?: number
          id?: string
          portfolio_id: string
          qty?: number
          symbol_id: string
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_cost?: number
          id?: string
          portfolio_id?: string
          qty?: number
          symbol_id?: string
          ticker?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_holdings_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "paper_portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_holdings_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_portfolio_snapshots: {
        Row: {
          benchmark_return_pct: number | null
          benchmark_value: number | null
          cash_balance: number
          holdings_value: number
          id: string
          pnl_pct: number
          pnl_total: number
          portfolio_id: string
          snapshot_at: string
          total_value: number
          user_id: string
        }
        Insert: {
          benchmark_return_pct?: number | null
          benchmark_value?: number | null
          cash_balance: number
          holdings_value?: number
          id?: string
          pnl_pct?: number
          pnl_total?: number
          portfolio_id: string
          snapshot_at?: string
          total_value: number
          user_id: string
        }
        Update: {
          benchmark_return_pct?: number | null
          benchmark_value?: number | null
          cash_balance?: number
          holdings_value?: number
          id?: string
          pnl_pct?: number
          pnl_total?: number
          portfolio_id?: string
          snapshot_at?: string
          total_value?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_portfolio_snapshots_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "paper_portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_portfolios: {
        Row: {
          base_currency: string
          cash_balance: number
          created_at: string
          id: string
          starting_cash: number
          updated_at: string
          user_id: string
        }
        Insert: {
          base_currency?: string
          cash_balance?: number
          created_at?: string
          id?: string
          starting_cash?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          base_currency?: string
          cash_balance?: number
          created_at?: string
          id?: string
          starting_cash?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          asset_type: string
          executed_at: string
          fee: number
          id: string
          notes: string | null
          notional: number
          portfolio_id: string
          price: number
          qty: number
          side: string
          symbol_id: string
          ticker: string
          user_id: string
        }
        Insert: {
          asset_type: string
          executed_at?: string
          fee?: number
          id?: string
          notes?: string | null
          notional: number
          portfolio_id: string
          price: number
          qty: number
          side: string
          symbol_id: string
          ticker: string
          user_id: string
        }
        Update: {
          asset_type?: string
          executed_at?: string
          fee?: number
          id?: string
          notes?: string | null
          notional?: number
          portfolio_id?: string
          price?: number
          qty?: number
          side?: string
          symbol_id?: string
          ticker?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "paper_portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paper_trades_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          coverage: Json | null
          errors: Json | null
          id: string
          started_at: string
          status: string
          step_results: Json | null
        }
        Insert: {
          completed_at?: string | null
          coverage?: Json | null
          errors?: Json | null
          id?: string
          started_at?: string
          status?: string
          step_results?: Json | null
        }
        Update: {
          completed_at?: string | null
          coverage?: Json | null
          errors?: Json | null
          id?: string
          started_at?: string
          status?: string
          step_results?: Json | null
        }
        Relationships: []
      }
      pool_tickets: {
        Row: {
          budget_sek: number | null
          created_at: string
          id: string
          pool_type: string
          round_id: string
          round_name: string | null
          rows_json: Json
          system_size: number
          user_id: string
        }
        Insert: {
          budget_sek?: number | null
          created_at?: string
          id?: string
          pool_type: string
          round_id: string
          round_name?: string | null
          rows_json?: Json
          system_size?: number
          user_id: string
        }
        Update: {
          budget_sek?: number | null
          created_at?: string
          id?: string
          pool_type?: string
          round_id?: string
          round_name?: string | null
          rows_json?: Json
          system_size?: number
          user_id?: string
        }
        Relationships: []
      }
      portfolio_holdings: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          purchase_date: string
          purchase_price: number
          quantity: number
          symbol_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          purchase_date?: string
          purchase_price: number
          quantity: number
          symbol_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          purchase_date?: string
          purchase_price?: number
          quantity?: number
          symbol_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_holdings_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "symbols"
            referencedColumns: ["id"]
          },
        ]
      }
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
          market_timestamp: string | null
          open_price: number | null
          price: number
          quality_score: number | null
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
          market_timestamp?: string | null
          open_price?: number | null
          price: number
          quality_score?: number | null
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
          market_timestamp?: string | null
          open_price?: number | null
          price?: number
          quality_score?: number | null
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
      signal_snapshots: {
        Row: {
          confidence: number
          created_at: string
          direction: string
          horizon: string
          id: string
          module: string
          prediction_id: string
          strength: number
          symbol_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          direction: string
          horizon: string
          id?: string
          module: string
          prediction_id: string
          strength: number
          symbol_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          direction?: string
          horizon?: string
          id?: string
          module?: string
          prediction_id?: string
          strength?: number
          symbol_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_snapshots_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "asset_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_snapshots_symbol_id_fkey"
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
          baseline_entry_price: number | null
          baseline_exit_price: number | null
          baseline_ticker: string | null
          confidence_at_save: number
          created_at: string
          entry_price: number
          entry_price_source: string
          excess_return: number | null
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
          baseline_entry_price?: number | null
          baseline_exit_price?: number | null
          baseline_ticker?: string | null
          confidence_at_save: number
          created_at?: string
          entry_price: number
          entry_price_source: string
          excess_return?: number | null
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
          baseline_entry_price?: number | null
          baseline_exit_price?: number | null
          baseline_ticker?: string | null
          confidence_at_save?: number
          created_at?: string
          entry_price?: number
          entry_price_source?: string
          excess_return?: number | null
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
      asset_type: "stock" | "crypto" | "metal" | "fund"
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
      asset_type: ["stock", "crypto", "metal", "fund"],
      horizon_type: ["1s", "1m", "1h", "1d", "1w", "1mo", "1y"],
      signal_direction: ["UP", "DOWN", "NEUTRAL"],
    },
  },
} as const
