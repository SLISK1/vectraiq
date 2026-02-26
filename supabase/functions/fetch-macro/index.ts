import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MacroSeries {
  key: string;
  value: number;
  unit: string;
  source_url: string;
}

// Fetch Riksbanken policy rate
async function fetchRiksbankenRate(): Promise<MacroSeries | null> {
  try {
    // Riksbanken SWEA API - policy rate (SECBREPOEFF)
    const res = await fetch(
      'https://api.riksbank.se/swea/v1/Observations/SECBREPOEFF/Latest',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Response: { seriesId, date, value }
    const value = parseFloat(data?.value ?? data?.[0]?.value);
    if (isNaN(value)) throw new Error('Invalid value');
    return {
      key: 'riksbank_rate',
      value,
      unit: '%',
      source_url: 'https://api.riksbank.se/swea/v1/Observations/SECBREPOEFF/Latest',
    };
  } catch (e) {
    console.error('Riksbanken fetch error:', e);
    return null;
  }
}

// Fetch SCB CPIF inflation
async function fetchSCBInflation(): Promise<MacroSeries | null> {
  try {
    // SCB API: CPIF (fast prisindex med fast ränta) - KPI serien
    const body = {
      query: [
        { code: 'ContentsCode', selection: { filter: 'item', values: ['000004VU'] } }, // CPIF 12-month change
        { code: 'Tid', selection: { filter: 'top', values: ['1'] } },
      ],
      response: { format: 'json' },
    };
    
    const res = await fetch('https://api.scb.se/OV0104/v1/doris/sv/ssd/PR/PR0101/PR0101A/KPIfastmobile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const value = parseFloat(data?.data?.[0]?.values?.[0]);
    if (isNaN(value)) throw new Error('Invalid CPIF value');
    
    return {
      key: 'scb_cpif',
      value,
      unit: '%',
      source_url: 'https://api.scb.se/OV0104/v1/doris/sv/ssd/PR/PR0101/PR0101A/KPIfastmobile',
    };
  } catch (e) {
    console.error('SCB inflation fetch error:', e);
    return null;
  }
}

// Fetch ECB key rate
async function fetchECBRate(): Promise<MacroSeries | null> {
  try {
    // ECB Statistical Data Warehouse - Main Refinancing Rate
    const res = await fetch(
      'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?lastNObservations=1&format=jsondata',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const observations = data?.dataSets?.[0]?.series?.['0:0:0:0:0:0:0']?.observations;
    if (!observations) throw new Error('No observations');
    const lastKey = Object.keys(observations).sort().pop();
    if (!lastKey) throw new Error('No observation keys');
    const value = parseFloat(observations[lastKey][0]);
    if (isNaN(value)) throw new Error('Invalid ECB value');
    
    return {
      key: 'ecb_rate',
      value,
      unit: '%',
      source_url: 'https://data-api.ecb.europa.eu',
    };
  } catch (e) {
    console.error('ECB rate fetch error:', e);
    return null;
  }
}

// Fetch USD/SEK rate from Yahoo Finance as proxy for SEK strength
async function fetchSEKStrength(): Promise<MacroSeries | null> {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/USDSEK=X?interval=1d&range=1mo',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: number | null) => c != null);
    if (!closes || closes.length < 2) throw new Error('No close data');
    
    // Return 30-day % change in USD/SEK (negative = stronger SEK)
    const change = (closes[closes.length - 1] / closes[0] - 1) * 100;
    // Normalize to -1 to 1: negative USDSEK change = stronger SEK (positive for us)
    const normalized = Math.max(-1, Math.min(1, -change / 10));
    
    return {
      key: 'sek_strength',
      value: normalized,
      unit: 'normalized',
      source_url: 'https://finance.yahoo.com/quote/USDSEK=X',
    };
  } catch (e) {
    console.error('SEK strength fetch error:', e);
    return null;
  }
}

// Fetch Swedish GDP growth estimate (quarterly, from SCB)
async function fetchSCBGDP(): Promise<MacroSeries | null> {
  try {
    const body = {
      query: [
        { code: 'ContentsCode', selection: { filter: 'item', values: ['0000002T'] } }, // GDP year-on-year change
        { code: 'Tid', selection: { filter: 'top', values: ['1'] } },
      ],
      response: { format: 'json' },
    };
    
    const res = await fetch('https://api.scb.se/OV0104/v1/doris/sv/ssd/NR/NR0103/NR0103A/NR0103ENS2010T01Kv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const value = parseFloat(data?.data?.[0]?.values?.[0]);
    if (isNaN(value)) throw new Error('Invalid GDP value');
    
    return {
      key: 'scb_gdp_growth',
      value,
      unit: '%',
      source_url: 'https://api.scb.se',
    };
  } catch (e) {
    console.error('SCB GDP fetch error:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!authHeader?.startsWith('Bearer ') || authHeader !== `Bearer ${supabaseServiceKey}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    
    console.log('fetch-macro: starting at', now.toISOString());

    // Fetch all macro series in parallel
    const [riksbankenRate, scbInflation, ecbRate, sekStrength, scbGDP] = await Promise.allSettled([
      fetchRiksbankenRate(),
      fetchSCBInflation(),
      fetchECBRate(),
      fetchSEKStrength(),
      fetchSCBGDP(),
    ]);

    const results: MacroSeries[] = [];
    
    for (const result of [riksbankenRate, scbInflation, ecbRate, sekStrength, scbGDP]) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }

    // Upsert into macro_cache
    const validUntil = new Date(now);
    validUntil.setDate(validUntil.getDate() + 7); // 1 week TTL

    let updatedCount = 0;
    for (const series of results) {
      const { error } = await supabase
        .from('macro_cache')
        .upsert({
          series_key: series.key,
          value: series.value,
          unit: series.unit,
          source_url: series.source_url,
          fetched_at: now.toISOString(),
          valid_until: validUntil.toISOString(),
        }, { onConflict: 'series_key' });
      
      if (error) {
        console.error(`Error upserting ${series.key}:`, error);
      } else {
        updatedCount++;
        console.log(`Updated ${series.key}: ${series.value}${series.unit}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      updated: updatedCount,
      total_attempted: 5,
      series: results.map(r => ({ key: r.key, value: r.value, unit: r.unit })),
      timestamp: now.toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('fetch-macro error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
