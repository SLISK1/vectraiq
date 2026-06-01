/**
 * Swedish tax engine for the paper portfolio.
 * ============================================================
 * Pure, dependency-free functions. NO network, NO Supabase, NO React —
 * everything here is unit-testable in isolation (see src/test/tax.test.ts).
 *
 * Models the three real-world Swedish account wrappers (kontotyper):
 *   - ISK  (Investeringssparkonto)   — schablonbeskattat
 *   - KF   (Kapitalförsäkring)       — avkastningsskatt (schablon, similar mechanics)
 *   - Depå (aktie-/fonddepå, VP)     — reavinstbeskattat per affär, redovisas på K4
 *
 * ------------------------------------------------------------
 * CRITICAL DOMAIN NOTE — WHY NOT FIFO:
 * ------------------------------------------------------------
 * Swedish tax law does NOT use FIFO to compute a security's cost basis.
 * The cost basis (omkostnadsbelopp) of marknadsnoterade aktier is computed
 * with GENOMSNITTSMETODEN — the average-cost method (Inkomstskattelagen
 * 48 kap. 7 §): every buy folds into a single running weighted-average
 * cost per security; a sale realizes (sell_price − average_cost) × qty.
 *
 * For marknadsnoterade aktier/andelar the taxpayer MAY instead use
 * SCHABLONMETODEN (48 kap. 15 §): omkostnadsbelopp = 20% of the sale price
 * (försäljningspriset efter avdrag för utgifter). Whichever method yields
 * the LOWER tax may be chosen, so we compute both and take the minimum.
 *
 * FIFO would assign realized lots in purchase order and produce DIFFERENT
 * (incorrect) K4 figures. The paper portfolio already maintains a single
 * weighted-average avg_cost per holding, which is exactly genomsnittsmetoden,
 * so we build on that and never reconstruct FIFO lots.
 *
 * ------------------------------------------------------------
 * IMPORTANT — TAX RATES ARE ESTIMATES, VERIFY EACH YEAR:
 * ------------------------------------------------------------
 * Every rate/threshold below is exported as a NAMED CONSTANT carrying a
 * "VERIFY current year" note. The statslåneränta (government borrowing rate),
 * the schablonintäkt floor, and the tax-free fribelopp on schablonintäkt
 * change by year / by political reform. Do NOT treat the defaults here as
 * authoritative for any specific year — surface a disclaimer in the UI and
 * let the caller pass year-specific values.
 */

// ============================================================
// CONSTANTS — all "VERIFY current year" (Skatteverket / SFS)
// ============================================================

/**
 * Flat capital-gains tax rate in the kapitalinkomst-slag (inkomstslaget kapital).
 * 30% on net capital income. Applies to depå gains and to ISK/KF schablonintäkt.
 * Stable for many years but VERIFY current year.
 */
export const CAPITAL_GAINS_TAX_RATE = 0.30;

/**
 * Schablonmetoden: omkostnadsbelopp = 20% of the sale price, allowed for
 * marknadsnoterade aktier/andelar (Inkomstskattelagen 48 kap. 15 §).
 * VERIFY current year.
 */
export const SCHABLONMETOD_COST_FRACTION = 0.20;

/**
 * Quotation (kvotering) rules for capital LOSSES (Inkomstskattelagen 48 kap. 20–24 §):
 *   - A loss on marknadsnoterade aktier is 100% deductible against GAINS on
 *     marknadsnoterade aktier/andelar (and certain other equities) in the
 *     same year (kvittning fullt ut).
 *   - Any remaining/unmatched loss is only deductible at 70% against other
 *     capital income (e.g. interest, other gains).
 * We model both fractions; the caller decides how much loss is matched
 * against equity gains vs. spilled to "other".
 * VERIFY current year.
 */
export const LOSS_QUOTA_AGAINST_EQUITY_GAINS = 1.0; // 100% kvittning mot aktievinster
export const LOSS_QUOTA_OTHER = 0.7; // 70% kvotering mot övrig kapitalinkomst

