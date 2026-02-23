import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { symbol_id, ticker, asset_type, side, amount_type, amount, portfolio_id, action } = body;

    // Handle reset action
    if (action === "reset") {
      const { data: portfolio } = await supabase
        .from("paper_portfolios")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (portfolio) {
        await supabase.from("paper_holdings").delete().eq("portfolio_id", portfolio.id);
        await supabase.from("paper_trades").delete().eq("portfolio_id", portfolio.id);
        await supabase.from("paper_portfolio_snapshots").delete().eq("portfolio_id", portfolio.id);
        await supabase.from("paper_portfolios").delete().eq("id", portfolio.id);
      }

      return new Response(JSON.stringify({ success: true, message: "Portfolio reset" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate input
    if (!symbol_id || !ticker || !side || !amount_type || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!["buy", "sell"].includes(side)) {
      return new Response(JSON.stringify({ error: "Invalid side" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!["cash", "qty"].includes(amount_type)) {
      return new Response(JSON.stringify({ error: "Invalid amount_type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (Number(amount) <= 0) {
      return new Response(JSON.stringify({ error: "Amount must be positive" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get latest price — try raw_prices first, fallback to price_history
    let price: number | null = null;

    const { data: priceData } = await supabase
      .from("raw_prices")
      .select("price")
      .eq("symbol_id", symbol_id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priceData) {
      price = Number(priceData.price);
    } else {
      // Fallback to price_history (close_price)
      const { data: histData } = await supabase
        .from("price_history")
        .select("close_price")
        .eq("symbol_id", symbol_id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (histData) {
        price = Number(histData.close_price);
        console.log(`Using price_history fallback for ${ticker}: ${price}`);
      }
    }

    if (!price) {
      return new Response(JSON.stringify({ error: "No price available for this symbol" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get or create portfolio
    let { data: portfolio } = await supabase
      .from("paper_portfolios")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!portfolio) {
      const { data: newPortfolio, error: createErr } = await supabase
        .from("paper_portfolios")
        .insert({ user_id: user.id })
        .select()
        .single();
      if (createErr) throw createErr;
      portfolio = newPortfolio;
    }

    let qty: number;
    let notional: number;
    let fee: number;

    if (amount_type === "cash") {
      notional = Number(amount);
      fee = notional * 0.001;
      qty = (notional - fee) / price;
    } else {
      qty = Number(amount);
      notional = qty * price;
      fee = notional * 0.001;
    }

    // Round qty to 6 decimals
    qty = Math.round(qty * 1e6) / 1e6;
    notional = Math.round(notional * 100) / 100;
    fee = Math.round(fee * 100) / 100;

    if (side === "buy") {
      const totalCost = notional + fee;
      if (Number(portfolio.cash_balance) < totalCost) {
        return new Response(JSON.stringify({ error: "Insufficient cash", available: portfolio.cash_balance, required: totalCost }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Update cash
      await supabase
        .from("paper_portfolios")
        .update({ cash_balance: Number(portfolio.cash_balance) - totalCost })
        .eq("id", portfolio.id);

      // Upsert holding (weighted avg cost)
      const { data: existingHolding } = await supabase
        .from("paper_holdings")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .eq("symbol_id", symbol_id)
        .single();

      if (existingHolding) {
        const oldQty = Number(existingHolding.qty);
        const oldAvg = Number(existingHolding.avg_cost);
        const newQty = oldQty + qty;
        const newAvg = (oldAvg * oldQty + price * qty) / newQty;
        await supabase
          .from("paper_holdings")
          .update({ qty: newQty, avg_cost: Math.round(newAvg * 100) / 100, updated_at: new Date().toISOString() })
          .eq("id", existingHolding.id);
      } else {
        await supabase
          .from("paper_holdings")
          .insert({ user_id: user.id, portfolio_id: portfolio.id, symbol_id, ticker, qty, avg_cost: price, updated_at: new Date().toISOString() });
      }
    } else {
      // Sell
      const { data: holding } = await supabase
        .from("paper_holdings")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .eq("symbol_id", symbol_id)
        .single();

      if (!holding || Number(holding.qty) < qty) {
        return new Response(JSON.stringify({ error: "Insufficient holdings", available: holding?.qty || 0, requested: qty }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const proceeds = notional - fee;
      await supabase
        .from("paper_portfolios")
        .update({ cash_balance: Number(portfolio.cash_balance) + proceeds })
        .eq("id", portfolio.id);

      const newQty = Number(holding.qty) - qty;
      if (newQty < 0.000001) {
        await supabase.from("paper_holdings").delete().eq("id", holding.id);
      } else {
        await supabase
          .from("paper_holdings")
          .update({ qty: newQty, updated_at: new Date().toISOString() })
          .eq("id", holding.id);
      }
    }

    // Record trade
    await supabase.from("paper_trades").insert({
      user_id: user.id,
      portfolio_id: portfolio.id,
      symbol_id,
      ticker,
      asset_type: asset_type || "stock",
      side,
      qty,
      price,
      fee,
      notional,
    });

    // Create snapshot
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

    const { data: updatedPortfolio } = await supabase
      .from("paper_portfolios")
      .select("*")
      .eq("id", portfolio.id)
      .single();

    const cashBalance = Number(updatedPortfolio?.cash_balance || 0);
    const totalValue = cashBalance + holdingsValue;
    const startingCash = Number(updatedPortfolio?.starting_cash || 100000);
    const pnlTotal = totalValue - startingCash;
    const pnlPct = startingCash > 0 ? (pnlTotal / startingCash) * 100 : 0;

    await supabase.from("paper_portfolio_snapshots").insert({
      user_id: user.id,
      portfolio_id: portfolio.id,
      cash_balance: cashBalance,
      holdings_value: holdingsValue,
      total_value: totalValue,
      pnl_total: Math.round(pnlTotal * 100) / 100,
      pnl_pct: Math.round(pnlPct * 100) / 100,
    });

    return new Response(JSON.stringify({
      success: true,
      trade: { side, ticker, qty, price, fee, notional },
      portfolio: { cash_balance: cashBalance, holdings_value: holdingsValue, total_value: totalValue, pnl_total: pnlTotal, pnl_pct: pnlPct },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("paper-trade error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
