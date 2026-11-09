"""Local energy from data/power.log (written by profiler/power_sampler.sh).

    from profiler.energy import joules
    j = joules(t0, t1)        # measured net joules for [t0, t1] (epoch seconds), or None

Method (label: "measured"):
- Each log line is one powermetrics sample covering [t_end - elapsed, t_end] at a constant
  average power. Energy = sum(power x overlap with [t0, t1]) over CPU + GPU + ANE (combined).
- Net = gross - baseline_W x (t1 - t0). The baseline comes from data/power_baseline.json,
  written by profiler/baseline.py: 30 s with nothing running, sampler included.
- Scope: CPU + GPU + ANE package power as powermetrics reports it. DRAM, display, SSD
  and the rest of the board are NOT included. The power is system-wide, so any other
  activity in the window is counted too. That's why the baseline matters and the Mac
  should be quiet.

Returns None, with a loud warning, if the sampler isn't running, there's no baseline, or
less than COVERAGE_MIN of the window is covered by samples.
"""

from __future__ import annotations

import json
import os
import sys
import time
import warnings
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
POWER_LOG = Path(os.environ.get("POWER_LOG", ROOT / "data" / "power.log"))
BASELINE_PATH = ROOT / "data" / "power_baseline.json"
COVERAGE_MIN = 0.8        # fraction of the window that must be covered by samples
STALE_S = 2.0             # sampler is "running" if its last sample is newer than this
TAIL_BYTES = 4_000_000    # only read the end of the log (~ last 2.5 h at 5 samples/s)
COMPONENTS = ("cpu_mw", "gpu_mw", "ane_mw", "combined_mw")


@dataclass
class Sample:
    t_end: float
    elapsed_s: float
    cpu_mw: float
    gpu_mw: float
    ane_mw: float
    combined_mw: float

    @property
    def t_start(self) -> float:
        return self.t_end - self.elapsed_s


@dataclass
class EnergyResult:
    joules_net: Optional[float]     # measured, baseline-subtracted (can be slightly < 0)
    joules_gross: float             # measured, before baseline subtraction
    baseline_w: Optional[float]
    mean_w: float                   # gross average power over the window
    coverage: float                 # fraction of the window covered by samples
    n_samples: int
    t0: float
    t1: float
    label: str = "measured (powermetrics CPU+GPU+ANE, baseline-subtracted)"


def _loud(msg: str) -> None:
    bar = "!" * 78
    sys.stderr.write(f"\n{bar}\nENERGY: {msg}\n{bar}\n")
    warnings.warn(msg, stacklevel=3)


def read_samples(t_from: float = 0.0, path: Path = POWER_LOG) -> list[Sample]:
    """Samples ending after t_from. Reads only the tail of the log (it can grow large)."""
    if not path.exists():
        return []
    size = path.stat().st_size
    out: list[Sample] = []
    with open(path, "rb") as f:
        if size > TAIL_BYTES:
            f.seek(size - TAIL_BYTES)
            f.readline()  # drop the partial line
        for raw in f:
            line = raw.decode("utf-8", "replace").strip()
            if not line or line.startswith("#"):
                continue
            try:
                t, el, cpu, gpu, ane, comb = (float(x) for x in line.split(","))
            except ValueError:
                continue
            if t >= t_from:
                out.append(Sample(t, el / 1000.0, cpu, gpu, ane, comb))
    return out


def last_sample_age(path: Path = POWER_LOG) -> Optional[float]:
    s = read_samples(time.time() - 60, path)
    return (time.time() - s[-1].t_end) if s else None


def sampler_running(path: Path = POWER_LOG) -> bool:
    age = last_sample_age(path)
    return age is not None and age < STALE_S


def load_baseline() -> Optional[dict]:
    if not BASELINE_PATH.exists():
        return None
    return json.loads(BASELINE_PATH.read_text())


def integrate(t0: float, t1: float, samples: list[Sample], component: str = "combined_mw"):
    """(joules, covered_seconds, n_samples) over [t0, t1]."""
    j = covered = 0.0
    n = 0
    for s in samples:
        ov = min(t1, s.t_end) - max(t0, s.t_start)
        if ov > 0:
            j += getattr(s, component) / 1000.0 * ov
            covered += ov
            n += 1
    return j, covered, n


def energy(t0: float, t1: float, wait_s: float = 1.0, baseline_w: Optional[float] = None,
           path: Path = POWER_LOG) -> Optional[EnergyResult]:
    """Full result for [t0, t1], or None (with a loud warning) if it can't be measured.
    Waits up to wait_s for the sample that covers t1 to land in the log."""
    if t1 <= t0:
        raise ValueError("t1 must be after t0")
    deadline = time.time() + wait_s
    while True:
        samples = read_samples(t0 - 5, path)
        if samples and samples[-1].t_end >= t1:
            break
        if time.time() >= deadline:
            break
        time.sleep(0.1)
    if not samples or samples[-1].t_end < t1 - STALE_S:
        _loud(f"no power samples for this window. Is the sampler running? "
              f"Start it in another terminal:  sudo profiler/power_sampler.sh  (log: {path})")
        return None
    j, covered, n = integrate(t0, t1, samples)
    dur = t1 - t0
    coverage = covered / dur
    if coverage < COVERAGE_MIN:
        _loud(f"only {coverage:.0%} of the {dur:.2f}s window has power samples "
              f"(need {COVERAGE_MIN:.0%}). The sampler may have stopped or stalled.")
        return None
    if coverage < 0.999:  # scale up for small gaps (e.g. the window ends mid-sample)
        j = j / coverage
    if baseline_w is None:
        b = load_baseline()
        baseline_w = b["combined_w"] if b else None
    if baseline_w is None:
        _loud("no idle baseline (data/power_baseline.json). Run:  python -m profiler.baseline")
        net = None
    else:
        net = j - baseline_w * dur
    return EnergyResult(joules_net=net, joules_gross=j, baseline_w=baseline_w, mean_w=j / dur,
                        coverage=coverage, n_samples=n, t0=t0, t1=t1)


def joules(t0: float, t1: float, **kw) -> Optional[float]:
    """Measured net joules (baseline-subtracted) for [t0, t1], or None if unavailable."""
    r = energy(t0, t1, **kw)
    return None if r is None else r.joules_net


if __name__ == "__main__":
    age = last_sample_age()
    print(f"log: {POWER_LOG}")
    print(f"sampler running: {sampler_running()} (last sample {age:.1f}s ago)" if age is not None
          else "sampler running: False (no samples in the last 60 s)")
    print(f"baseline: {load_baseline()}")
    if sampler_running():
        r = energy(time.time() - 5, time.time() - 0.5)
        print("last ~5 s:", asdict(r) if r else None)