/**
 * ISK / KF schablonintäkt formula (Inkomstskattelagen 42 kap. / 58 kap.):
 *   schablonintäkt = kapitalunderlag × schablonräntesats
 *   schablonräntesats = max(statslåneräntan_30_nov + uppräkning, golv)
 *
 * STATSLANERANTA_30_NOV_DEFAULT — the government borrowing rate (statslåneräntan)
 *   as of 30 November of the year BEFORE the tax year. This is the single most
 *   year-sensitive input. The default below is only a placeholder.
 *   VERIFY current year (Riksgälden / Skatteverket publishes it).
 *
 * SCHABLON_UPPRAKNING_PP — the percentage-point add-on to the statslåneränta
 *   (historically +1.0 pp). VERIFY current year.
 *
 * SCHABLON_FLOOR_RATE — the floor on the schablonräntesats (historically 1.25%).
 *   The effective rate is never lower than this. VERIFY current year.
 */
export const STATSLANERANTA_30_NOV_DEFAULT = 0.02; // ~2.00% placeholder — VERIFY current year
export const SCHABLON_UPPRAKNING_PP = 0.01; // +1.0 percentage point — VERIFY current year
export const SCHABLON_FLOOR_RATE = 0.0125; // 1.25% golv — VERIFY current year

/**
 * Recently-reformed TAX-FREE GRUNDNIVÅ / FRIBELOPP on ISK & KF.
 *
 * Reform context: a fribelopp was introduced making a slice of ISK/KF capital
 * effectively tax-free. The exempt CAPITAL amount (kapitalunderlag) is what is
 * commonly quoted in the press:
 *   - 2025 ≈ 150 000 kr of capital exempt
 *   - 2026 ≈ 300 000 kr of capital exempt
 * (Per person; the figures are politically set and have been revised — these
 * are APPROXIMATE and MUST be verified each year.)
 *
 * We model the fribelopp as an exempt slice of the KAPITALUNDERLAG: only the
 * kapitalunderlag ABOVE the fribelopp generates a taxable schablonintäkt.
 * Pass year-specific values via the options; the default targets 2026.
 * VERIFY current year — flagged clearly in the UI.
 */
export const ISK_KF_FRIBELOPP_CAPITAL_2025 = 150_000; // APPROX — VERIFY
export const ISK_KF_FRIBELOPP_CAPITAL_2026 = 300_000; // APPROX — VERIFY
export const ISK_KF_FRIBELOPP_CAPITAL_DEFAULT = ISK_KF_FRIBELOPP_CAPITAL_2026;

/**
 * High-turnover heuristic for the depå-vs-ISK insight. Turnover = total traded
 * value / average capital base over the year. Above this, a depå starts to mean
 * meaningful K4 admin and (when markets rise) often a worse after-tax outcome
 * than an ISK. Heuristic only — VERIFY against your own situation.
 */
export const HIGH_TURNOVER_THRESHOLD = 2.0; // 200% omsättning/år

// ============================================================
// TYPES
// ============================================================

export type AccountType = 'isk' | 'kf' | 'depa';

/** Swedish labels for the three account types (for UI reuse). */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  isk: 'ISK (Investeringssparkonto)',
  kf: 'Kapitalförsäkring',
  depa: 'Aktie-/fonddepå',
};

/** Short labels. */
export const ACCOUNT_TYPE_SHORT: Record<AccountType, string> = {
  isk: 'ISK',
  kf: 'KF',
  depa: 'Depå',
};

/** Which cost-basis method (omkostnadsmetod) was used for a depå sale. */
export type CostBasisMethod = 'genomsnittsmetoden' | 'schablonmetoden';

