"""
Bankroll management.

Policy (hard rules, not overridable):
  Bankroll:         500 kr
  Unit stake:       50 kr
  Daily risk cap:   100 kr (2 units)
  Max coupons/day:  2
  Max coupons/match: 1

Optional psychological guard (UI-level, disabled by default):
  If 2 consecutive losses recorded, lock recommendations for 12h.
  Toggle via PSYCH_GUARD_ENABLED in config (not added to avoid scope creep;
  left as comment for future implementation if desired).
"""
from datetime import date
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from db import database as db


class BankrollError(Exception):
    pass


def get_today_state() -> dict:
    return db.get_or_create_bankroll_today(config.INITIAL_BANKROLL)


def can_place_bet(stake: float = config.UNIT_STAKE) -> tuple[bool, str]:
    """
    Returns (can_place: bool, reason: str).
    Checks daily stake cap and coupon count.
    """
    state = get_today_state()

    if state["coupons_placed"] >= config.MAX_DAILY_COUPONS:
        return False, (
            f"Daily coupon limit reached: "
            f"{state['coupons_placed']}/{config.MAX_DAILY_COUPONS}"
        )

    remaining = config.MAX_DAILY_STAKE - (state["stake_used"] or 0)
    if stake > remaining:
        return False, (
            f"Stake {stake} kr exceeds daily remaining budget "
            f"{remaining:.1f} kr "
            f"(used {state['stake_used'] or 0}/{config.MAX_DAILY_STAKE} kr today)"
        )

    balance = state["opening_balance"] - (state["stake_used"] or 0)
    if stake > balance:
        return False, (
            f"Insufficient bankroll: {balance:.1f} kr available, "
            f"stake {stake} kr required"
        )

    return True, "ok"


def register_stake(stake: float = config.UNIT_STAKE):
    """Called when a bet is placed (before outcome is known)."""
    ok, reason = can_place_bet(stake)
    if not ok:
        raise BankrollError(reason)
    db.add_stake_today(stake)


def register_outcome(rec_id: str, won: bool) -> float:
    """
    Called when outcome is recorded.
    Returns PnL for this coupon.
    """
    pnl = db.record_outcome(rec_id, won)
    return pnl


def current_balance() -> float:
    state = get_today_state()
    return state["opening_balance"] - (state["stake_used"] or 0)


def daily_summary() -> dict:
    state = get_today_state()
    balance = state["opening_balance"] - (state["stake_used"] or 0)
    return {
        "date":            state["date"],
        "balance":         balance,
        "opening_balance": state["opening_balance"],
        "stake_used":      state["stake_used"] or 0,
        "coupons_placed":  state["coupons_placed"],
        "remaining_stake": config.MAX_DAILY_STAKE - (state["stake_used"] or 0),
        "remaining_slots": config.MAX_DAILY_COUPONS - state["coupons_placed"],
    }
