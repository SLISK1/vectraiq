"""
API client for api-football.com (RapidAPI).
All responses are cached in SQLite to minimise API calls.

Rate limit: free tier = 100 calls/day, ~10/min.
Strategy:
  - Daily batch: 1 call per league for fixtures + team stats from fixture history
  - Never re-fetch within TTL
  - On rate-limit (429): wait and retry with exponential backoff
"""
import json
import time
import math
import logging
from datetime import datetime, date
from typing import Optional

import requests

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db

logger = logging.getLogger(__name__)

HEADERS = {
    "x-rapidapi-host": "v3.football.api-sports.io",
    "x-rapidapi-key":  config.FOOTBALL_API_KEY,
}


def _get(endpoint: str, params: dict, ttl: int = 3600,
         cache_key: Optional[str] = None) -> Optional[dict]:
    """Fetch with cache + exponential-backoff retry."""
    key = cache_key or f"{endpoint}:{json.dumps(params, sort_keys=True)}"
    cached = db.cache_get(key)
    if cached is not None:
        return cached

    url = f"{config.FOOTBALL_API_BASE}/{endpoint}"
    for attempt in range(5):
        try:
            resp = requests.get(url, headers=HEADERS, params=params, timeout=15)
        except requests.RequestException as e:
            logger.warning("Request error (attempt %d): %s", attempt + 1, e)
            time.sleep(2 ** attempt)
            continue

        if resp.status_code == 429:
            wait = 2 ** (attempt + 2)
            logger.warning("Rate limited; sleeping %ds", wait)
            time.sleep(wait)
            continue

        if resp.status_code != 200:
            logger.error("HTTP %d for %s", resp.status_code, url)
            return None

        data = resp.json()
        db.cache_set(key, data, ttl)
        return data

    logger.error("All retries exhausted for %s", endpoint)
    return None


# ── Fixtures ──────────────────────────────────────────────────────────────────

def fetch_upcoming_fixtures(league_id: int, season: int, next_n: int = 20) -> list[dict]:
    """
    Fetch next N fixtures for a league.
    Returns normalised list ready for db.upsert_fixture().
    TTL = 6h so we don't hammer the API mid-day.
    """
    data = _get(
        "fixtures",
        {"league": league_id, "season": season, "next": next_n},
        ttl=6 * 3600,
        cache_key=f"fixtures:upcoming:{league_id}:{season}:{date.today()}",
    )
    if not data:
        return []
    result = []
    for f in data.get("response", []):
        fix = f["fixture"]
        teams = f["teams"]
        result.append({
            "fixture_id":      str(fix["id"]),
            "league_id":       league_id,
            "season":          season,
            "home_team_id":    str(teams["home"]["id"]),
            "away_team_id":    str(teams["away"]["id"]),
            "home_team_name":  teams["home"]["name"],
            "away_team_name":  teams["away"]["name"],
            "kickoff":         fix["date"],
            "status":          "scheduled",
        })
    return result


def fetch_finished_fixtures(league_id: int, season: int) -> list[dict]:
    """
    Fetch ALL finished fixtures for a league/season.
    Used to build team statistics from scratch.
    TTL = 12h (heavy call, run once per day).
    """
    data = _get(
        "fixtures",
        {"league": league_id, "season": season, "status": "FT"},
        ttl=12 * 3600,
        cache_key=f"fixtures:finished:{league_id}:{season}:{date.today()}",
    )
    if not data:
        return []
    result = []
    for f in data.get("response", []):
        fix = f["fixture"]
        teams = f["teams"]
        goals = f["goals"]
        stats = {s["team"]["id"]: s["statistics"] for s in f.get("statistics", [])}

        def _stat(team_id, stat_type):
            for s in stats.get(team_id, []):
                if s["type"] == stat_type:
                    v = s["value"]
                    return int(v) if v is not None else None
            return None

        h_id = teams["home"]["id"]
        a_id = teams["away"]["id"]
        result.append({
            "fixture_id":      str(fix["id"]),
            "league_id":       league_id,
            "season":          season,
            "home_team_id":    str(h_id),
            "away_team_id":    str(a_id),
            "home_team_name":  teams["home"]["name"],
            "away_team_name":  teams["away"]["name"],
            "kickoff":         fix["date"],
            "status":          "finished",
            "home_goals":      goals["home"],
            "away_goals":      goals["away"],
            "home_corners":    _stat(h_id, "Corner Kicks"),
            "away_corners":    _stat(a_id, "Corner Kicks"),
            "home_cards":      (_stat(h_id, "Yellow Cards") or 0)
                               + (_stat(h_id, "Red Cards") or 0),
            "away_cards":      (_stat(a_id, "Yellow Cards") or 0)
                               + (_stat(a_id, "Red Cards") or 0),
        })
    return result


