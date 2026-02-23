

# Remaining Implementation: Fas 1-3 Gap Analysis and Completion

## Current State

After reviewing all files, Fas 1 (A-E, G) and Fas 2 (F, H, I, J) are **already implemented in the frontend/engine.ts** from the previous round. However, there are critical gaps where the **server-side edge functions were NOT updated to match**, plus Fas 3 items (K, L, M, N) are untouched.

## Gap Analysis: What Still Needs Fixing

### GAP 1: `generate-signals` scoring is INCONSISTENT with `engine.ts` (Critical)

**Lines 402-407** still use the OLD scoring logic:
```
// OLD (broken): vote-based direction + average strength
const overallDir = bullish.length > bearish.length ? 'UP' : ...
const totalScore = Math.round(weightedSignals.reduce(sum + s.strength) / length)
```

This means the **server-side predictions** saved to `asset_predictions` use a completely different formula than the frontend engine. The self-learning loop (`score-predictions`) evaluates these server predictions, so the reliability weights being learned are calibrated against the OLD formula -- not the new signed scoring.

**Fix:** Port the signed scoring formula from `engine.ts` into `generate-signals`:
- `signedStrength = (strength - 50) * 2 * dirMultiplier`
- `totalSignedScore = sum of weighted signed contributions`
- `normalizedScore = 50 + totalSignedScore / 2`
- `direction from totalSignedScore with +/-5 dead-zone`
- `predicted_prob` based on signed score magnitude, not vote count

### GAP 2: `generate-signals` weight renormalization missing (Critical)

**Lines 374-382** multiply `strength * rw` and `confidence * rw` but do NOT renormalize weights across modules. The total weight sum can drift to 70 or 130 instead of 100, making scores incomparable across symbols.

**Fix:** After applying Bayesian reliability factors, renormalize so weights sum to 100 before computing aggregate score.

### GAP 3: Duplicate/dead reliability code in `generate-signals`

Lines 270-278 build `reliabilityMap` (old, unused). Lines 281-298 build `reliabilityDataMap` with Bayesian logic. The old `reliabilityMap` is dead code.

**Fix:** Remove old `reliabilityMap` block.

### GAP 4: `calculateObjectiveCoverage` (F) defined but never called

The utility exists in `engine.ts` (line 340-386) but no module actually uses it. Modules still self-report their own coverage.

**Fix:** Wire `calculateObjectiveCoverage` into `runAnalysis` by overriding each module result's coverage with the objective calculation.

### GAP 5: Missing unit tests for B and E

- B: No test that `score=50 => returns ~0`
- E: No test that weights sum to exactly 100 after renormalization

### GAP 6: `ai-analysis` missing 'fund' type, validation, sanitization (N, P)

- Line 12: `assetType: 'stock' | 'crypto' | 'metal'` -- no `'fund'`
- Lines 457-468: Regex JSON parse with no schema validation
- Firecrawl content (line 84) is passed raw -- no HTML stripping

### GAP 7: No DB migrations for K and M

- `asset_predictions` needs `p_up`, `weights_version`, `model_version` columns
- `calibration_stats` table doesn't exist
- `raw_prices` needs `quality_score`, `market_timestamp` columns

---

## Implementation Plan

### PR 1: Server-side scoring alignment + cleanup

**Files changed:**

| File | Change | Why |
|------|--------|-----|
| `supabase/functions/generate-signals/index.ts` | Signed scoring in prediction save, weight renormalization, dead code removal | GAP 1, 2, 3 |
| `src/lib/analysis/engine.ts` | Wire `calculateObjectiveCoverage` into `runAnalysis` | GAP 4 |
| `src/test/scoring-pipeline.test.ts` | Add tests for B (returns) and E (weight sum) | GAP 5 |

**Details for `generate-signals/index.ts`:**

1. Remove dead `reliabilityMap` (lines 270-278) -- only keep `reliabilityDataMap` and `getReliabilityWeight`

2. Add weight renormalization in the signal processing loop (after line 382):
```
// After reliability weighting, renormalize
const totalRw = weightedSignals.reduce((s, sig) => s + rw_for_sig, 0);
const normFactor = totalRw > 0 ? signals.length / totalRw : 1;
// Apply normFactor to each signal's effective weight
```

3. Replace lines 402-416 (prediction save) with signed scoring:
```
// Signed scoring (matching engine.ts)
const signedScores = weightedSignals.map(s => {
  const dir = s.direction === 'UP' ? 1 : s.direction === 'DOWN' ? -1 : 0;
  return (s.strength - 50) * 2 * dir;
});
const totalSignedScore = signedScores.reduce((a, b) => a + b, 0) / weightedSignals.length;
const normalizedScore = Math.round(50 + totalSignedScore / 2);
const overallDir = totalSignedScore > 5 ? 'UP' : totalSignedScore < -5 ? 'DOWN' : 'NEUTRAL';
const p_up = Math.max(0, Math.min(1, 0.5 + totalSignedScore / 200));
```