export interface DepaGainResult {
  /** Sale proceeds used as försäljningspris (typically qty × price − fees). */
  salePrice: number;
  /** omkostnadsbelopp under genomsnittsmetoden (avg_cost × qty). */
  costBasisAverage: number;
  /** omkostnadsbelopp under schablonmetoden (20% × salePrice). */
  costBasisSchablon: number;
  /** Method that yields the lower tax (i.e. the lower omkostnadsbelopp → smaller gain when gain ≥ 0). */
  method: CostBasisMethod;
  /** omkostnadsbelopp actually applied (per `method`). */
  costBasisUsed: number;
  /** Taxable gain (>0) or loss (<0): salePrice − costBasisUsed. */
  gain: number;
  /** Capital-gains tax due on a positive gain (0 for a loss; losses handled via kvittning). */
  tax: number;
}

export interface SchablonResult {
  /** Underlying capital base (kapitalunderlag) for the year. */
  capitalBase: number;
  /** Effective schablonräntesats actually applied (after floor). */
  schablonRate: number;
  /** Capital exempt via fribelopp. */
  fribelopp: number;
  /** Capital base above the fribelopp that actually generates schablonintäkt. */
  taxableCapitalBase: number;
  /** schablonintäkt = taxableCapitalBase × schablonRate. */
  schablonintakt: number;
  /** Tax = 30% × schablonintäkt. */
  tax: number;
}

export interface SchablonOptions {
  /** statslåneräntan as of 30 Nov prior year (decimal, e.g. 0.02 = 2%). */
  statslaneranta?: number;
  /** percentage-point add-on (decimal). */
  upprakningPp?: number;
  /** floor on the rate (decimal). */
  floorRate?: number;
  /** tax-free fribelopp on capital (kr). */
  fribelopp?: number;
  /**
   * KF is avkastningsskatt: the same schablon mechanics, but the tax is levied
   * on the FÖRSÄKRINGSBOLAG (not the individual), there is no fribelopp in the
   * ISK sense, and historically the rate has had a slightly different floor /
   * uppräkning. We model it with the same formula and a documented caveat;
   * pass `isKf: true` to drop the ISK fribelopp by default.
   */
  isKf?: boolean;
}

export interface AccountComparisonInput {
  /** Average capital base over the year (kr). */
  capitalBase: number;
  /** Estimated annual REALIZED gains for a depå (kr); negative = net loss. */
  estimatedAnnualRealizedGains: number;
  /** Total traded value over the year (kr), used to derive turnover. */
  annualTurnover: number;
  /** Optional schablon options (statslåneränta, fribelopp, …). */
  schablonOptions?: SchablonOptions;
}

export interface AccountComparisonRow {
  accountType: AccountType;
  label: string;
  /** Estimated annual tax (kr). */
  estimatedTax: number;
  /** Short Swedish explanation of how the figure was derived. */
  basis: string;
}

export interface AccountComparison {
  rows: AccountComparisonRow[];
  /** Turnover ratio = annualTurnover / capitalBase. */
  turnoverRatio: number;
  /** True when turnover is high enough to make depå admin/burden notable. */
  highTurnover: boolean;
  /** The account type with the lowest estimated tax. */
  recommended: AccountType;
  /** The plan's turnover insight, in Swedish, tailored to the inputs. */
  insight: string;
}

/** A minimal trade shape for the K4 summary — only the fields we need. */
export interface TaxTrade {
  ticker: string;
  side: string; // 'buy' | 'sell'
  qty: number;
  price: number;
  /** Realized gain stored on sells (genomsnittsmetoden). May be null/undefined for buys. */
  realized_gain?: number | null;
  /** Optional fee, subtracted from proceeds when present. */
  fee?: number | null;
}

export interface K4Row {
  /** Beteckning (security name/ticker). */
  beteckning: string;
  /** Antal (number of units sold, summed across sells). */
  antal: number;
  /** Försäljningspris (total proceeds across sells). */
  forsaljningspris: number;
  /** Omkostnadsbelopp (proceeds − realized gain), i.e. the average-cost basis. */
  omkostnadsbelopp: number;
  /** Vinst (only the positive part), summed. */
  vinst: number;
  /** Förlust (only the negative part as a positive number), summed. */
  forlust: number;
}

