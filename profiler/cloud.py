"""Sai cloud cost and modeled cloud energy.

COST (what the Sai API exposes, checked 2026-11-08 on the free plan):
- GET /v1/agents/account -> credits.usd: the account balance in USD, at $0.01 resolution.
  SaiEnv.wait_sai_task records it before and after each task, giving `credits_delta_usd`.
- GET /v1/agents/events -> usage.costUsd: a "live estimate", not the billed amount. It read
  $0 on runs where the balance dropped $0.01, so it's never used as cost.
- There's no per-task billed cost. A per-task balance delta is only $0.01-precise and
  often reads $0.00.

So:
- task_cost(result): the per-task balance delta when it's > 0, labelled
  "measured (credits delta)". Otherwise None.
- BatchLedger: record the balance (from the API, or typed in from the dashboard) before
  and after a batch, then split the difference across tasks by wall time. Labelled
  "measured (apportioned)". This is the more reliable number. Don't let a batch span UTC
  midnight: free-plan credits reset then.

ENERGY (always "modeled", always a low-high range):
- From profiler/energy_assumptions.yaml: tokens x Wh-per-1k-tokens when tokens are known,
  otherwise model calls x Wh-per-call. If the file still has TODO values, it returns None
  and warns loudly. The numbers are never invented.

CLI for the ledger (e.g. when reading the balance off the dashboard):
    python -m profiler.cloud start BATCH [--balance 0.97]
    python -m profiler.cloud add BATCH TASK_ID WALL_SECONDS
    python -m profiler.cloud finish BATCH [--balance 0.93]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from profiler.energy import _loud

ROOT = Path(__file__).resolve().parents[1]
ASSUMPTIONS_PATH = ROOT / "profiler" / "energy_assumptions.yaml"
LEDGER_DIR = ROOT / "data" / "runs"


# --------------------------------------------------------------- cost
@dataclass
class CloudCost:
    usd: Optional[float]
    label: str
    detail: str = ""


def task_cost(result: Any) -> CloudCost:
    """Per-task Sai cost from what the API exposed for this task (a SaiTaskResult)."""
    delta = getattr(result, "credits_delta_usd", None)
    est = getattr(result, "cost_usd_estimate", None)
    if delta is not None and delta > 0:
        return CloudCost(round(delta, 4), "measured (credits delta)",
                         "account balance before/after the task; $0.01 resolution")
    detail = ("balance delta was $0.00 (below the $0.01 resolution)" if delta == 0
              else "balance not available") + f"; API live estimate costUsd={est} (not billing)"
    return CloudCost(None, "not exposed per task; use BatchLedger", detail)


class BatchLedger:
    """Balance before/after a batch, split across tasks by wall time. Saved to
    data/runs/<batch>/cloud_ledger.json so it survives restarts and manual entry."""

    def __init__(self, batch: str):
        self.path = LEDGER_DIR / batch / "cloud_ledger.json"
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {
            "batch": batch, "start": None, "finish": None, "tasks": []}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2))

    @staticmethod
    def _api_balance() -> Optional[float]:
        try:
            from env.sai_env import SaiEnv
            return SaiEnv("cloud_ledger", verbose=False).credits_usd()
        except Exception as e:  # noqa: BLE001
            _loud(f"couldn't read the Sai balance from the API ({e}); pass --balance from the dashboard")
            return None

    def start(self, balance_usd: Optional[float] = None) -> float:
        src = "manual (dashboard)" if balance_usd is not None else "api"
        bal = balance_usd if balance_usd is not None else self._api_balance()
        if bal is None:
            raise RuntimeError("no starting balance")
        self.data["start"] = {"usd": bal, "t": time.time(), "source": src}
        self._save()
        return bal

    def add(self, task_id: str, wall_s: float, run_id: str = "") -> None:
        self.data["tasks"].append({"task_id": task_id, "wall_s": float(wall_s), "run_id": run_id})
        self._save()

    def finish(self, balance_usd: Optional[float] = None) -> dict[str, Any]:
        if not self.data["start"]:
            raise RuntimeError("ledger was never started")
        src = "manual (dashboard)" if balance_usd is not None else "api"
        bal = balance_usd if balance_usd is not None else self._api_balance()
        if bal is None:
            raise RuntimeError("no finishing balance")
        self.data["finish"] = {"usd": bal, "t": time.time(), "source": src}
        d0 = datetime.fromtimestamp(self.data["start"]["t"], timezone.utc).date()
        d1 = datetime.fromtimestamp(self.data["finish"]["t"], timezone.utc).date()
        if d0 != d1:
            _loud("batch spans UTC midnight; free-plan credits reset then, so the delta is unreliable")
        spent = round(self.data["start"]["usd"] - bal, 4)
        total_wall = sum(t["wall_s"] for t in self.data["tasks"]) or 1.0
        for t in self.data["tasks"]:
            t["usd"] = round(spent * t["wall_s"] / total_wall, 6)
            t["label"] = "measured (apportioned)"
        self.data["spent_usd"] = spent
        self.data["label"] = "measured (apportioned by task wall time)"
        self._save()
        return self.data


# -------------------------------------------------------------- energy
def load_assumptions(path: Path = ASSUMPTIONS_PATH) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def _filled(block: Optional[dict]) -> bool:
    if not block:
        return False
    lo, hi, src = block.get("low"), block.get("high"), block.get("source")
    return (isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and 0 <= lo <= hi
            and isinstance(src, str) and src.strip() and src.strip().upper() != "TODO")


@dataclass
class CloudEnergy:
    wh_low: Optional[float]
    wh_high: Optional[float]
    basis: str
    label: str = "modeled"


def modeled_energy_wh(tokens: Optional[int] = None, model_calls: Optional[int] = None,
                      assumptions: Optional[dict] = None) -> CloudEnergy:
    """Low-high Wh for one cloud task. Uses tokens when known, otherwise model calls."""
    a = assumptions if assumptions is not None else load_assumptions()
    tok_block, call_block = a.get("wh_per_1k_tokens"), a.get("wh_per_model_call")
    if tokens:
        if _filled(tok_block):
            k = tokens / 1000.0
            return CloudEnergy(round(k * tok_block["low"], 6), round(k * tok_block["high"], 6),
                               f"{tokens} tokens x wh_per_1k_tokens ({tok_block['source']})")
    if model_calls:
        if _filled(call_block):
            return CloudEnergy(round(model_calls * call_block["low"], 6),
                               round(model_calls * call_block["high"], 6),
                               f"{model_calls} model calls x wh_per_model_call ({call_block['source']})")
    if not (_filled(tok_block) or _filled(call_block)):
        _loud("profiler/energy_assumptions.yaml still has TODO values; cloud energy NOT modeled. "
              "Fill it from a cited source.")
        return CloudEnergy(None, None, "assumptions not filled in (TODO)")
    return CloudEnergy(None, None, f"no usable input (tokens={tokens}, model_calls={model_calls}) "
                                   "for the assumptions that are filled in")


# ----------------------------------------------------------------- CLI
def _cli() -> int:
    ap = argparse.ArgumentParser(description="Batch cost ledger (measured, apportioned)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start"); s.add_argument("batch"); s.add_argument("--balance", type=float)
    s = sub.add_parser("add"); s.add_argument("batch"); s.add_argument("task_id"); s.add_argument("wall_s", type=float)
    s = sub.add_parser("finish"); s.add_argument("batch"); s.add_argument("--balance", type=float)
    s = sub.add_parser("energy-check")
    a = ap.parse_args()
    if a.cmd == "energy-check":
        e = modeled_energy_wh(tokens=1000, model_calls=1)
        print(e)
        return 0 if e.wh_low is not None else 1
    led = BatchLedger(a.batch)
    if a.cmd == "start":
        print(f"start balance: ${led.start(a.balance):.2f}")
    elif a.cmd == "add":
        led.add(a.task_id, a.wall_s)
        print(f"added {a.task_id} ({a.wall_s}s)")
    else:
        d = led.finish(a.balance)
        print(f"spent ${d['spent_usd']:.4f} ({d['label']})")
        for t in d["tasks"]:
            print(f"  {t['task_id']:<8} {t['wall_s']:8.1f}s  ${t['usd']:.4f}  {t['label']}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
