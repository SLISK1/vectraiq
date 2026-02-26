"""
SQLite connection helpers + CRUD used across the system.
All writes go through get_db() so WAL mode and FK enforcement are consistent.
"""
import sqlite3
import json
from contextlib import contextmanager
from pathlib import Path
from datetime import date, datetime
from typing import Any, Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
import config


@contextmanager
def get_db():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    schema = (Path(__file__).parent / "schema.sql").read_text()
    with get_db() as conn:
        conn.executescript(schema)


# ── API cache ─────────────────────────────────────────────────────────────────

def cache_get(key: str) -> Optional[Any]:
    with get_db() as conn:
        row = conn.execute(
            """SELECT response FROM api_cache
               WHERE cache_key = ?
                 AND datetime(fetched_at, '+' || ttl_seconds || ' seconds')
                     > datetime('now')""",
            (key,),
        ).fetchone()
    return json.loads(row["response"]) if row else None


def cache_set(key: str, data: Any, ttl: int = 3600):
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO api_cache (cache_key, response, ttl_seconds)
               VALUES (?, ?, ?)""",
            (key, json.dumps(data), ttl),
        )


# ── Team stats ────────────────────────────────────────────────────────────────

def upsert_team_stats(stats: dict):
    cols = [
        "team_id", "league_id", "season", "matches_played",
        "goals_for_avg", "goals_against_avg", "btts_rate", "over25_rate",
        "clean_sheet_rate", "failed_to_score_rate",
        "corners_for_avg", "corners_against_avg", "corners_over95_rate",
        "cards_for_avg", "cards_against_avg", "cards_over35_rate",
        "form_pts_avg", "form_pts_std", "draw_rate",
    ]
    vals = [stats.get(c) for c in cols]
    placeholders = ", ".join(["?"] * len(cols))
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in ("team_id", "league_id", "season"))
    with get_db() as conn:
        conn.execute(
            f"""INSERT INTO team_stats ({', '.join(cols)})
                VALUES ({placeholders})
                ON CONFLICT(team_id, league_id, season) DO UPDATE SET
                {updates}, updated_at = datetime('now')""",
            vals,
        )


def get_team_stats(team_id: str, league_id: int, season: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM team_stats WHERE team_id=? AND league_id=? AND season=?",
            (team_id, league_id, season),
        ).fetchone()
    return dict(row) if row else None


def get_league_team_stats(league_id: int, season: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM team_stats
               WHERE league_id=? AND season=? AND matches_played >= ?""",
            (league_id, season, config.MIN_TEAM_MATCHES),
        ).fetchall()
    return [dict(r) for r in rows]


# ── League norms ──────────────────────────────────────────────────────────────

def upsert_league_norm(league_id: int, season: int, metric: str,
                       mean: float, std: float, n_teams: int):
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO league_norms
               (league_id, season, metric, mean, std, n_teams)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (league_id, season, metric, mean, std, n_teams),
        )


def get_league_norms(league_id: int, season: int) -> dict[str, dict]:
    """Return {metric: {mean, std, n_teams}}."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM league_norms WHERE league_id=? AND season=?",
            (league_id, season),
        ).fetchall()
    return {r["metric"]: {"mean": r["mean"], "std": r["std"], "n_teams": r["n_teams"]}
            for r in rows}


# ── Fixtures ──────────────────────────────────────────────────────────────────

def upsert_fixture(f: dict):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO fixtures
               (fixture_id, league_id, season, home_team_id, away_team_id,
                home_team_name, away_team_name, kickoff, status)
               VALUES (:fixture_id, :league_id, :season, :home_team_id, :away_team_id,
                       :home_team_name, :away_team_name, :kickoff, :status)
               ON CONFLICT(fixture_id) DO UPDATE SET
               status = excluded.status,
               updated_at = datetime('now')""",
            f,
        )


