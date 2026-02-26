

# Apply Two Pending Database Migrations

## Overview
Two migration files already exist in the codebase but have not been executed against the database. Both are idempotent (using `IF NOT EXISTS` / `IF NOT NULL` guards) and non-destructive.

## Migration 1: Multi-market Betting Support
**File**: `supabase/migrations/20260225120000_betting_multimarket.sql`

Adds 6 columns to `betting_predictions`:
- `market` (text, default '1X2')
- `line` (numeric)
- `selection` (text)
- `bet_outcome` (text)
- `actual_value` (numeric)
- `settled_at` (timestamptz)

Plus 2 indexes for match-level queries and settlement lookups.

## Migration 2: Data Architecture (B1)
**File**: `supabase/migrations/20260225130000_b1_data_architecture.sql`

- Extends `signals` with `ts` and computed `direction_num`
- Extends `rank_runs` with `ts`, `weights`, `universe_filter`
- Creates new tables: `price_bars`, `features`, `rank_results`, `predictions`, `outcomes`, `calibration_bins`
- All with RLS enabled and appropriate SELECT policies

## Implementation
1. Run Migration 1 SQL via the database migration tool
2. Run Migration 2 SQL via the database migration tool
3. Verify both applied by checking for new columns/tables

No application code changes needed.

