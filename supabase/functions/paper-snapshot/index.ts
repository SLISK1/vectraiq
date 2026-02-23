import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all portfolios
    const { data: portfolios, error } = await supabase
      .from("paper_portfolios")
      .select("*");

    if (error) throw error;
    if (!portfolios || portfolios.length === 0) {
      return new Response(JSON.stringify({ message: "No portfolios to snapshot" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let snapshotCount = 0;

    for (const portfolio of portfolios) {
      const { data: holdings } = await supabase
        .from("paper_holdings")
        .select("symbol_id, qty")
        .eq("portfolio_id", portfolio.id);

      let holdingsValue = 0;
      if (holdings && holdings.length > 0) {
        for (const h of holdings) {
          const { data: p } = await supabase
            .from("raw_prices")
            .select("price")
            .eq("symbol_id", h.symbol_id)
            .order("recorded_at", { ascending: false })
            .limit(1)
            .single();
          if (p) holdingsValue += Number(h.qty) * Number(p.price);
        }
      }

      const cashBalance = Number(portfolio.cash_balance);
      const totalValue = cashBalance + holdingsValue;
      const startingCash = Number(portfolio.starting_cash);
      const pnlTotal = totalValue - startingCash;
      const pnlPct = startingCash > 0 ? (pnlTotal / startingCash) * 100 : 0;

      await supabase.from("paper_portfolio_snapshots").insert({
        user_id: portfolio.user_id,
        portfolio_id: portfolio.id,
        cash_balance: cashBalance,
        holdings_value: holdingsValue,
        total_value: totalValue,
        pnl_total: Math.round(pnlTotal * 100) / 100,
        pnl_pct: Math.round(pnlPct * 100) / 100,
      });

      snapshotCount++;
    }

    return new Response(JSON.stringify({ success: true, snapshots: snapshotCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("paper-snapshot error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
