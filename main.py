#!/usr/bin/env python3
"""
Betting system CLI.

Commands:
  batch                   Daily batch: fetch fixtures + stats, update norms
  recommend [--hours N]   Generate recommendations for upcoming matches
  record <rec_id> won|lost  Record outcome and update calibration
  train                   Retrain ChaosScore weights (weekly)
  status                  Show bankroll + calibration phase + pending bets
  init                    Initialise database (first run)

Usage:
  python main.py init
  python main.py batch
  python main.py recommend
  python main.py record abc123 won
  python main.py train
  python main.py status

Environment variables required:
  FOOTBALL_API_KEY   — api-football.com (RapidAPI) key
  FIRECRAWL_API_KEY  — optional; enables derby/referee/odds enrichment
"""
import argparse
import json
import logging
import math
import sys
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import config
from db import database as db
from data import fetcher
from data import firecrawl_client as fc
from scoring.normalizer import LeagueNormalizer, compute_and_store_league_norms
from scoring.subscores import compute_subscores
from scoring.probability import compute_all_p_raw
from calibration.calibrator import calibrate, update_buckets, get_calibration_phase
from betting.edge import build_leg
from betting.leg_selector import chaos_gates_pass, select_legs, combined_odds, parlay_p_estimate
from betting.bankroll import can_place_bet, register_stake, daily_summary
from training.weight_learner import train_weights, get_current_weights

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# INIT
# ─────────────────────────────────────────────────────────────────────────────

def cmd_init():
    db.init_db()
    print("✓ Database initialised at", config.DB_PATH)


# ─────────────────────────────────────────────────────────────────────────────
# BATCH
# ─────────────────────────────────────────────────────────────────────────────

def cmd_batch():
    """
    Daily batch (run once per day, e.g. via cron at 06:00).

    Per league:
      1. Fetch finished fixtures → build / refresh team stats
      2. Fetch upcoming fixtures → store in DB
      3. Compute league normalization params

    API calls per league: ~2 (finished + upcoming fixtures).
    Total for 6 leagues: ~12 calls.  Well within free-tier 100 calls/day.
    """
    print(f"Starting daily batch for {len(config.LEAGUES)} leagues…")

    for league in config.LEAGUES:
        lid  = league["id"]
        name = league["name"]
        season = league["season"]

        print(f"\n── {name} (id={lid}) ──────────────────────")

        # 1. Finished fixtures → team stats
        print("  Fetching finished fixtures…", end=" ", flush=True)
        finished = fetcher.fetch_finished_fixtures(lid, season)
        for f in finished:
            db.upsert_fixture(f)
        print(f"{len(finished)} fixtures")

        print("  Building team stats…", end=" ", flush=True)
        team_stats = fetcher.build_team_stats_from_fixtures(lid, season)
        for ts in team_stats:
            db.upsert_team_stats(ts)
        print(f"{len(team_stats)} teams updated")

        # 2. Upcoming fixtures
        print("  Fetching upcoming fixtures…", end=" ", flush=True)
        upcoming = fetcher.fetch_upcoming_fixtures(lid, season, next_n=20)
        for f in upcoming:
            db.upsert_fixture(f)
        print(f"{len(upcoming)} fixtures cached")

        # 3. League norms
        print("  Computing league norms…", end=" ", flush=True)
        compute_and_store_league_norms(lid, season)
        print("done")

    print("\n✓ Batch complete")


# ─────────────────────────────────────────────────────────────────────────────
# RECOMMEND
# ─────────────────────────────────────────────────────────────────────────────

