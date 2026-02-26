
# Fix All Build Errors

## Summary
There are 11+ TypeScript errors across edge functions and frontend components. These are all type-safety issues that can be fixed with targeted changes.

## Changes

### 1. `supabase/functions/betting-settle/index.ts` (line ~216)
**Problem**: `updates.push(supabase.from(...).update(...).eq(...))` pushes a PostgREST builder, not a Promise.
**Fix**: Append `.then()` to convert to a Promise: `updates.push(supabase.from(...).update(...).eq(...).then())`

### 2. `supabase/functions/daily-pipeline/index.ts` (line 137)
**Problem**: `.catch()` doesn't exist on PostgREST builder.
**Fix**: Replace `supabase.rpc('', {}).catch(() => ({ data: null }))` with just `{ data: null }` since it's calling an empty RPC that can never work, and the result isn't used (the comment says "simpler approach" is used instead).

### 3. `supabase/functions/fetch-alpha-indicators/index.ts` (lines 106, 122-124, 138, 151)
**Problem**: `Object.values(rsiData)[0]?.['RSI']` etc. - TS can't index `{}` type.
**Fix**: Cast `Object.values(...)` results to `any[]` (e.g., `(Object.values(rsiData) as any[])[0]?.['RSI']`).

### 4. `supabase/functions/fetch-macro/index.ts` (line 88)
**Problem**: `lastKey` can be `undefined` after `.pop()`.
**Fix**: Add a guard: `if (!lastKey) throw new Error('No observation keys');`

### 5. `supabase/functions/paper-snapshot/index.ts` (line 81)
**Problem**: `err` is of type `unknown`.
**Fix**: Change `err.message` to `(err as Error).message`.

### 6. `supabase/functions/paper-trade/index.ts` (line 262)
**Problem**: Same `err` unknown type.
**Fix**: Change `err.message` to `(err as Error).message`.

### 7. Frontend files (`AssetDetailModal.tsx`, `TopRankingList.tsx`, `BacktestPanel.tsx`, `MatchCard.tsx`)
**Problem**: TypeScript generated types don't include tables/columns (`features`, `calibration_bins`, `rank_results`, `betting_predictions.market`) because migrations haven't been run yet.
**Fix**: Cast queries with `as any` to bypass strict type checking for tables/columns that will exist after migrations run. This is the pragmatic approach since the schema will be updated once migrations are applied.

## Technical Details
- 6 edge function files modified with minimal type fixes
- 4 frontend files modified with `as any` casts on queries referencing not-yet-migrated schema
- No logic changes -- purely type-safety fixes
