

# VectraIQ: Empirical ROI Overhaul Plan

## Current State (verified via DB queries)

- **NEUTRAL bug**: Already fixed (line 129: `if (analysis.direction !== filterDirection) return null`)
- **Side markets**: 450 rows exist but ALL have `bet_outcome = NULL` (unsettled)
- **1X2 settlement**: 106 settled as "loss", 25 unsettled, 0 "win" rows -- something is wrong with win detection
- **Missing DB tables**: Migration `20260302120000_betting_edge_phase_system.sql` was written but **never applied** -- tables `coupon_recommendations`, `odds_snapshots`, `team_rates_cache`, `bets_log`, `calibration_buckets` do NOT exist
- **Missing RPC**: `upsert_betting_cal_bucket` does not exist, causing `betting-settle` to crash via `Promise.all`
- **CORNERS_OU / CARDS_OU**: Hard-coded as `void` in settlement (lines 57-59)
- **modelEdge bug**: Already fixed in previous session

## Root Cause: All settlement crashes

The `betting-settle` function calls `supabase.rpc("upsert_betting_cal_bucket", ...)` which doesn't exist. Since it's inside `Promise.all`, the **entire batch fails** -- explaining why we see 0 wins and 450 unsettled side bets.

---

## Implementation Plan (4 phases)

### Phase 1: Database Foundation
**New migration** that creates all missing infrastructure:

```sql
-- 1. Tables: team_rates_cache, calibration_buckets, odds_snapshots, bets_log, coupon_recommendations
--    (content from the failed migration, re-applied)
-- 2. betting_calibration table + upsert_betting_cal_bucket RPC function
-- 3. Stock tables: stock_prediction_outcomes, stock_calibration_buckets
```

Tables to create:
- `team_rates_cache` (match_id PK, home/away rates, p_raw values)
- `calibration_buckets` (market, bucket_idx PK, n_samples, n_hits)
- `odds_snapshots` (match_id, market, selection, odds_open/pre_match, implied probs, overround, TTL)
- `bets_log` (match_id, market, selection, phase, odds, p_raw/p_proxy/p_cal, edge, stake, result, pnl, roi)
- `coupon_recommendations` (match_id, market, selection, phase, implied_prob, p_raw/p_proxy/p_cal, edge, chaos_score, is_valid)
- `betting_calibration` (market, bucket_idx PK, n_bets, n_wins) + RPC `upsert_betting_cal_bucket`
- `stock_prediction_outcomes` (asset_id, horizon, predicted_return, realized_return, predicted_direction, realized_direction)
- `stock_calibration_buckets` (horizon, bucket, count, avg_realized_return, win_rate)

All with RLS (public SELECT, service-role write).

### Phase 2: Fix Settlement (Critical Path)

**File: `supabase/functions/betting-settle/index.ts`**

1. **Remove void for CORNERS_OU / CARDS_OU** -- add Firecrawl-based post-match stats scraping:
   - Scrape match stats page (e.g. `"{home} vs {away} match stats corners cards"` via Firecrawl search)
   - Parse corners total and cards total from scraped content
   - Cache results in `api_cache` with 24h TTL
   - Settle: `CORNERS_OU` with line 9.5, `CARDS_OU` with line 3.5
   - Limit to 5 Firecrawl calls per execution to respect budget

2. **Isolate calibration RPC calls** from main settlement `Promise.all` so a missing RPC doesn't block settlement:
   ```typescript
   // First: settle all predictions
   await Promise.all(settlementUpdates);
   // Then: update calibration (non-blocking)
   try { await Promise.all(calibrationUpdates); } catch(e) { console.warn(e); }
   ```

3. **Limit HT API calls** to max 5 per execution (timeout prevention)

4. **Fix 1X2 win detection** -- the current code compares `outcome === selection` but selection values may not match. Verify the actual `selection` values stored in DB match the settlement logic.

### Phase 3: Edge Functions for Value Betting Pipeline

**File: `supabase/functions/fetch-match-stats/index.ts`** (NEW)
- Firecrawl scrape post-match stats for corners + cards
- Parse and cache in `api_cache` with key `match_stats:{match_id}`
- Called by `betting-settle` when CORNERS_OU or CARDS_OU needs settlement

**File: `supabase/functions/compute_p_raw/index.ts`** (EXISTS but tables missing)
- Already implemented correctly, just needs the `team_rates_cache` table to exist

**File: `supabase/functions/odds_caching/index.ts`** (EXISTS but tables missing)
- Already implemented correctly, just needs the `odds_snapshots` table to exist

**File: `supabase/functions/recommend_bets/index.ts`** (EXISTS but tables missing)
- Already implemented correctly with edge gating + phase thresholds + correlation guardrails
- Just needs `calibration_buckets`, `coupon_recommendations`, `bets_log` tables to exist

### Phase 4: Frontend + UI Updates

**File: `src/pages/BettingPage.tsx`**
- Side markets tab: query `betting_predictions` without filtering `market != '1X2'`
- Show ROI/EV instead of accuracy as primary KPI
- Show per-market calibration stats from `calibration_buckets`
- Show CLV when closing odds available

**File: `src/components/betting/BacktestPanel.tsx`**
- Replace accuracy metrics with ROI, PnL, CLV
- Show per-market breakdown

---

## File Change Summary

| File | Action | Rationale |
|------|--------|-----------|
| Migration SQL | CREATE | Create 8 missing tables + RPC function |
| `betting-settle/index.ts` | EDIT | Fix Promise.all crash, add Firecrawl stats scraping for corners/cards, limit HT calls |
| `fetch-match-stats/index.ts` | CREATE | Firecrawl-based post-match stats (corners, cards) with caching |
| `BettingPage.tsx` | EDIT | Show side markets, ROI metrics, remove 1X2-only filter on predictions |
| `BacktestPanel.tsx` | EDIT | ROI/PnL/CLV metrics instead of accuracy |

## Expected Outcomes
- **Settlement unblocked**: 450+ side market predictions will settle
- **Corners/Cards**: No longer voided, settled via Firecrawl scraping
- **Value betting pipeline**: Fully operational once tables exist (edge functions already written)
- **ROI tracking**: End-to-end from prediction to settlement to calibration