export interface K4Summary {
  /** Avsnitt A: marknadsnoterade aktier m.m. */
  rows: K4Row[];
  /** Sum of försäljningspris across rows. */
  totalForsaljningspris: number;
  /** Sum of omkostnadsbelopp across rows. */
  totalOmkostnadsbelopp: number;
  /** Sum of vinst across rows. */
  totalVinst: number;
  /** Sum of förlust across rows (positive number). */
  totalForlust: number;
  /** Net result = totalVinst − totalForlust. */
  nettoResultat: number;
}

// ============================================================
// DEPÅ — capital gains via genomsnittsmetoden vs schablonmetoden
// ============================================================

/**
 * Round to öre (2 decimals) to keep figures stable and readable.
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the depå capital-gains tax for a single sale, choosing the
 * cost-basis method (genomsnittsmetoden vs schablonmetoden) that yields the
 * LOWER tax for marknadsnoterade aktier.
 *
 * GENOMSNITTSMETODEN (default / always valid):
 *   omkostnadsbelopp = averageCost × qty            (the running weighted avg)
 *   vinst            = försäljningspris − omkostnadsbelopp
 *
 * SCHABLONMETODEN (marknadsnoterade aktier only):
 *   omkostnadsbelopp = 20% × försäljningspris
 *   vinst            = 80% × försäljningspris
 *
 * Tax on a positive gain = 30% × gain. A loss returns tax = 0 here; losses are
 * handled by kvittning/kvotering at the aggregate level (see quoteLoss()).
 *
 * @param salePrice   försäljningspris (proceeds, typically qty × price − fees)
 * @param averageCost weighted-average cost PER UNIT (genomsnittsmetoden)
 * @param qty         number of units sold
 * @param allowSchablon whether schablonmetoden is permitted (true for
 *                      marknadsnoterade aktier; false otherwise). Default true.
 */
export function computeDepaGain(
  salePrice: number,
  averageCost: number,
  qty: number,
  allowSchablon = true,
): DepaGainResult {
  const costBasisAverage = round2(averageCost * qty);
  const costBasisSchablon = round2(SCHABLONMETOD_COST_FRACTION * salePrice);

  const gainAverage = round2(salePrice - costBasisAverage);
  const gainSchablon = round2(salePrice - costBasisSchablon);

  // Tax is 30% on a positive gain; a loss is not taxed here (handled via kvittning).
  const taxFor = (gain: number) => (gain > 0 ? round2(gain * CAPITAL_GAINS_TAX_RATE) : 0);
  const taxAverage = taxFor(gainAverage);
  const taxSchablon = taxFor(gainSchablon);

  // Choose the method with the LOWER tax. Schablonmetoden only when allowed.
  // On a loss (both taxes 0) prefer genomsnittsmetoden, which yields the LARGER
  // deductible loss (schablon caps the loss at 20% of proceeds), so it's never
  // worse for the taxpayer.
  let method: CostBasisMethod = 'genomsnittsmetoden';
  if (allowSchablon) {
    if (taxSchablon < taxAverage) {
      method = 'schablonmetoden';
    } else if (taxSchablon === taxAverage && gainSchablon > 0 && gainSchablon < gainAverage) {
      // Equal tax can't happen for positive gains, but guard anyway: prefer smaller gain.
      method = 'schablonmetoden';
    }
  }

  const costBasisUsed = method === 'schablonmetoden' ? costBasisSchablon : costBasisAverage;
  const gain = method === 'schablonmetoden' ? gainSchablon : gainAverage;
  const tax = method === 'schablonmetoden' ? taxSchablon : taxAverage;

  return {
    salePrice: round2(salePrice),
    costBasisAverage,
    costBasisSchablon,
    method,
    costBasisUsed,
    gain,
    tax,
  };
}

