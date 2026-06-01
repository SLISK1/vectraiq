// Fundamental Screening Module
// ---------------------------------------------------------------------------
// Deterministic, pure implementations of three classic fundamental-screening
// models used by the VectraIQ screener:
//
//   1. Piotroski F-Score      — 9-point financial-strength score (0..9)
//   2. Altman Z-Score         — bankruptcy-distress score with zone classification
//   3. Greenblatt Magic Formula — earnings yield + return on capital ranking inputs
//
// Every function is PURE (no I/O, no side effects) and DEGRADES GRACEFULLY:
// it computes from whatever inputs exist, never throws on missing data, and
// reports which criteria/inputs were `available` vs `missing` so the UI can
// honestly surface partial results and show "–" for the rest.
//
// This file is the single source of truth for the formulas. The Supabase
// `fetch-fundamentals` edge function is responsible for populating the raw
// statement fields below into `symbols.metadata.fundamentals`.
// ---------------------------------------------------------------------------

/**
 * Raw + derived fundamentals consumed by the screening models.
 *
 * All fields are optional and may be `null` — the models tolerate absence.
 * Monetary values are assumed to be in the same currency/units for a given
 * company (ratios are unit-invariant, so absolute scale does not matter as
 * long as items from the same statements share units).
 *
 * "Prior-year" fields (suffixed `Prev`) hold the immediately preceding annual
 * period and power the year-over-year (YoY) Piotroski criteria. They are
 * optional: when absent, only level-based criteria are scored.
 */
export interface ScreeningFundamentals {
  // ── Income statement (current period) ──────────────────────────────
  netIncome?: number | null;        // bottom-line profit
  revenue?: number | null;          // total revenue / sales
  grossProfit?: number | null;      // revenue - COGS
  operatingIncome?: number | null;  // EBIT (operating income)

  // ── Cash-flow statement (current period) ───────────────────────────
  operatingCashFlow?: number | null; // cash from operations (CFO)

  // ── Balance sheet (current period) ─────────────────────────────────
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  currentAssets?: number | null;
  currentLiabilities?: number | null;
  longTermDebt?: number | null;
  retainedEarnings?: number | null;
  sharesOutstanding?: number | null; // weighted avg shares
  netFixedAssets?: number | null;    // PP&E net of depreciation (for Magic Formula ROC)

  // ── Derived / market ───────────────────────────────────────────────
  workingCapital?: number | null;    // currentAssets - currentLiabilities (if not given)
  marketCap?: number | null;         // market value of equity
  enterpriseValue?: number | null;   // EV = marketCap + totalDebt - cash (for earnings yield)

  // ── Prior-year (annual) values for YoY Piotroski criteria ──────────
  netIncomePrev?: number | null;
  revenuePrev?: number | null;
  grossProfitPrev?: number | null;
  totalAssetsPrev?: number | null;
  currentAssetsPrev?: number | null;
  currentLiabilitiesPrev?: number | null;
  longTermDebtPrev?: number | null;
  sharesOutstandingPrev?: number | null;
}

/** Standard result shape shared by every screening model. */
export interface ScreeningResult {
  /** Primary numeric score (F-score 0..9, Altman Z value, etc.). `null` when nothing scorable. */
  score: number | null;
  /** Per-criterion / per-input breakdown (booleans for F-score, raw values for others). */
  components: Record<string, number | boolean | null>;
  /** Number of criteria/inputs that could be evaluated from the provided data. */
  available: number;
  /** Human-readable list of criteria/inputs that were unavailable (missing inputs). */
  missing: string[];
}

/** Altman zone classification. */
export type AltmanZone = 'distress' | 'grey' | 'safe';

export interface AltmanResult extends ScreeningResult {
  zone: AltmanZone | null;
}

export interface MagicFormulaResult extends ScreeningResult {
  /** Earnings yield = EBIT / EV (fraction; multiply by 100 for %). `null` if not computable. */
  earningsYield: number | null;
  /** Return on capital = EBIT / (net working capital + net fixed assets) (fraction). `null` if not computable. */
  returnOnCapital: number | null;
}

// ── Internal helpers ────────────────────────────────────────────────

/** Finite-number guard. Treats null/undefined/NaN/Infinity as "not a usable number". */
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Returns the value if it's a usable finite number, otherwise null. */
const n = (v: unknown): number | null => (isNum(v) ? v : null);

/**
 * Working capital = current assets − current liabilities.
 * Falls back to an explicitly supplied `workingCapital` field when the
 * component balance-sheet items are not both present.
 */
const workingCapital = (f: ScreeningFundamentals): number | null => {
  if (isNum(f.currentAssets) && isNum(f.currentLiabilities)) {
    return f.currentAssets - f.currentLiabilities;
  }
  return n(f.workingCapital);
};

