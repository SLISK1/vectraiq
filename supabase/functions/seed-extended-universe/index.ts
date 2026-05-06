import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// Curated growth-themed seed list
// ~160 tickers across themes the user explicitly cares about:
// energy transition, AI/semis, robotics, biotech, fintech, space, etc.
//
// Each entry: ticker (US suffix or .ST/.OL/.HE/.CO for Nordic),
// name, asset_type, theme, risk_class, listing_date (if known recent IPO).
// ============================================================

interface SeedRow {
  ticker: string;
  name: string;
  asset_type: 'stock' | 'crypto' | 'metal' | 'fund';
  exchange: string;
  currency: string;
  sector?: string;
  theme: string;
  risk_class: string;
  listing_date?: string; // YYYY-MM-DD if known
}

const SEED: SeedRow[] = [
  // ─────── US: AI & SEMICONDUCTORS (growth theme) ───────
  { ticker: 'AVGO', name: 'Broadcom', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'ASML', name: 'ASML Holding', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'AMAT', name: 'Applied Materials', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'LRCX', name: 'Lam Research', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'KLAC', name: 'KLA Corp', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'MU', name: 'Micron Technology', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'MRVL', name: 'Marvell Technology', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'ARM', name: 'Arm Holdings', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth', listing_date: '2023-09-14' },
  { ticker: 'SMCI', name: 'Super Micro Computer', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'ANET', name: 'Arista Networks', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'CRDO', name: 'Credo Technology', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth', listing_date: '2022-01-27' },
  { ticker: 'PLTR', name: 'Palantir Technologies', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'SNOW', name: 'Snowflake', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'NET', name: 'Cloudflare', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'DDOG', name: 'Datadog', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'MDB', name: 'MongoDB', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'ai', risk_class: 'growth' },
  { ticker: 'CRWD', name: 'CrowdStrike', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'cybersecurity', risk_class: 'growth' },
  { ticker: 'ZS', name: 'Zscaler', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'cybersecurity', risk_class: 'growth' },
  { ticker: 'OKTA', name: 'Okta', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'cybersecurity', risk_class: 'growth' },
  { ticker: 'S', name: 'SentinelOne', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'cybersecurity', risk_class: 'growth' },

  // ─────── ENERGY TRANSITION & CLEANTECH ───────
  { ticker: 'ENPH', name: 'Enphase Energy', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'growth' },
  { ticker: 'FSLR', name: 'First Solar', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'growth' },
  { ticker: 'RUN', name: 'Sunrun', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'growth' },
  { ticker: 'NEE', name: 'NextEra Energy', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Utilities', theme: 'cleantech', risk_class: 'main' },
  { ticker: 'BE', name: 'Bloom Energy', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'high_risk' },
  { ticker: 'PLUG', name: 'Plug Power', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'high_risk' },
  { ticker: 'BLDP', name: 'Ballard Power', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'cleantech', risk_class: 'high_risk' },
  { ticker: 'CHPT', name: 'ChargePoint Holdings', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'EVGO', name: 'EVgo', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'QS', name: 'QuantumScape', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'energy_storage', risk_class: 'pre_revenue' },
  { ticker: 'FREY', name: 'FREYR Battery', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'energy_storage', risk_class: 'high_risk' },

  // ─────── NUCLEAR / SMR (small modular reactors) — closest to fusion theme ───────
  { ticker: 'CCJ', name: 'Cameco', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'main' },
  { ticker: 'BWXT', name: 'BWX Technologies', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'nuclear', risk_class: 'main' },
  { ticker: 'OKLO', name: 'Oklo Inc', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'pre_revenue', listing_date: '2024-05-10' },
  { ticker: 'SMR', name: 'NuScale Power', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'pre_revenue' },
  { ticker: 'NNE', name: 'Nano Nuclear Energy', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'pre_revenue', listing_date: '2024-05-08' },
  { ticker: 'UEC', name: 'Uranium Energy', asset_type: 'stock', exchange: 'AMEX', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'high_risk' },
  { ticker: 'DNN', name: 'Denison Mines', asset_type: 'stock', exchange: 'AMEX', currency: 'USD', sector: 'Energy', theme: 'nuclear', risk_class: 'high_risk' },
  { ticker: 'URA', name: 'Global X Uranium ETF', asset_type: 'fund', exchange: 'AMEX', currency: 'USD', theme: 'nuclear', risk_class: 'main' },

  // ─────── BIOTECH / HEALTHTECH / GLP-1 / ROBOTIC SURGERY ───────
  { ticker: 'ISRG', name: 'Intuitive Surgical', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'robotics', risk_class: 'main' },
  { ticker: 'ILMN', name: 'Illumina', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'MRNA', name: 'Moderna', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'growth' },
  { ticker: 'REGN', name: 'Regeneron Pharmaceuticals', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'VRTX', name: 'Vertex Pharmaceuticals', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'CRSP', name: 'CRISPR Therapeutics', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'pre_revenue' },
  { ticker: 'NTLA', name: 'Intellia Therapeutics', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'pre_revenue' },
  { ticker: 'BEAM', name: 'Beam Therapeutics', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'pre_revenue' },
  { ticker: 'EDIT', name: 'Editas Medicine', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'pre_revenue' },
  { ticker: 'NVO', name: 'Novo Nordisk', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'LLY', name: 'Eli Lilly', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'TMO', name: 'Thermo Fisher Scientific', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'DXCM', name: 'DexCom', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Healthcare', theme: 'healthtech', risk_class: 'growth' },

  // ─────── ROBOTICS / AUTOMATION ───────
  { ticker: 'IRBT', name: 'iRobot', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Industrials', theme: 'robotics', risk_class: 'high_risk' },
  { ticker: 'ABBNY', name: 'ABB Ltd ADR', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'robotics', risk_class: 'main' },
  { ticker: 'ROK', name: 'Rockwell Automation', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'robotics', risk_class: 'main' },
  { ticker: 'TER', name: 'Teradyne', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Industrials', theme: 'robotics', risk_class: 'main' },
  { ticker: 'BOTZ', name: 'Global X Robotics & AI ETF', asset_type: 'fund', exchange: 'NASDAQ', currency: 'USD', theme: 'robotics', risk_class: 'main' },

  // ─────── SPACE / DEFENSE ───────
  { ticker: 'LMT', name: 'Lockheed Martin', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'space', risk_class: 'main' },
  { ticker: 'RTX', name: 'RTX Corporation', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'space', risk_class: 'main' },
  { ticker: 'NOC', name: 'Northrop Grumman', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'space', risk_class: 'main' },
  { ticker: 'GD', name: 'General Dynamics', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Industrials', theme: 'space', risk_class: 'main' },
  { ticker: 'RKLB', name: 'Rocket Lab USA', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Industrials', theme: 'space', risk_class: 'high_risk' },
  { ticker: 'ASTS', name: 'AST SpaceMobile', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Communication Services', theme: 'space', risk_class: 'pre_revenue' },
  { ticker: 'IRDM', name: 'Iridium Communications', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Communication Services', theme: 'space', risk_class: 'main' },
  { ticker: 'PLTR', name: 'Palantir Technologies', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'space', risk_class: 'growth' },

  // ─────── FINTECH / CRYPTO INFRASTRUCTURE ───────
  { ticker: 'COIN', name: 'Coinbase Global', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'high_risk' },
  { ticker: 'SQ', name: 'Block (Square)', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'growth' },
  { ticker: 'PYPL', name: 'PayPal Holdings', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'main' },
  { ticker: 'AFRM', name: 'Affirm Holdings', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'high_risk' },
  { ticker: 'HOOD', name: 'Robinhood Markets', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'growth' },
  { ticker: 'MSTR', name: 'MicroStrategy', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', theme: 'fintech', risk_class: 'high_risk' },
  { ticker: 'MARA', name: 'Marathon Digital', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'high_risk' },
  { ticker: 'RIOT', name: 'Riot Platforms', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Financial Services', theme: 'fintech', risk_class: 'high_risk' },

  // ─────── EV / AUTONOMOUS ───────
  { ticker: 'NIO', name: 'NIO Inc', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Consumer Cyclical', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'RIVN', name: 'Rivian Automotive', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Consumer Cyclical', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'LCID', name: 'Lucid Group', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Consumer Cyclical', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'XPEV', name: 'XPeng', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Consumer Cyclical', theme: 'electrification', risk_class: 'high_risk' },
  { ticker: 'LI', name: 'Li Auto', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Consumer Cyclical', theme: 'electrification', risk_class: 'growth' },

  // ─────── CONSUMER GROWTH ───────
  { ticker: 'SHOP', name: 'Shopify', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'fintech', risk_class: 'growth' },
  { ticker: 'MELI', name: 'MercadoLibre', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Consumer Cyclical', theme: 'fintech', risk_class: 'growth' },
  { ticker: 'SE', name: 'Sea Limited', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Communication Services', theme: 'fintech', risk_class: 'growth' },
  { ticker: 'ABNB', name: 'Airbnb', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Consumer Cyclical', theme: 'consumer', risk_class: 'growth' },
  { ticker: 'DASH', name: 'DoorDash', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Consumer Cyclical', theme: 'consumer', risk_class: 'growth' },
  { ticker: 'UBER', name: 'Uber Technologies', asset_type: 'stock', exchange: 'NYSE', currency: 'USD', sector: 'Technology', theme: 'autonomous', risk_class: 'growth' },
  { ticker: 'ROKU', name: 'Roku', asset_type: 'stock', exchange: 'NASDAQ', currency: 'USD', sector: 'Communication Services', theme: 'consumer', risk_class: 'growth' },

  // ─────── NORDIC SMALL/MID CAPS — confirmed established tickers ───────
  { ticker: 'BIOTAGE.ST', name: 'Biotage', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'VITR.ST', name: 'Vitrolife', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'NCAB.ST', name: 'NCAB Group', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Industrials', theme: 'ai', risk_class: 'main' },
  { ticker: 'BICO.ST', name: 'BICO Group', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'biotech', risk_class: 'first_north' },
  { ticker: 'CINT.ST', name: 'Cint Group', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Communication Services', theme: 'ai', risk_class: 'first_north' },
  { ticker: 'MIPS.ST', name: 'MIPS', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Consumer Cyclical', theme: 'consumer', risk_class: 'main' },
  { ticker: 'XVIVO.ST', name: 'XVIVO Perfusion', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'healthtech', risk_class: 'main' },
  { ticker: 'KARO.ST', name: 'Karo Healthcare', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'biotech', risk_class: 'main' },
  { ticker: 'RAYS.ST', name: 'Raysearch Laboratories', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Healthcare', theme: 'healthtech', risk_class: 'main' },
  { ticker: 'BHG.ST', name: 'BHG Group', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Consumer Cyclical', theme: 'consumer', risk_class: 'main' },
  { ticker: 'STORY-B.ST', name: 'Storytel', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Communication Services', theme: 'consumer', risk_class: 'first_north' },
  { ticker: 'PROACT.ST', name: 'Proact IT Group', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'NIBE-B.ST', name: 'NIBE Industrier', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Industrials', theme: 'cleantech', risk_class: 'main' },
  { ticker: 'MYCR.ST', name: 'Mycronic', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'HEXA-B.ST', name: 'Hexagon', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Technology', theme: 'ai', risk_class: 'main' },
  { ticker: 'EQT.ST', name: 'EQT', asset_type: 'stock', exchange: 'Stockholm', currency: 'SEK', sector: 'Financial Services', theme: 'fintech', risk_class: 'main' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    let dryRun = false;
    let triggerFetch = true;
    try {
      const body = await req.json();
      dryRun = !!body?.dry_run;
      triggerFetch = body?.trigger_fetch !== false;
    } catch { /* no body */ }

    // Deduplicate by ticker
    const seen = new Set<string>();
    const uniqueSeed = SEED.filter(s => {
      if (seen.has(s.ticker)) return false;
      seen.add(s.ticker);
      return true;
    });

    // Find which tickers don't already exist
    const tickers = uniqueSeed.map(s => s.ticker);
    const { data: existing } = await sb
      .from('symbols')
      .select('ticker')
      .in('ticker', tickers);
    const existingSet = new Set((existing || []).map(s => s.ticker));

    const toInsert = uniqueSeed.filter(s => !existingSet.has(s.ticker));

    if (dryRun) {
      return new Response(JSON.stringify({
        total_in_seed: uniqueSeed.length,
        already_exist: existingSet.size,
        would_insert: toInsert.length,
        themes_summary: countByField(toInsert, 'theme'),
        risk_classes_summary: countByField(toInsert, 'risk_class'),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Insert as is_active=false (will be activated when initial data fetch succeeds)
    let inserted = 0;
    for (const seed of toInsert) {
      const { error } = await sb.from('symbols').insert({
        ticker: seed.ticker,
        name: seed.name,
        asset_type: seed.asset_type,
        exchange: seed.exchange,
        currency: seed.currency,
        sector: seed.sector || null,
        risk_class: seed.risk_class,
        theme: seed.theme,
        listing_date: seed.listing_date || null,
        is_active: false,
      });
      if (!error) inserted++;
      else console.error(`Insert failed for ${seed.ticker}:`, error.message);
    }

    // Backfill risk_class on existing tickers we know about
    let updated = 0;
    for (const seed of uniqueSeed.filter(s => existingSet.has(s.ticker))) {
      const { error } = await sb
        .from('symbols')
        .update({
          risk_class: seed.risk_class,
          theme: seed.theme,
          listing_date: seed.listing_date || null,
        })
        .eq('ticker', seed.ticker);
      if (!error) updated++;
    }

    // Optionally trigger initial data fetch for new tickers
    let fetchTriggered = 0;
    if (triggerFetch && toInsert.length > 0) {
      // Fire-and-forget calls to fetch-history + fetch-prices for new tickers
      // Throttle to avoid hammering APIs (process in chunks of 10)
      const newTickers = toInsert.map(s => s.ticker);
      for (let i = 0; i < newTickers.length; i += 10) {
        const chunk = newTickers.slice(i, i + 10);
        try {
          await fetch(`${supabaseUrl}/functions/v1/fetch-history`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tickers: chunk }),
          });
          fetchTriggered += chunk.length;
        } catch (e) {
          console.error(`Failed to trigger fetch for chunk ${i}:`, e);
        }
        await new Promise(r => setTimeout(r, 500)); // 500ms between chunks
      }
    }

    return new Response(JSON.stringify({
      total_in_seed: uniqueSeed.length,
      inserted,
      updated_existing: updated,
      fetch_triggered: fetchTriggered,
      next_step: 'Wait ~5min for fetch-history to complete, then symbols become active automatically.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function countByField(rows: SeedRow[], field: keyof SeedRow): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[field] || 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