def cmd_recommend(hours_ahead: int = 36, manual_odds: bool = False):
    """
    Evaluate upcoming fixtures and print recommendation(s).

    Flow per match:
      1. Load team stats + league norms
      2. Compute subscores
      3. Phase-1 ChaosScore gate
      4. Compute p_raw per market
      5. Calibrate → p_cal
      6. Compute edge per market
      7. Correlation filter + leg selection
      8. Bankroll check
      9. Output recommendation (ask user for odds if manual_odds=True)
     10. Save to DB

    Auto mode (default): uses Firecrawl for odds.  Falls back to manual prompt
    if Firecrawl is unavailable or returns null odds.
    """
    fixtures = db.get_upcoming_fixtures(hours_ahead)
    if not fixtures:
        print("No upcoming fixtures found.  Run 'batch' first.")
        return

    weights = get_current_weights()
    bankroll_ok, br_reason = can_place_bet()
    if not bankroll_ok:
        print(f"\n⛔  Bankroll gate: {br_reason}")
        return

    recommendations_made = 0

    for fix in fixtures:
        fixture_id   = fix["fixture_id"]
        league_id    = int(fix["league_id"])
        season       = int(fix["season"])
        home_id      = fix["home_team_id"]
        away_id      = fix["away_team_id"]
        home_name    = fix.get("home_team_name", home_id)
        away_name    = fix.get("away_team_name", away_id)
        kickoff      = fix["kickoff"]

        # Load team stats
        home_stats = db.get_team_stats(home_id, league_id, season)
        away_stats = db.get_team_stats(away_id, league_id, season)
        if not home_stats or not away_stats:
            logger.debug("Missing stats for %s vs %s — skipping", home_name, away_name)
            continue

        # League normalizer
        norm = LeagueNormalizer(league_id, season)

        # Optional Firecrawl enrichment
        derby_bonus    = config.DERBY_BONUS    if fc.is_derby(fixture_id, home_name, away_name, league_id) else 0.0
        referee_bonus  = config.REFEREE_BONUS  if fc.referee_high_cards(fixture_id, "") else 0.0

        # Subscores
        sc = compute_subscores(home_stats, away_stats, norm,
                               derby_bonus, referee_bonus, weights)

        # --- ChaosScore gate (use min phase across all markets as conservative) ---
        # Determine dominant phase (most markets in phase 1 = use phase 1 gates)
        markets = ["btts", "o25", "corners_o95", "cards_o35"]
        min_phase = min(get_calibration_phase(m) for m in markets)

        passes, reason = chaos_gates_pass(sc, min_phase)
        if not passes:
            logger.debug("%s vs %s filtered: %s", home_name, away_name, reason)
            continue

        # --- p_raw per market ---
        p_raws = compute_all_p_raw(home_stats, away_stats, norm)

        # --- Get odds (Firecrawl auto → manual fallback) ---
        odds_data = fc.get_odds_snapshot(fixture_id, home_name, away_name)
        if not odds_data:
            if manual_odds:
                odds_data = _prompt_odds(home_name, away_name)
            else:
                logger.info(
                    "%s vs %s: pass ChaosScore gate but no odds available. "
                    "Re-run with --manual for manual odds entry.", home_name, away_name
                )
                _print_match_alert(fix, sc)
                continue

        # --- Build candidate legs ---
        rec_id = str(uuid.uuid4())
        candidate_legs = []
        for market in markets:
            p_raw_val = p_raws.get(market)
            odds_val  = odds_data.get(market) if odds_data else None

            if p_raw_val is None or odds_val is None:
                continue

            cal = calibrate(p_raw_val, market)
            leg = build_leg(
                fixture_id=fixture_id,
                rec_id=rec_id,
                market=market,
                odds=float(odds_val),
                p_raw=p_raw_val,
                cal_result=cal,
                line={"corners_o95": 9.5, "cards_o35": 3.5, "o25": 2.5}.get(market),
            )
            if leg:
                candidate_legs.append(leg)

        # --- Correlation filter + leg selection ---
        selected_legs, sel_reason = select_legs(candidate_legs, sc)
        if not selected_legs:
            logger.debug("%s vs %s: no legs survive selection (%s)",
                         home_name, away_name, sel_reason)
            continue

        # --- Bankroll check ---
        stake = config.UNIT_STAKE
        bankroll_ok, br_reason = can_place_bet(stake)
        if not bankroll_ok:
            print(f"\n⛔  {br_reason}")
            break

        # --- Build recommendation ---
        c_odds    = combined_odds(selected_legs)
        p_parlay  = parlay_p_estimate(selected_legs)
        payout    = round(stake * c_odds, 2)

        rec = {
            "rec_id":          rec_id,
            "fixture_id":      fixture_id,
            "goal_chaos":      sc.goal_chaos,
            "corner_pressure": sc.corner_pressure,
            "card_heat":       sc.card_heat,
            "volatility":      sc.volatility,
            "chaos_score":     sc.chaos_score,
            "legs_json":       json.dumps(selected_legs),
            "combined_odds":   round(c_odds, 2),
            "stake":           stake,
            "potential_payout": payout,
        }

        # --- Save ---
        db.save_recommendation(rec)
        for leg in selected_legs:
            leg["rec_id"] = rec_id
            db.save_leg(leg)
        register_stake(stake)

        # --- Print ---
        _print_recommendation(fix, sc, selected_legs, c_odds, p_parlay, stake, payout, rec_id)
        recommendations_made += 1

    if recommendations_made == 0:
        print("No recommendations generated.")
    else:
        print(f"\n✓ {recommendations_made} recommendation(s) generated.")

    _print_bankroll_footer()