// ═══════════════════════════════════════════════════════════════════
// 1. PIOTROSKI F-SCORE
// ═══════════════════════════════════════════════════════════════════
//
// Joseph Piotroski (2000) — a 9-point checklist of financial strength. Each
// criterion that is satisfied scores 1 point; the total ranges 0 (weakest) to
// 9 (strongest). Criteria are grouped into three categories:
//
//   PROFITABILITY (4)
//     1. Positive net income (ROA > 0)            → netIncome > 0
//     2. Positive operating cash flow             → operatingCashFlow > 0
//     3. Rising ROA year over year                → ROA > ROA_prev
//     4. Quality of earnings: CFO > net income    → operatingCashFlow > netIncome
//
//   LEVERAGE / LIQUIDITY / SOURCE OF FUNDS (3)
//     5. Falling long-term-debt ratio (LTD/TA)    → LTD/TA < LTD/TA_prev
//     6. Rising current ratio                     → currentRatio > currentRatio_prev
//     7. No new shares issued                     → shares <= shares_prev
//
//   OPERATING EFFICIENCY (2)
//     8. Rising gross margin                      → grossMargin > grossMargin_prev
//     9. Rising asset turnover                    → assetTurnover > assetTurnover_prev
//
// ROA           = netIncome / totalAssets
// Current ratio = currentAssets / currentLiabilities
// Gross margin  = grossProfit / revenue
// Asset turnover= revenue / totalAssets
//
// Graceful degradation: criteria 1, 2 and 4 are level-based (need only the
// current period). Criteria 3, 5, 6, 7, 8, 9 are YoY and require prior-year
// inputs; when prior-year data (or the needed inputs) is missing, that
// criterion is skipped and listed in `missing`. `available` counts how many
// of the 9 criteria were actually evaluated, and `score` is the sum of the
// satisfied ones among those.
// ═══════════════════════════════════════════════════════════════════

