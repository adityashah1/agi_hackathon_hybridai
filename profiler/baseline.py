"""Measure the idle power baseline: 30 s (default) with nothing heavy running.

    python -m profiler.baseline [--seconds 30]

Needs the sampler running (sudo profiler/power_sampler.sh). The baseline therefore
includes powermetrics' own overhead, which is exactly what should be subtracted.
Writes data/power_baseline.json; profiler/energy.py subtracts it from every window.
Close other apps and don't touch the Mac while it measures. All numbers are measured.
"""

from __future__ import annotations

import argparse
import json
import statistics as st
import subprocess
import sys
import time
from datetime import datetime, timezone

from profiler.energy import BASELINE_PATH, COMPONENTS, _loud, integrate, read_samples, sampler_running


def busy_processes(threshold_pct: float = 10.0) -> list[str]:
    out = subprocess.run(["ps", "-Ao", "%cpu=,comm="], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and float(parts[0]) >= threshold_pct:
            rows.append(f"{float(parts[0]):5.1f}%  {parts[1].rsplit('/', 1)[-1]}")
    return rows


def measure(seconds: float = 30.0, save: bool = True, verbose: bool = True) -> dict | None:
    if not sampler_running():
        _loud("power sampler isn't running. Start it first:  sudo profiler/power_sampler.sh")
        return None
    busy = busy_processes()
    if busy and verbose:
        print("note: these processes are busy right now and will inflate the baseline:\n  "
              + "\n  ".join(busy))
    if verbose:
        print(f"measuring idle baseline for {seconds:.0f}s - don't use the Mac...", flush=True)
    t0 = time.time()
    time.sleep(seconds)
    t1 = time.time()
    time.sleep(0.6)  # let the last sample land
    samples = [s for s in read_samples(t0 - 1) if s.t_start >= t0 - 0.05 and s.t_end <= t1 + 0.05]
    if len(samples) < seconds * 2:
        _loud(f"only {len(samples)} samples in {seconds:.0f}s; the sampler may be stalling.")
        return None
    res = {"t0": t0, "t1": t1, "seconds": round(t1 - t0, 2), "n_samples": len(samples),
           "measured_at": datetime.now(timezone.utc).isoformat(), "label": "measured"}
    for c in COMPONENTS:
        j, covered, _ = integrate(t0, t1, samples, c)
        vals = [getattr(s, c) / 1000.0 for s in samples]
        key = c.replace("_mw", "_w")
        res[key] = round(j / covered, 4)
        res[key.replace("_w", "_w_std")] = round(st.pstdev(vals), 4)
    res["busy_processes"] = busy
    if save:
        BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
        BASELINE_PATH.write_text(json.dumps(res, indent=2))
    if verbose:
        print(f"baseline (measured): combined {res['combined_w']:.3f} W "
              f"(sd {res['combined_w_std']:.3f}) | cpu {res['cpu_w']:.3f}  gpu {res['gpu_w']:.3f}  "
              f"ane {res['ane_w']:.3f} W | {res['n_samples']} samples"
              + (f" -> {BASELINE_PATH}" if save else ""))
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=30.0)
    a = ap.parse_args()
    sys.exit(0 if measure(a.seconds) else 1)