/**
 * Apply kvotering to a net capital LOSS (positive number = size of the loss).
 * Returns the deductible amount (skattereduktionsunderlag) under the two regimes.
 *
 *   - matchedAgainstEquityGains: deductible at 100% against equity gains.
 *   - spilledToOther: the remainder, deductible at only 70% against other
 *     capital income.
 *
 * @param loss              total realized loss (positive number)
 * @param equityGainsToOffset gains on marknadsnoterade aktier available to absorb the loss at 100%
 */
export function quoteLoss(loss: number, equityGainsToOffset = 0): {
  matchedAgainstEquityGains: number;
  spilledToOther: number;
  deductibleAmount: number;
} {
  const positiveLoss = Math.max(0, loss);
  const matched = Math.min(positiveLoss, Math.max(0, equityGainsToOffset));
  const spilled = positiveLoss - matched;
  const deductibleAmount = round2(
    matched * LOSS_QUOTA_AGAINST_EQUITY_GAINS + spilled * LOSS_QUOTA_OTHER,
  );
  return {
    matchedAgainstEquityGains: round2(matched),
    spilledToOther: round2(spilled),
    deductibleAmount,
  };
}

// ============================================================
// ISK / KF — schablonskatt
// ============================================================

/**
 * Effective schablonräntesats = max(statslåneränta + uppräkning, floor).
 */
export function schablonRate(opts: SchablonOptions = {}): number {
  const slr = opts.statslaneranta ?? STATSLANERANTA_30_NOV_DEFAULT;
  const upp = opts.upprakningPp ?? SCHABLON_UPPRAKNING_PP;
  const floor = opts.floorRate ?? SCHABLON_FLOOR_RATE;
  return Math.max(slr + upp, floor);
}

/**
 * Compute the ISK/KF schablonskatt for a year.
 *
 *   schablonräntesats = max(statslåneränta_30_nov + uppräkning, golv 1.25%)
 *   taxableCapitalBase = max(0, kapitalunderlag − fribelopp)
 *   schablonintäkt = taxableCapitalBase × schablonräntesats
 *   skatt = 30% × schablonintäkt
 *
 * The fribelopp models the recently-reformed tax-free slice (≈150k 2025 /
 * ≈300k 2026 of capital). For KF (`isKf: true`) we drop the ISK fribelopp by
 * default — see the SchablonOptions.isKf caveat: KF is avkastningsskatt with
 * slightly different mechanics, levied on the insurer.
 */
export function computeSchablonTax(capitalBase: number, opts: SchablonOptions = {}): SchablonResult {
  const rate = schablonRate(opts);
  // ISK fribelopp default; KF default = no fribelopp unless explicitly provided.
  const defaultFribelopp = opts.isKf ? 0 : ISK_KF_FRIBELOPP_CAPITAL_DEFAULT;
  const fribelopp = opts.fribelopp ?? defaultFribelopp;

  const safeBase = Math.max(0, capitalBase);
  const taxableCapitalBase = Math.max(0, safeBase - fribelopp);
  const schablonintakt = round2(taxableCapitalBase * rate);
  const tax = round2(schablonintakt * CAPITAL_GAINS_TAX_RATE);

  return {
    capitalBase: round2(safeBase),
    schablonRate: rate,
    fribelopp: round2(fribelopp),
    taxableCapitalBase: round2(taxableCapitalBase),
    schablonintakt,
    tax,
  };
}

// ============================================================
// ACCOUNT-TYPE COMPARISON + turnover insight
// ============================================================