def _prompt_odds(home: str, away: str) -> dict:
    print(f"\n  Enter decimal odds for {home} vs {away}")
    print("  (press Enter to skip a market)")
    result = {}
    for market, label in [
        ("btts", "Both Teams Score (Yes)"),
        ("o25", "Over 2.5 Goals"),
        ("corners_o95", "Over 9.5 Corners"),
        ("cards_o35", "Over 3.5 Cards"),
    ]:
        val = input(f"  {label}: ").strip()
        if val:
            try:
                result[market] = float(val)
            except ValueError:
                pass
    return result or None


def _print_match_alert(fix: dict, sc):
    print(
        f"\n🔔  ALERT: {fix.get('home_team_name')} vs {fix.get('away_team_name')} "
        f"[{fix['kickoff'][:16]}]\n"
        f"    ChaosScore={sc.chaos_score}  "
        f"GC={sc.goal_chaos}  "
        f"CP={sc.corner_pressure}  "
        f"CH={sc.card_heat}  "
        f"V={sc.volatility}\n"
        f"    → passes gates but odds unavailable. "
        f"Run 'recommend --manual' to enter odds."
    )


def _print_recommendation(fix, sc, legs, c_odds, p_parlay, stake, payout, rec_id):
    home = fix.get("home_team_name", fix["home_team_id"])
    away = fix.get("away_team_name", fix["away_team_id"])
    ko   = fix["kickoff"][:16]

    print(f"\n{'═'*60}")
    print(f"  BET: {home} vs {away}")
    print(f"  Kickoff: {ko}")
    print(f"  ChaosScore: {sc.chaos_score}  "
          f"GC={sc.goal_chaos}  CP={sc.corner_pressure}  "
          f"CH={sc.card_heat}  V={sc.volatility}")
    print()

    MARKET_LABELS = {
        "btts":        "BTTS (Yes)",
        "o25":         "Over 2.5 Goals",
        "corners_o95": "Over 9.5 Corners",
        "cards_o35":   "Over 3.5 Cards",
    }
    phase_labels = {1: "pre-cal", 2: "partial", 3: "calibrated"}

    for leg in legs:
        m = leg["market"]
        print(
            f"  ✓ {MARKET_LABELS.get(m, m):22s}  "
            f"odds={leg['odds']:.2f}  "
            f"p_cal={leg['p_cal']:.3f}  "
            f"edge={leg['edge']:+.3f}  "
            f"[{phase_labels[leg['calibration_phase']]}]"
        )

    print()
    print(f"  Combined odds : {c_odds:.2f}")
    print(f"  p_parlay est. : {p_parlay:.3f}")
    print(f"  Stake         : {stake:.0f} kr")
    print(f"  Potential win : {payout:.0f} kr")
    print(f"  rec_id        : {rec_id}")
    print()
    print(f"  To record result: python main.py record {rec_id} won|lost")
    print(f"{'═'*60}")


def _print_bankroll_footer():
    s = daily_summary()
    print(
        f"\n  Bankroll today: {s['balance']:.0f} kr  |  "
        f"Used {s['stake_used']:.0f}/{config.MAX_DAILY_STAKE:.0f} kr  |  "
        f"{s['coupons_placed']}/{config.MAX_DAILY_COUPONS} coupons"
    )


# ─────────────────────────────────────────────────────────────────────────────
# RECORD OUTCOME
# ─────────────────────────────────────────────────────────────────────────────

