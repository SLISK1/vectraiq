import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clamp = (v: number, min = 0.01, max = 0.99) => Math.min(max, Math.max(min, v));
const geomean = (a: number, b: number) => Math.sqrt(Math.max(0, a) * Math.max(0, b));

// Poisson PMF
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Score matrix up to MAX_GOALS x MAX_GOALS
function scoreMatrix(lh: number, la: number, maxGoals = 6): number[][] {
  const homePmf: number[] = [];
  const awayPmf: number[] = [];
  for (let i = 0; i <= maxGoals; i++) {
    homePmf.push(poissonPMF(i, lh));
    awayPmf.push(poissonPMF(i, la));
  }
  const m: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) row.push(homePmf[h] * awayPmf[a]);
    m.push(row);
  }
  // normalize to sum = 1 (truncation correction)
  let s = 0;
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) s += m[h][a];
  if (s > 0) for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) m[h][a] /= s;
  return m;
}

function summarize(matrix: number[][]) {
  let pHome = 0, pDraw = 0, pAway = 0;
  let pOver25 = 0, pBtts = 0;
  const exactScores: Array<{ selection: string; p: number }> = [];
  const N = matrix.length;
  for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      const p = matrix[h][a];
      if (h > a) pHome += p; else if (h < a) pAway += p; else pDraw += p;
      if (h + a > 2) pOver25 += p;
      if (h > 0 && a > 0) pBtts += p;
      exactScores.push({ selection: `${h}-${a}`, p });
    }
  }
  exactScores.sort((x, y) => y.p - x.p);
  return {
    p_home: clamp(pHome),
    p_draw: clamp(pDraw),
    p_away: clamp(pAway),
    p_1x: clamp(pHome + pDraw),
    p_12: clamp(pHome + pAway),
    p_x2: clamp(pDraw + pAway),
    p_over25_poisson: clamp(pOver25),
    p_btts_poisson: clamp(pBtts),
    exact_top: exactScores.slice(0, 5),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // === AUTH GUARD: require service-role key or valid user JWT ===
    {
      const _authHeader = req.headers.get('authorization') || '';
      const _token = _authHeader.replace(/^Bearer\s+/i, '');
      const _serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!_token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (_token !== _serviceKey) {
        try {
          const _authClient = (await import('npm:@supabase/supabase-js@2')).createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_ANON_KEY')!,
          );
          const { data: { user } } = await _authClient.auth.getUser(_token);
          if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        } catch {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

  try {
    const { match_id } = await req.json();
    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: match, error: matchError } = await supabase
      .from("betting_matches")
      .select("id,home_team,away_team,source_data")
      .eq("id", match_id)
      .single();

    if (matchError || !match) throw new Error(`Match not found: ${match_id}`);

    const sourceData = (match.source_data || {}) as Record<string, unknown>;
    const rates = {
      home_btts_rate: Number(sourceData.home_btts_rate ?? 0.5),
      away_btts_rate: Number(sourceData.away_btts_rate ?? 0.5),
      home_o25_rate: Number(sourceData.home_o25_rate ?? 0.5),
      away_o25_rate: Number(sourceData.away_o25_rate ?? 0.5),
      home_crn_o95_rate: Number(sourceData.home_crn_o95_rate ?? 0.5),
      away_crn_o95_rate: Number(sourceData.away_crn_o95_rate ?? 0.5),
      home_crd_o35_rate: Number(sourceData.home_crd_o35_rate ?? 0.5),
      away_crd_o35_rate: Number(sourceData.away_crd_o35_rate ?? 0.5),
    };

    const pRaw = {
      p_raw_btts: clamp(geomean(rates.home_btts_rate, rates.away_btts_rate)),
      p_raw_o25: clamp(geomean(rates.home_o25_rate, rates.away_o25_rate)),
      p_raw_crn_o95: clamp(geomean(rates.home_crn_o95_rate, rates.away_crn_o95_rate)),
      p_raw_crd_o35: clamp(geomean(rates.home_crd_o35_rate, rates.away_crd_o35_rate)),
    };

    // ── Poisson-based 1X2 / DC / EXACT ────────────────────────────────────
    // Use xG estimates from source_data if available, else derive from o25 rates.
    // Heuristic: combined goal expectation ≈ 1.6 + (p_o25 - 0.5) * 2 (clamped 1.5–3.4).
    const combinedFromO25 = 1.6 + (pRaw.p_raw_o25 - 0.5) * 2;
    const totalLambda = Math.max(1.5, Math.min(3.4, combinedFromO25));
    // Home/away split — favor home unless source_data signals otherwise.
    const homeAdv = Number(sourceData.home_advantage ?? 0.55);
    const lh = Number(sourceData.home_xg ?? totalLambda * homeAdv);
    const la = Number(sourceData.away_xg ?? totalLambda * (1 - homeAdv));
    const poisson = summarize(scoreMatrix(lh, la));

    const { error: upsertError } = await supabase.from("team_rates_cache").upsert({
      match_id,
      home_team: match.home_team,
      away_team: match.away_team,
      ...rates,
      ...pRaw,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({
      success: true,
      match_id,
      ...pRaw,
      poisson: {
        lambda_home: lh,
        lambda_away: la,
        ...poisson,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
