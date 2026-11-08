"""Step log schema. Every step of every run is one StepRecord, one JSON line.

Numbers in a record are either measured or modeled (see CLAUDE.md rule 5):
- measured: local_ms, local_tokens_in, local_tokens_out, local_joules, cloud_calls,
  cloud_steps, cloud_ms, handoff_tokens
- modeled:  cloud_energy_wh_low / cloud_energy_wh_high (always a range, never a point)
- cloud_usd is measured when Sai reports it, otherwise modeled from the price sheet.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, Optional

Mode = str  # e.g. "local_only", "sai_only", "hybrid"
GateDecision = Literal["local", "flush", "escalate"]
Executor = Literal["local", "sai"]
StepLabel = Literal["ok", "fail", "unknown"]

_GATE_DECISIONS = {"local", "flush", "escalate"}
_EXECUTORS = {"local", "sai"}
_STEP_LABELS = {"ok", "fail", "unknown"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_file(path: str | Path, chunk: int = 1 << 16) -> str:
    """SHA-256 of a file, read in chunks so nothing large sits in memory."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


@dataclass
class StepRecord:
    # identity
    run_id: str
    mode: Mode
    task_id: str
    step_idx: int
    timestamp: str = field(default_factory=now_iso)

    # observation
    screenshot_path: str = ""
    screenshot_hash: str = ""
    goal: str = ""
    history_summary: str = ""

    # local proposals
    local_samples: list[dict[str, Any]] = field(default_factory=list)  # action JSON objects
    local_logprob: Optional[float] = None
    agreement_score: Optional[float] = None
    flush_action: Optional[dict[str, Any]] = None
    flush_agrees: Optional[bool] = None
    laya_scores: Optional[dict[str, float]] = None

    # gate
    gate_name: str = ""
    gate_decision: GateDecision = "local"
    executor: Executor = "local"
    action_taken: Optional[dict[str, Any]] = None
    step_label: StepLabel = "unknown"

    # local compute (measured)
    local_ms: float = 0.0
    local_tokens_in: int = 0
    local_tokens_out: int = 0
    local_joules: Optional[float] = None

    # cloud usage
    cloud_calls: int = 0
    cloud_steps: int = 0
    cloud_ms: float = 0.0
    cloud_usd: float = 0.0
    cloud_energy_wh_low: Optional[float] = None   # modeled
    cloud_energy_wh_high: Optional[float] = None  # modeled
    handoff_tokens: int = 0

    # privacy exposure
    pii_strings_visible: list[str] = field(default_factory=list)
    injection_visible: bool = False

    def validate(self) -> None:
        if self.gate_decision not in _GATE_DECISIONS:
            raise ValueError(f"gate_decision must be one of {_GATE_DECISIONS}: {self.gate_decision!r}")
        if self.executor not in _EXECUTORS:
            raise ValueError(f"executor must be one of {_EXECUTORS}: {self.executor!r}")
        if self.step_label not in _STEP_LABELS:
            raise ValueError(f"step_label must be one of {_STEP_LABELS}: {self.step_label!r}")
        if self.step_idx < 0:
            raise ValueError("step_idx must be >= 0")
        lo, hi = self.cloud_energy_wh_low, self.cloud_energy_wh_high
        if (lo is None) != (hi is None):
            raise ValueError("cloud energy must be a low-high range: set both or neither")
        if lo is not None and hi is not None and lo > hi:
            raise ValueError("cloud_energy_wh_low must be <= cloud_energy_wh_high")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"))

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "StepRecord":
        known = {f.name for f in fields(cls)}
        unknown = set(d) - known
        if unknown:
            raise ValueError(f"unknown StepRecord fields: {sorted(unknown)}")
        return cls(**d)


class StepWriter:
    """Append-only JSONL writer. Flushes each line so a crash loses at most one step.

    Usage:
        with StepWriter("data/runs/<run_id>/steps.jsonl") as w:
            w.write(record)
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(self.path, "a", encoding="utf-8")

    def write(self, record: StepRecord) -> None:
        record.validate()
        self._f.write(record.to_json() + "\n")
        self._f.flush()

    def close(self) -> None:
        if not self._f.closed:
            self._f.close()

    def __enter__(self) -> "StepWriter":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def read_steps(path: str | Path) -> Iterator[StepRecord]:
    """Stream records back one line at a time."""
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield StepRecord.from_dict(json.loads(line))