4. Include `p_up` in the insert (requires DB migration first, so initially skip or use existing columns)

**Details for `engine.ts` (F integration):**

After each module runs and returns its `AnalysisResult`, override its `coverage` field:
```typescript
const results = rawResults.map(r => ({
  ...r,
  coverage: calculateObjectiveCoverage(priceHistory, horizon, r.module),
}));
```

**New tests:**
```typescript
test('score=50 => predicted returns ~0', () => { ... });
test('weights sum to ~100 after renormalization', () => { ... });
```

### PR 2: AI analysis hardening (N, P)

**Files changed:**

| File | Change | Why |
|------|--------|-----|
| `supabase/functions/ai-analysis/index.ts` | Add 'fund' type, HTML sanitization, basic response validation, logging | GAP 6 |

**Details:**

1. Line 12: Add `'fund'` to assetType union
2. Add HTML strip function for Firecrawl content:
```typescript
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
```
3. Apply to Firecrawl snippets (line 84): `const content = stripHtml((r.markdown || r.description || '')).substring(0, 800);`
4. Add basic response validation after JSON parse (line 461):
```typescript
// Validate required fields
if (!analysisResult.direction || !['UP','DOWN','NEUTRAL'].includes(analysisResult.direction)) {
  analysisResult.direction = 'NEUTRAL';
}
analysisResult.strength = Math.max(0, Math.min(100, Number(analysisResult.strength) || 50));
analysisResult.confidence = Math.max(0, Math.min(100, Number(analysisResult.confidence) || 40));
```
5. Add logging after AI call:
```typescript
console.log(`ai-analysis: model=${model}, type=${type}, ticker=${ticker}, tokens=${aiResponse.usage?.total_tokens || 'N/A'}`);
```
6. Low confidence cap when no news/data (already partially there in sentiment prompt, but enforce programmatically):
```typescript
if (type === 'sentiment' && !hasRealNews && !hasFirecrawl) {
  analysisResult.confidence = Math.min(analysisResult.confidence, 45);
  analysisResult.evidence = [...(analysisResult.evidence || []), 
    { type: 'warning', description: 'Inga nyheter/analyser tillgangliga', value: 'low_data', source: 'System' }];
}
```

### PR 3: DB migrations + calibration infrastructure (K, M)

**DB Migration 1 (K):**
```sql
ALTER TABLE asset_predictions 
  ADD COLUMN IF NOT EXISTS p_up numeric,
  ADD COLUMN IF NOT EXISTS weights_version text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS model_version text DEFAULT '1.0';

CREATE TABLE IF NOT EXISTS calibration_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horizon text NOT NULL,
  asset_type text NOT NULL,
  bucket_center numeric NOT NULL,
  predicted_count integer DEFAULT 0,
  actual_up_count integer DEFAULT 0,
  brier_score numeric,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(horizon, asset_type, bucket_center)
);
ALTER TABLE calibration_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calibration_stats_select_all" ON calibration_stats
  FOR SELECT USING (true);
CREATE POLICY "calibration_stats_deny_insert" ON calibration_stats
  FOR INSERT WITH CHECK (false);
CREATE POLICY "calibration_stats_deny_update" ON calibration_stats
  FOR UPDATE USING (false);
CREATE POLICY "calibration_stats_deny_delete" ON calibration_stats
  FOR DELETE USING (false);
```

**DB Migration 2 (M):**
```sql
ALTER TABLE raw_prices 
  ADD COLUMN IF NOT EXISTS quality_score smallint DEFAULT 100,
  ADD COLUMN IF NOT EXISTS market_timestamp timestamptz;
```

**After migrations:** Update `generate-signals` to include `p_up`, `weights_version`, and `model_version` in the `asset_predictions` insert.

---

## Implementation Order

1. **DB migrations first** (K, M) -- needed before code changes can use new columns
2. **PR 1** (generate-signals alignment, F integration, tests)
3. **PR 2** (ai-analysis hardening)
4. Deploy `generate-signals` and run for 5 symbols to verify score spread

## Files Summary

| File | PRs | Changes |
|------|-----|---------|
| `supabase/functions/generate-signals/index.ts` | PR 1, 3 | Signed scoring, weight renorm, dead code cleanup, p_up/version columns |
| `src/lib/analysis/engine.ts` | PR 1 | Wire calculateObjectiveCoverage into runAnalysis |
| `src/test/scoring-pipeline.test.ts` | PR 1 | Tests for B (returns at score=50) and E (weight sum) |
| `supabase/functions/ai-analysis/index.ts` | PR 2 | Fund type, HTML strip, validation, logging, low-data confidence cap |
| DB migration | PR 3 | calibration_stats table, p_up/versions on asset_predictions, quality on raw_prices |