/**
 * Estimate annual tax for ISK vs KF vs Depå given a capital base, estimated
 * annual realized gains, and turnover — and surface the plan's insight.
 *
 * ISK & KF: schablonskatt on the capital base (gains are tax-free, only the
 *   schablonintäkt is taxed). KF uses no ISK fribelopp by default.
 * Depå: 30% on positive net realized gains; a net loss yields a NEGATIVE tax
 *   figure here (a tax shield via kvittning at 70%/100%) so the comparison can
 *   reflect that a loss-making, low-turnover depå can beat a schablon account.
 *
 * Insight (the plan's point):
 *   - HIGH turnover ⇒ a depå means lots of K4 admin and, when markets rise,
 *     often a worse after-tax result than an ISK → favour ISK.
 *   - LOW turnover / buy-and-hold ⇒ a depå can win when returns are modest or
 *     NEGATIVE (no schablonskatt on a flat/falling portfolio; losses are
 *     deductible), so a depå may be preferable.
 */
export function compareAccountTypes(input: AccountComparisonInput): AccountComparison {
  const { capitalBase, estimatedAnnualRealizedGains, annualTurnover, schablonOptions } = input;

  const iskTax = computeSchablonTax(capitalBase, { ...schablonOptions, isKf: false }).tax;
  const kfTax = computeSchablonTax(capitalBase, { ...schablonOptions, isKf: true }).tax;

  // Depå: tax on positive gains; a loss becomes a deductible tax shield.
  // Positive gains: 30%. Loss: 70% kvotering against other capital income
  // (conservative — assumes no equity gains to absorb it at 100%).
  let depaTax: number;
  let depaBasis: string;
  if (estimatedAnnualRealizedGains >= 0) {
    depaTax = round2(estimatedAnnualRealizedGains * CAPITAL_GAINS_TAX_RATE);
    depaBasis = '30% reavinstskatt på realiserad vinst (genomsnittsmetoden)';
  } else {
    const { deductibleAmount } = quoteLoss(-estimatedAnnualRealizedGains, 0);
    depaTax = round2(-deductibleAmount * CAPITAL_GAINS_TAX_RATE);
    depaBasis = '70% kvotering av förlust → skattereduktion (negativ skatt)';
  }

  const turnoverRatio = capitalBase > 0 ? annualTurnover / capitalBase : 0;
  const highTurnover = turnoverRatio >= HIGH_TURNOVER_THRESHOLD;

  const rows: AccountComparisonRow[] = [
    {
      accountType: 'isk',
      label: ACCOUNT_TYPE_SHORT.isk,
      estimatedTax: iskTax,
      basis: 'Schablonskatt på kapitalunderlag (vinster skattefria)',
    },
    {
      accountType: 'kf',
      label: ACCOUNT_TYPE_SHORT.kf,
      estimatedTax: kfTax,
      basis: 'Avkastningsskatt (schablon, utan ISK-fribelopp som standard)',
    },
    {
      accountType: 'depa',
      label: ACCOUNT_TYPE_SHORT.depa,
      estimatedTax: depaTax,
      basis: depaBasis,
    },
  ];

  // Lowest estimated tax wins (a negative depå figure can win on losses).
  const recommended = rows.reduce((best, r) => (r.estimatedTax < best.estimatedTax ? r : best), rows[0])
    .accountType;

  let insight: string;
  if (highTurnover) {
    insight =
      `Hög omsättning (${(turnoverRatio * 100).toFixed(0)}% av kapitalet/år): en depå innebär omfattande ` +
      `K4-administration och — i en stigande marknad — ofta sämre utfall efter skatt än ett ISK, ` +
      `eftersom varje vinst realiseras och beskattas med 30%. ISK/KF beskattar bara schablonintäkten ` +
      `oavsett hur ofta du handlar. Vid hög omsättning talar det mesta för ISK/KF.`;
  } else if (estimatedAnnualRealizedGains <= 0) {
    insight =
      `Låg omsättning och svag/negativ avkastning: en depå kan vara att föredra. Vid förlust eller ` +
      `nollavkastning betalar du ingen reavinstskatt, och förluster är avdragsgilla (100% mot ` +
      `aktievinster, annars 70%) — medan ISK/KF tar ut schablonskatt även när portföljen står still ` +
      `eller faller.`;
  } else {
    insight =
      `Låg omsättning (köp-och-behåll): jämför schablonskatten på ISK/KF mot 30% reavinstskatt vid ` +
      `framtida försäljning i depå. Vid blygsam avkastning och få affärer kan en depå stå sig väl, ` +
      `särskilt eftersom uppskjuten skatt och avdragsgilla förluster spelar till depåns fördel. ` +
      `Vid högre förväntad avkastning brukar däremot ISK/KF vinna.`;
  }

  return { rows, turnoverRatio, highTurnover, recommended, insight };
}