def get_upcoming_fixtures(hours_ahead: int = 36) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM fixtures
               WHERE status = 'scheduled'
                 AND kickoff BETWEEN datetime('now') AND datetime('now', ? || ' hours')
               ORDER BY kickoff""",
            (hours_ahead,),
        ).fetchall()
    return [dict(r) for r in rows]


def record_fixture_result(fixture_id: str, home_goals: int, away_goals: int,
                          home_corners: Optional[int], away_corners: Optional[int],
                          home_cards: Optional[int], away_cards: Optional[int]):
    with get_db() as conn:
        conn.execute(
            """UPDATE fixtures SET
               home_goals=?, away_goals=?, home_corners=?, away_corners=?,
               home_cards=?, away_cards=?, status='finished', updated_at=datetime('now')
               WHERE fixture_id=?""",
            (home_goals, away_goals, home_corners, away_corners,
             home_cards, away_cards, fixture_id),
        )


def get_finished_fixtures(league_id: int, season: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM fixtures WHERE league_id=? AND season=? AND status='finished'",
            (league_id, season),
        ).fetchall()
    return [dict(r) for r in rows]


# ── Recommendations ───────────────────────────────────────────────────────────

def save_recommendation(rec: dict) -> str:
    cols = [
        "rec_id", "fixture_id", "goal_chaos", "corner_pressure", "card_heat",
        "volatility", "chaos_score", "legs_json", "combined_odds",
        "stake", "potential_payout",
    ]
    vals = [rec[c] for c in cols]
    placeholders = ", ".join(["?"] * len(cols))
    with get_db() as conn:
        conn.execute(
            f"INSERT INTO recommendations ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )
    return rec["rec_id"]


def save_leg(leg: dict):
    cols = [
        "leg_id", "rec_id", "fixture_id", "market", "line", "odds",
        "p_raw", "p_proxy", "p_cal", "implied", "edge", "calibration_phase",
    ]
    vals = [leg.get(c) for c in cols]
    placeholders = ", ".join(["?"] * len(cols))
    with get_db() as conn:
        conn.execute(
            f"INSERT INTO recommendation_legs ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )


def record_outcome(rec_id: str, won: bool):
    outcome_val = 1 if won else 0
    with get_db() as conn:
        rec = conn.execute(
            "SELECT stake, combined_odds FROM recommendations WHERE rec_id=?",
            (rec_id,),
        ).fetchone()
        if not rec:
            raise ValueError(f"rec_id {rec_id} not found")
        pnl = (rec["combined_odds"] - 1) * rec["stake"] if won else -rec["stake"]
        conn.execute(
            """UPDATE recommendations
               SET status=?, pnl=?, outcome_at=datetime('now')
               WHERE rec_id=?""",
            ("won" if won else "lost", pnl, rec_id),
        )
        conn.execute(
            """UPDATE recommendation_legs
               SET outcome=?
               WHERE rec_id=?""",
            (outcome_val, rec_id),
        )
    return pnl


def get_pending_recommendations() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM recommendations WHERE status='pending' ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_legs_with_outcome() -> list[dict]:
    """For calibration and weight training."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM recommendation_legs WHERE outcome IS NOT NULL"
        ).fetchall()
    return [dict(r) for r in rows]


# ── Calibration buckets ───────────────────────────────────────────────────────

def get_calibration_buckets(market: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM calibration_buckets WHERE market=? ORDER BY bucket_idx",
            (market,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_calibration_bucket(market: str, bucket_idx: int, n_bets_delta: int, n_wins_delta: int):
    with get_db() as conn:
        conn.execute(
            """UPDATE calibration_buckets
               SET n_bets = n_bets + ?,
                   n_wins = n_wins + ?,
                   updated_at = datetime('now')
               WHERE market=? AND bucket_idx=?""",
            (n_bets_delta, n_wins_delta, market, bucket_idx),
        )


def get_market_total_bets(market: str) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT SUM(n_bets) AS total FROM calibration_buckets WHERE market=?",
            (market,),
        ).fetchone()
    return row["total"] or 0


# ── Bankroll ──────────────────────────────────────────────────────────────────

def get_or_create_bankroll_today(initial: float = config.INITIAL_BANKROLL) -> dict:
    today = date.today().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM bankroll_log WHERE date=?", (today,)
        ).fetchone()
        if row:
            return dict(row)
        # Determine opening balance from yesterday's closing
        yesterday = conn.execute(
            "SELECT closing_balance FROM bankroll_log ORDER BY date DESC LIMIT 1"
        ).fetchone()
        opening = yesterday["closing_balance"] if yesterday else initial
        conn.execute(
            "INSERT INTO bankroll_log (date, opening_balance) VALUES (?, ?)",
            (today, opening),
        )
        return {"date": today, "opening_balance": opening, "closing_balance": None,
                "stake_used": 0, "coupons_placed": 0}


def add_stake_today(stake: float):
    today = date.today().isoformat()
    with get_db() as conn:
        conn.execute(
            """UPDATE bankroll_log
               SET stake_used = stake_used + ?,
                   coupons_placed = coupons_placed + 1,
                   closing_balance = opening_balance - (stake_used + ?)
               WHERE date=?""",
            (stake, stake, today),
        )


def close_bankroll_today(pnl: float):
    today = date.today().isoformat()
    with get_db() as conn:
        conn.execute(
            """UPDATE bankroll_log
               SET closing_balance = opening_balance - stake_used + ?
               WHERE date=?""",
            (pnl, today),
        )


# ── Chaos weights ─────────────────────────────────────────────────────────────

def save_chaos_weights(weights: dict, n_samples: int, target: str, accuracy: float):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO chaos_weights (weights_json, n_samples, target, train_accuracy)
               VALUES (?, ?, ?, ?)""",
            (json.dumps(weights), n_samples, target, accuracy),
        )


def get_latest_chaos_weights() -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM chaos_weights ORDER BY version DESC LIMIT 1"
        ).fetchone()
    if row:
        return {**dict(row), "weights": json.loads(row["weights_json"])}
    return None