export function computePiotroskiFScore(
  f: ScreeningFundamentals,
  fPrev?: ScreeningFundamentals,
): ScreeningResult {
  // Allow prior-year values to be passed either inline on `f` (the *Prev fields)
  // or via a separate prior-period object. The separate object takes precedence.
  const prevNetIncome = fPrev ? n(fPrev.netIncome) : n(f.netIncomePrev);
  const prevRevenue = fPrev ? n(fPrev.revenue) : n(f.revenuePrev);
  const prevGrossProfit = fPrev ? n(fPrev.grossProfit) : n(f.grossProfitPrev);
  const prevTotalAssets = fPrev ? n(fPrev.totalAssets) : n(f.totalAssetsPrev);
  const prevCurrentAssets = fPrev ? n(fPrev.currentAssets) : n(f.currentAssetsPrev);
  const prevCurrentLiabilities = fPrev ? n(fPrev.currentLiabilities) : n(f.currentLiabilitiesPrev);
  const prevLongTermDebt = fPrev ? n(fPrev.longTermDebt) : n(f.longTermDebtPrev);
  const prevShares = fPrev ? n(fPrev.sharesOutstanding) : n(f.sharesOutstandingPrev);

  const components: Record<string, boolean | null> = {};
  const missing: string[] = [];
  let available = 0;
  let score = 0;

  // Records a criterion: `pass` is null when inputs are unavailable.
  const criterion = (key: string, pass: boolean | null) => {
    components[key] = pass;
    if (pass === null) {
      missing.push(key);
    } else {
      available++;
      if (pass) score++;
    }
  };

  // ── Profitability ──
  // 1. Positive net income
  criterion(
    'positiveNetIncome',
    isNum(f.netIncome) ? f.netIncome > 0 : null,
  );

  // 2. Positive operating cash flow
  criterion(
    'positiveOperatingCashFlow',
    isNum(f.operatingCashFlow) ? f.operatingCashFlow > 0 : null,
  );

  // 3. Rising ROA (netIncome / totalAssets) vs prior year
  const roaNow =
    isNum(f.netIncome) && isNum(f.totalAssets) && f.totalAssets !== 0
      ? f.netIncome / f.totalAssets
      : null;
  const roaPrev =
    prevNetIncome !== null && prevTotalAssets !== null && prevTotalAssets !== 0
      ? prevNetIncome / prevTotalAssets
      : null;
  criterion(
    'risingRoa',
    roaNow !== null && roaPrev !== null ? roaNow > roaPrev : null,
  );

  // 4. Accruals / earnings quality: CFO > net income
  criterion(
    'cashFlowExceedsNetIncome',
    isNum(f.operatingCashFlow) && isNum(f.netIncome)
      ? f.operatingCashFlow > f.netIncome
      : null,
  );

  // ── Leverage / Liquidity / Source of funds ──
  // 5. Falling long-term-debt ratio (LTD / totalAssets) vs prior year
  const ltdRatioNow =
    isNum(f.longTermDebt) && isNum(f.totalAssets) && f.totalAssets !== 0
      ? f.longTermDebt / f.totalAssets
      : null;
  const ltdRatioPrev =
    prevLongTermDebt !== null && prevTotalAssets !== null && prevTotalAssets !== 0
      ? prevLongTermDebt / prevTotalAssets
      : null;
  criterion(
    'fallingLeverage',
    ltdRatioNow !== null && ltdRatioPrev !== null ? ltdRatioNow < ltdRatioPrev : null,
  );

  // 6. Rising current ratio (currentAssets / currentLiabilities) vs prior year
  const currentRatioNow =
    isNum(f.currentAssets) && isNum(f.currentLiabilities) && f.currentLiabilities !== 0
      ? f.currentAssets / f.currentLiabilities
      : null;
  const currentRatioPrev =
    prevCurrentAssets !== null && prevCurrentLiabilities !== null && prevCurrentLiabilities !== 0
      ? prevCurrentAssets / prevCurrentLiabilities
      : null;
  criterion(
    'risingCurrentRatio',
    currentRatioNow !== null && currentRatioPrev !== null
      ? currentRatioNow > currentRatioPrev
      : null,
  );

  // 7. No new shares issued (shares outstanding did not increase)
  criterion(
    'noNewShares',
    isNum(f.sharesOutstanding) && prevShares !== null
      ? f.sharesOutstanding <= prevShares
      : null,
  );

  // ── Operating efficiency ──
  // 8. Rising gross margin (grossProfit / revenue) vs prior year
  const grossMarginNow =
    isNum(f.grossProfit) && isNum(f.revenue) && f.revenue !== 0
      ? f.grossProfit / f.revenue
      : null;
  const grossMarginPrev =
    prevGrossProfit !== null && prevRevenue !== null && prevRevenue !== 0
      ? prevGrossProfit / prevRevenue
      : null;
  criterion(
    'risingGrossMargin',
    grossMarginNow !== null && grossMarginPrev !== null
      ? grossMarginNow > grossMarginPrev
      : null,
  );

  // 9. Rising asset turnover (revenue / totalAssets) vs prior year
  const turnoverNow =
    isNum(f.revenue) && isNum(f.totalAssets) && f.totalAssets !== 0
      ? f.revenue / f.totalAssets
      : null;
  const turnoverPrev =
    prevRevenue !== null && prevTotalAssets !== null && prevTotalAssets !== 0
      ? prevRevenue / prevTotalAssets
      : null;
  criterion(
    'risingAssetTurnover',
    turnoverNow !== null && turnoverPrev !== null ? turnoverNow > turnoverPrev : null,
  );

  return {
    // If nothing at all could be scored, report null rather than a misleading 0.
    score: available > 0 ? score : null,
    components,
    available,
    missing,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. ALTMAN Z-SCORE (original 1968 model)
// ═══════════════════════════════════════════════════════════════════
//
// Edward Altman's original model for publicly traded MANUFACTURING firms.
// It best suits manufacturers; service firms / financials are better served
// by the Z'' variants (not implemented here).
//
//   Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5
//
//   X1 = working capital / total assets        (liquidity)
//   X2 = retained earnings / total assets       (cumulative profitability / age)
//   X3 = EBIT / total assets                     (operating productivity)
//   X4 = market value of equity / total liabilities (solvency)
//   X5 = sales / total assets                    (asset turnover)
//
// Zone classification (original cutoffs):
//   Z < 1.8        → distress  ("distress zone", high bankruptcy risk)
//   1.8 ≤ Z ≤ 3.0  → grey      ("grey zone", uncertain)
//   Z > 3.0        → safe      ("safe zone", low bankruptcy risk)
//
// Graceful degradation: each of the five ratios is computed only when its
// inputs exist (and total assets / total liabilities are non-zero). Missing
// ratios contribute 0 to the weighted sum and are listed in `missing`. The
// zone is only reported when at least one ratio was computable; with partial
// inputs the Z value is necessarily a lower bound, so callers should consult
// `available` (out of 5) before trusting the zone.
// ═══════════════════════════════════════════════════════════════════

export function computeAltmanZScore(f: ScreeningFundamentals): AltmanResult {
  const ta = n(f.totalAssets);
  const tl = n(f.totalLiabilities);
  const wc = workingCapital(f);
  const re = n(f.retainedEarnings);
  const ebit = n(f.operatingIncome);
  const mktCap = n(f.marketCap);
  const sales = n(f.revenue);

  const components: Record<string, number | null> = {
    x1: null, // WC / TA
    x2: null, // RE / TA
    x3: null, // EBIT / TA
    x4: null, // MktCap / TL
    x5: null, // Sales / TA
  };
  const missing: string[] = [];
  let available = 0;
  let z = 0;

  const taUsable = ta !== null && ta !== 0;

  // X1 = working capital / total assets   (weight 1.2)
  if (wc !== null && taUsable) {
    components.x1 = wc / ta;
    z += 1.2 * components.x1;
    available++;
  } else {
    missing.push('workingCapitalToAssets');
  }

  // X2 = retained earnings / total assets   (weight 1.4)
  if (re !== null && taUsable) {
    components.x2 = re / ta;
    z += 1.4 * components.x2;
    available++;
  } else {
    missing.push('retainedEarningsToAssets');
  }

  // X3 = EBIT / total assets   (weight 3.3)
  if (ebit !== null && taUsable) {
    components.x3 = ebit / ta;
    z += 3.3 * components.x3;
    available++;
  } else {
    missing.push('ebitToAssets');
  }

  // X4 = market value of equity / total liabilities   (weight 0.6)
  if (mktCap !== null && tl !== null && tl !== 0) {
    components.x4 = mktCap / tl;
    z += 0.6 * components.x4;
    available++;
  } else {
    missing.push('equityToLiabilities');
  }

  // X5 = sales / total assets   (weight 1.0)
  if (sales !== null && taUsable) {
    components.x5 = sales / ta;
    z += 1.0 * components.x5;
    available++;
  } else {
    missing.push('salesToAssets');
  }

  if (available === 0) {
    return { score: null, zone: null, components, available, missing };
  }

  const zone: AltmanZone = z < 1.8 ? 'distress' : z <= 3.0 ? 'grey' : 'safe';
  return { score: z, zone, components, available, missing };
}

// ═══════════════════════════════════════════════════════════════════
// 3. GREENBLATT MAGIC FORMULA
// ═══════════════════════════════════════════════════════════════════
//
// Joel Greenblatt's "Little Book That Beats the Market" ranks stocks on two
// quality/value metrics; the screener combines the two ranks externally.
//
//   Earnings yield    = EBIT / Enterprise Value
//                       (how cheap the operating earnings are vs total cost
//                        to acquire the business; higher = cheaper = better)
//
//   Return on capital = EBIT / (net working capital + net fixed assets)
//                       (how efficiently tangible operating capital produces
//                        operating earnings; higher = better)
//
//   where net working capital = current assets − current liabilities
//         net fixed assets    = property, plant & equipment net of depreciation
//
// Both raw fractional values are returned so the screener can rank the universe
// (Greenblatt ranks each metric descending, sums the two ranks, and sorts by
// the combined rank — done in the UI, not here).
//
// Graceful degradation: each metric is computed independently when its inputs
// exist; a missing denominator (or a non-positive capital base) yields `null`
// for that metric and an entry in `missing`. `score` mirrors `earningsYield`
// as the conventional headline value (in %) when available.
// ═══════════════════════════════════════════════════════════════════

export function computeMagicFormula(f: ScreeningFundamentals): MagicFormulaResult {
  const ebit = n(f.operatingIncome);
  const ev = n(f.enterpriseValue);
  const nfa = n(f.netFixedAssets);
  const nwc = workingCapital(f);

  const components: Record<string, number | null> = {
    ebit,
    enterpriseValue: ev,
    investedCapital: null,
  };
  const missing: string[] = [];

  // Earnings yield = EBIT / EV (EV must be a usable, non-zero number)
  let earningsYield: number | null = null;
  if (ebit !== null && ev !== null && ev !== 0) {
    earningsYield = ebit / ev;
  } else {
    if (ebit === null) missing.push('ebit');
    if (ev === null || ev === 0) missing.push('enterpriseValue');
  }

  // Return on capital = EBIT / (net working capital + net fixed assets).
  // The capital base must be positive to be economically meaningful.
  let returnOnCapital: number | null = null;
  if (nwc !== null && nfa !== null) {
    const investedCapital = nwc + nfa;
    components.investedCapital = investedCapital;
    if (ebit !== null && investedCapital > 0) {
      returnOnCapital = ebit / investedCapital;
    } else if (investedCapital <= 0) {
      missing.push('investedCapital');
    }
  } else {
    if (nwc === null) missing.push('netWorkingCapital');
    if (nfa === null) missing.push('netFixedAssets');
  }

  let available = 0;
  if (earningsYield !== null) available++;
  if (returnOnCapital !== null) available++;

  return {
    // Headline score = earnings yield in percent (the primary value metric).
    score: earningsYield !== null ? earningsYield * 100 : null,
    earningsYield,
    returnOnCapital,
    components,
    available,
    missing,
  };
}
