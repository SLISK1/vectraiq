import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { ticker } = await req.json();
    
    if (!ticker) {
      return new Response(JSON.stringify({ error: 'Ticker required' }), 
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    const cleanTicker = ticker.toUpperCase().trim();
    
    // Check if exists
    const { data: existing } = await supabase
      .from('symbols')
      .select('id, ticker')
      .eq('ticker', cleanTicker)
      .single();
    
    if (existing) {
      return new Response(JSON.stringify({ success: true, isNew: false, symbol: existing }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // Detect type
    const cryptos = ['BTC','ETH','SOL','XRP','ADA','AVAX','DOT','LINK','DOGE'];
    const metals = ['XAU','XAG','XPT','XPD'];
    let assetType: 'stock' | 'crypto' | 'metal' | 'fund' = 'stock';
    if (cryptos.includes(cleanTicker)) assetType = 'crypto';
    else if (metals.includes(cleanTicker)) assetType = 'metal';
    
    const currency = assetType === 'crypto' ? 'USD' : 'USD';
    
    // Insert
    const { data: newSymbol, error } = await supabase
      .from('symbols')
      .insert({ ticker: cleanTicker, name: cleanTicker, asset_type: assetType, currency, is_active: true })
      .select()
      .single();
    
    if (error) {
      return new Response(JSON.stringify({ error: 'Insert failed', details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // Trigger data fetch
    fetch(`${supabaseUrl}/functions/v1/fetch-history`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: [cleanTicker], days: 60 }),
    }).catch(() => {});
    
    return new Response(JSON.stringify({ success: true, isNew: true, symbol: newSymbol, detectedType: assetType }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});