# ── Build team stats from fixture history ─────────────────────────────────────

def build_team_stats_from_fixtures(league_id: int, season: int) -> list[dict]:
    """
    Compute team stats from finished fixtures stored in DB.
    Returns list of stats dicts ready for db.upsert_team_stats().
    Called after fetch_finished_fixtures() has populated the fixtures table.
    """
    finished = db.get_finished_fixtures(league_id, season)
    if not finished:
        return []

    # Accumulate per team
    from collections import defaultdict
    teams: dict[str, dict] = defaultdict(lambda: {
        "goals_for": [], "goals_against": [],
        "corners_for": [], "corners_against": [],
        "cards_for": [], "cards_against": [],
        "total_goals": [], "total_corners": [], "total_cards": [],
        "btts": [], "over25": [], "clean_sheet": [], "failed_to_score": [],
        "corners_over95": [], "cards_over35": [],
        "results": [],   # W=3, D=1, L=0 for form
        "draws": [],     # bool
    })

    for f in finished:
        hg = f["home_goals"]
        ag = f["away_goals"]
        if hg is None or ag is None:
            continue

        hc = f.get("home_corners")
        ac = f.get("away_corners")
        hk = f.get("home_cards")
        ak = f.get("away_cards")
        total_goals   = hg + ag
        total_corners = (hc + ac) if (hc is not None and ac is not None) else None
        total_cards   = (hk + ak) if (hk is not None and ak is not None) else None

        for role, gf, ga, cf, ca, kf, ka in [
            ("home", hg, ag, hc, ac, hk, ak),
            ("away", ag, hg, ac, hc, ak, hk),
        ]:
            tid = f["home_team_id"] if role == "home" else f["away_team_id"]
            t = teams[tid]
            t["goals_for"].append(gf)
            t["goals_against"].append(ga)
            t["btts"].append(int(gf > 0 and ga > 0))
            t["clean_sheet"].append(int(ga == 0))
            t["failed_to_score"].append(int(gf == 0))
            t["total_goals"].append(total_goals)
            t["over25"].append(int(total_goals > 2.5))

            if cf is not None and ca is not None:
                t["corners_for"].append(cf)
                t["corners_against"].append(ca)
            if total_corners is not None:
                t["total_corners"].append(total_corners)
                t["corners_over95"].append(int(total_corners > 9.5))

            if kf is not None and ka is not None:
                t["cards_for"].append(kf)
                t["cards_against"].append(ka)
            if total_cards is not None:
                t["total_cards"].append(total_cards)
                t["cards_over35"].append(int(total_cards > 3.5))

            if role == "home":
                pts = 3 if hg > ag else (1 if hg == ag else 0)
            else:
                pts = 3 if ag > hg else (1 if ag == hg else 0)
            t["results"].append(pts)
            t["draws"].append(int(hg == ag))

    stats_list = []
    for team_id, t in teams.items():
        n = len(t["goals_for"])
        if n < config.MIN_TEAM_MATCHES:
            continue

        def avg(lst): return sum(lst) / len(lst) if lst else None
        def rate(lst): return sum(lst) / len(lst) if lst else None
        def std_pop(lst):
            if len(lst) < 2:
                return 0.0
            m = sum(lst) / len(lst)
            return math.sqrt(sum((x - m) ** 2 for x in lst) / len(lst))

        # Form: last 5 (or all if fewer)
        recent_pts = t["results"][-5:]

        stats_list.append({
            "team_id":              team_id,
            "league_id":            league_id,
            "season":               season,
            "matches_played":       n,
            "goals_for_avg":        avg(t["goals_for"]),
            "goals_against_avg":    avg(t["goals_against"]),
            "btts_rate":            rate(t["btts"]),
            "over25_rate":          rate(t["over25"]),
            "clean_sheet_rate":     rate(t["clean_sheet"]),
            "failed_to_score_rate": rate(t["failed_to_score"]),
            "corners_for_avg":      avg(t["corners_for"]) if t["corners_for"] else None,
            "corners_against_avg":  avg(t["corners_against"]) if t["corners_against"] else None,
            "corners_over95_rate":  rate(t["corners_over95"]) if t["corners_over95"] else None,
            "cards_for_avg":        avg(t["cards_for"]) if t["cards_for"] else None,
            "cards_against_avg":    avg(t["cards_against"]) if t["cards_against"] else None,
            "cards_over35_rate":    rate(t["cards_over35"]) if t["cards_over35"] else None,
            # Volatility inputs (form-based, NOT goals)
            "form_pts_avg":         avg(recent_pts),
            "form_pts_std":         std_pop(recent_pts),
            "draw_rate":            rate(t["draws"][-10:]),
        })
    return stats_list
