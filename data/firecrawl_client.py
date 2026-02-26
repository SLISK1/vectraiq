"""
Firecrawl integration for:
  1. Odds snapshot (1 call per match, cached 2h)
  2. Derby / referee flags (1 call per match, cached 24h)

Falls back gracefully if FIRECRAWL_API_KEY is not set or call fails.
The system functions without Firecrawl; it only adds optional bonuses to CardHeat.
"""
import json
import logging
from typing import Optional

import requests

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db

logger = logging.getLogger(__name__)

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"


def _firecrawl_scrape(url: str, prompt: str, cache_key: str, ttl: int) -> Optional[str]:
    """
    Call Firecrawl /scrape and return the LLM-extracted text.
    Returns None if unavailable or on error.
    """
    if not config.FIRECRAWL_API_KEY:
        return None

    cached = db.cache_get(cache_key)
    if cached is not None:
        return cached.get("text")

    try:
        resp = requests.post(
            f"{FIRECRAWL_BASE}/scrape",
            headers={
                "Authorization": f"Bearer {config.FIRECRAWL_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "url": url,
                "formats": ["extract"],
                "extract": {"prompt": prompt},
            },
            timeout=20,
        )
        if resp.status_code != 200:
            logger.warning("Firecrawl HTTP %d", resp.status_code)
            return None
        data = resp.json()
        text = data.get("data", {}).get("extract", "")
        db.cache_set(cache_key, {"text": text}, ttl=ttl)
        return text
    except Exception as e:
        logger.warning("Firecrawl error: %s", e)
        return None


# ── Derby detection ───────────────────────────────────────────────────────────

def is_derby(fixture_id: str, home_team: str, away_team: str,
             league_id: int) -> bool:
    """
    Ask Firecrawl whether this specific fixture is a derby/rivalry match.
    Result cached 24h.
    """
    prompt = (
        f"Is the football match between {home_team} and {away_team} "
        f"considered a local derby or fierce rivalry? "
        f"Answer only 'yes' or 'no'."
    )
    # Use Wikipedia or a well-known sports reference
    url = (
        f"https://en.wikipedia.org/wiki/{home_team.replace(' ', '_')}"
        f"_vs_{away_team.replace(' ', '_')}"
    )
    key = f"derby:{fixture_id}"
    text = _firecrawl_scrape(url, prompt, key, ttl=24 * 3600)
    if text:
        return "yes" in text.lower()
    return False


# ── Referee card tendency ─────────────────────────────────────────────────────

def referee_high_cards(fixture_id: str, referee_name: str) -> bool:
    """
    Check if referee has a high cards-per-game history.
    Result cached 24h.
    Uses a public stats page; falls back to False.
    """
    if not referee_name:
        return False
    prompt = (
        f"Does referee {referee_name} have an above-average cards-per-game rate "
        f"in football? Answer only 'yes' or 'no'."
    )
    url = f"https://www.transfermarkt.com/suche/treffer/seite/1/query/{referee_name.replace(' ', '+')}"
    key = f"referee:{fixture_id}:{referee_name}"
    text = _firecrawl_scrape(url, prompt, key, ttl=24 * 3600)
    if text:
        return "yes" in text.lower()
    return False


# ── Odds snapshot ─────────────────────────────────────────────────────────────

def get_odds_snapshot(fixture_id: str, home_team: str, away_team: str) -> Optional[dict]:
    """
    Scrape odds for the four markets we care about.
    Returns dict: {btts: float, o25: float, corners_o95: float, cards_o35: float}
    or None if unavailable.
    Cached 2h.
    """
    prompt = (
        f"For the football match {home_team} vs {away_team}, find the decimal odds for: "
        f"1) Both Teams To Score (Yes), "
        f"2) Over 2.5 Goals, "
        f"3) Over 9.5 Total Corners, "
        f"4) Over 3.5 Total Cards. "
        f"Return as JSON: {{\"btts\": X, \"o25\": X, \"corners_o95\": X, \"cards_o35\": X}}. "
        f"Use null for any odds not found."
    )
    url = f"https://www.oddsportal.com/search/results/{home_team.replace(' ', '+')}+{away_team.replace(' ', '+')}"
    key = f"odds:{fixture_id}"
    text = _firecrawl_scrape(url, prompt, key, ttl=2 * 3600)
    if not text:
        return None
    try:
        # Try to parse JSON from the extracted text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception:
        pass
    return None
