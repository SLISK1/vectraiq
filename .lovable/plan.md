

# Fix betting-settle Build Errors

## Problem
Two type errors in `supabase/functions/betting-settle/index.ts`:
1. Line 217: `.then()` on a PostgREST builder returns `PromiseLike<unknown>`, not `Promise<unknown>`
2. Line 238: `.rpc()` returns a `PostgrestFilterBuilder`, not `Promise<unknown>`

Both are pushed into `updates: Promise<unknown>[]` (line 194).

## Fix
**Line 194**: Change the type annotation from `Promise<unknown>[]` to `PromiseLike<unknown>[]`.

This single change fixes both errors because:
- `PromiseLike` is the base interface that both `Promise` and PostgREST thenable objects implement
- `Promise.all()` (line 250) already accepts `PromiseLike[]`

## Additionally: SQL update for strategy configs
Run the requested SQL to update existing `strategy_configs` rows with relaxed thresholds (coverage_min=60, agreement_min=60, vol_risk_max=75, max_staleness_h=48).

## No other file changes needed
The user mentioned 4 files changed in a GitHub pull, but `strategy-evaluate`, `normalizeSnapshot`, `StrategyPage`, and `useMarketData` already have the correct values (expectedModules=6, lowered defaults) in the current codebase. Only the betting-settle type error and the SQL data update remain.