def cmd_record(rec_id: str, result: str):
    result = result.lower().strip()
    if result not in ("won", "lost"):
        print("Result must be 'won' or 'lost'")
        sys.exit(1)

    won = result == "won"
    pnl = db.record_outcome(rec_id, won)

    # Update calibration buckets for each resolved leg
    with db.get_db() as conn:
        legs = conn.execute(
            "SELECT market, p_raw FROM recommendation_legs WHERE rec_id=?",
            (rec_id,),
        ).fetchall()
    for leg in legs:
        update_buckets(leg["market"], leg["p_raw"], won)

    emoji = "✓" if won else "✗"
    print(f"{emoji}  {rec_id[:8]}…  {'WON' if won else 'LOST'}  PnL: {pnl:+.0f} kr")
    _print_bankroll_footer()


# ─────────────────────────────────────────────────────────────────────────────
# TRAIN
# ─────────────────────────────────────────────────────────────────────────────

def cmd_train():
    print("Training ChaosScore weights on Y_3of4…")
    weights = train_weights()
    if weights:
        print("New weights:", json.dumps(weights, indent=2))
    else:
        print("Training skipped (insufficient data).  v0 weights remain active.")


# ─────────────────────────────────────────────────────────────────────────────
# STATUS
# ─────────────────────────────────────────────────────────────────────────────

def cmd_status():
    from db import database as db

    # Bankroll
    s = daily_summary()
    print(f"\n{'─'*50}")
    print(f"  BANKROLL")
    print(f"  Balance today : {s['balance']:.0f} kr")
    print(f"  Opening       : {s['opening_balance']:.0f} kr")
    print(f"  Stake used    : {s['stake_used']:.0f} / {config.MAX_DAILY_STAKE:.0f} kr")
    print(f"  Coupons today : {s['coupons_placed']} / {config.MAX_DAILY_COUPONS}")
    print(f"{'─'*50}")

    # Calibration phase per market
    print(f"\n  CALIBRATION PHASES")
    markets = ["btts", "o25", "corners_o95", "cards_o35"]
    for m in markets:
        n     = db.get_market_total_bets(m)
        phase = get_calibration_phase(m)
        bar   = "█" * min(n // 10, 20)
        print(f"  {m:15s}  N={n:4d}  Phase {phase}  {bar}")

    # Pending recommendations
    pending = db.get_pending_recommendations()
    if pending:
        print(f"\n  PENDING BETS ({len(pending)})")
        for rec in pending:
            print(
                f"  {rec['rec_id'][:8]}…  "
                f"odds={rec['combined_odds']:.2f}  "
                f"stake={rec['stake']:.0f} kr  "
                f"chaos={rec['chaos_score']}"
            )
    else:
        print("\n  No pending bets.")

    # Active weights
    w_row = db.get_latest_chaos_weights()
    print(f"\n  CHAOS WEIGHTS")
    if w_row:
        w = w_row["weights"]
        print(f"  (v{w_row['version']}, trained on {w_row['n_samples']} samples, "
              f"acc={w_row.get('train_accuracy', 0):.3f})")
        for k, v in w.items():
            print(f"    {k:20s}: {v:.4f}")
    else:
        print("  (v0 heuristic — no training data yet)")
        for k, v in config.CHAOS_WEIGHTS_V0.items():
            print(f"    {k:20s}: {v:.4f}")
    print()


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Betting system — robust, edge-based parlay recommendations",
    )
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("init",   help="Initialise database (first run)")
    sub.add_parser("batch",  help="Daily data fetch + stats update")
    sub.add_parser("train",  help="Retrain ChaosScore weights (weekly)")
    sub.add_parser("status", help="Bankroll + calibration + pending bets")

    rec_p = sub.add_parser("recommend", help="Generate recommendations")
    rec_p.add_argument("--hours", type=int, default=36,
                       help="Look ahead window in hours (default 36)")
    rec_p.add_argument("--manual", action="store_true",
                       help="Prompt for odds manually if Firecrawl unavailable")

    rec_cmd = sub.add_parser("record", help="Record bet outcome")
    rec_cmd.add_argument("rec_id")
    rec_cmd.add_argument("result", choices=["won", "lost"])

    args = parser.parse_args()

    if args.cmd == "init":
        cmd_init()
    elif args.cmd == "batch":
        cmd_batch()
    elif args.cmd == "recommend":
        cmd_recommend(hours_ahead=args.hours, manual_odds=args.manual)
    elif args.cmd == "record":
        cmd_record(args.rec_id, args.result)
    elif args.cmd == "train":
        cmd_train()
    elif args.cmd == "status":
        cmd_status()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