// ============================================================
// K4 — per-security realized gain/loss summary (Avsnitt A)
// ============================================================

/**
 * Build a K4-sammanställning (Avsnitt A — marknadsnoterade aktier m.m.) from a
 * list of trades. Only SELLS with a stored realized_gain contribute (buys carry
 * no realized result). Per security (beteckning) we sum:
 *   - antal              = Σ qty sold
 *   - försäljningspris   = Σ (qty × price − fee)   [proceeds]
 *   - omkostnadsbelopp   = försäljningspris − realized_gain   [the avg-cost basis]
 *   - vinst              = Σ max(0, realized_gain)
 *   - förlust            = Σ max(0, −realized_gain)
 *
 * Because realized_gain was computed with genomsnittsmetoden upstream
 * (paper-trade edge function), omkostnadsbelopp here is the average-cost basis —
 * exactly what Skatteverket expects on the K4, NOT a FIFO reconstruction.
 */
export function buildK4Summary(trades: TaxTrade[]): K4Summary {
  const byTicker = new Map<string, K4Row>();

  for (const t of trades) {
    if (t.side !== 'sell') continue;
    if (t.realized_gain == null || Number.isNaN(Number(t.realized_gain))) continue;

    const qty = Number(t.qty) || 0;
    const price = Number(t.price) || 0;
    const fee = Number(t.fee ?? 0) || 0;
    const realized = Number(t.realized_gain) || 0;

    // Proceeds (försäljningspris) net of fee; omkostnadsbelopp backs out from realized gain.
    const proceeds = qty * price - fee;
    const omkostnad = proceeds - realized;

    const key = t.ticker;
    const existing = byTicker.get(key) ?? {
      beteckning: key,
      antal: 0,
      forsaljningspris: 0,
      omkostnadsbelopp: 0,
      vinst: 0,
      forlust: 0,
    };

    existing.antal += qty;
    existing.forsaljningspris += proceeds;
    existing.omkostnadsbelopp += omkostnad;
    if (realized >= 0) existing.vinst += realized;
    else existing.forlust += -realized;

    byTicker.set(key, existing);
  }

  const rows = Array.from(byTicker.values())
    .map((r) => ({
      beteckning: r.beteckning,
      antal: round2(r.antal),
      forsaljningspris: round2(r.forsaljningspris),
      omkostnadsbelopp: round2(r.omkostnadsbelopp),
      vinst: round2(r.vinst),
      forlust: round2(r.forlust),
    }))
    .sort((a, b) => a.beteckning.localeCompare(b.beteckning, 'sv'));

  const totalForsaljningspris = round2(rows.reduce((s, r) => s + r.forsaljningspris, 0));
  const totalOmkostnadsbelopp = round2(rows.reduce((s, r) => s + r.omkostnadsbelopp, 0));
  const totalVinst = round2(rows.reduce((s, r) => s + r.vinst, 0));
  const totalForlust = round2(rows.reduce((s, r) => s + r.forlust, 0));
  const nettoResultat = round2(totalVinst - totalForlust);

  return {
    rows,
    totalForsaljningspris,
    totalOmkostnadsbelopp,
    totalVinst,
    totalForlust,
    nettoResultat,
  };
}
