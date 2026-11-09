"""Profiler self-test: two idle baselines, then 5 local-brain calls on one screenshot.

Before running:
  1. Quit Firefox, Docker and other heavy apps; don't touch the Mac during the baselines.
  2. Terminal A:  sudo profiler/power_sampler.sh
  3. Terminal B:  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve
  4. Terminal C:  python -m profiler.selftest [--model qwen3-vl:2b] [--image PATH] [--seconds 30]

Reports (all measured): both baselines and how far apart they are, then joules per call
(net of the baseline): per call, mean, standard deviation, min/max, and coefficient of
variation.

Notes on method:
- One warm-up call loads the model. It's reported separately, not counted.
- Each call gets a 1-pixel random change in the top-left corner. Without it Ollama would
  serve repeats from its prompt cache (about 1 s instead of about 5 s) and the energy
  would be unrepresentative.
- A watchdog kills the model process if free memory drops below 15% (8 GB Mac).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics as st
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

from profiler import baseline as baseline_mod
from profiler import energy as energy_mod
from profiler.context import profile
from runner.schema import StepRecord

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGE = "data/runs/smoke_local_20261108_134500/screens/0000_before.png"


def watchdog(stop: threading.Event, min_free_pct: int = 15) -> None:
    while not stop.wait(2.0):
        out = subprocess.run(["memory_pressure"], capture_output=True, text=True).stdout
        m = re.search(r"free percentage:\s*(\d+)%", out)
        if m and int(m.group(1)) < min_free_pct:
            subprocess.run(["pkill", "-f", "llama-server"])
            print(f"\nWATCHDOG: free memory {m.group(1)}% < {min_free_pct}% -> killed the model", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen3-vl:2b")
    ap.add_argument("--image", default=DEFAULT_IMAGE)
    ap.add_argument("--seconds", type=float, default=30.0, help="length of each baseline")
    ap.add_argument("--calls", type=int, default=5)
    a = ap.parse_args()

    if not energy_mod.sampler_running():
        energy_mod._loud("power sampler isn't running. In another terminal:  sudo profiler/power_sampler.sh")
        return 1

    # ---- 1. two baselines
    print("== baselines ==")
    b1 = baseline_mod.measure(a.seconds, save=False)
    b2 = baseline_mod.measure(a.seconds, save=True)
    if not (b1 and b2):
        return 1
    drift = b2["combined_w"] - b1["combined_w"]
    print(f"baseline 1: {b1['combined_w']:.3f} W   baseline 2: {b2['combined_w']:.3f} W   "
          f"difference: {drift:+.3f} W ({100 * drift / max(b1['combined_w'], 1e-9):+.1f}%)  [measured]")
    print(f"using baseline 2 ({b2['combined_w']:.3f} W) for the calls below")

    # ---- 2. local brain, same screenshot N times
    from brain.local_brain import BrainError, LocalBrain
    img = Image.open(ROOT / a.image).convert("RGB")
    goal = "Click the 'Learn more' link."
    brain = LocalBrain(model=a.model, keep_alive="5m")
    stop = threading.Event()
    threading.Thread(target=watchdog, args=(stop,), daemon=True).start()
    rows = []
    try:
        brain.ensure_ready()
        print(f"\n== {a.model}: warm-up (loads the model, not counted) ==")
        rec = StepRecord(run_id="profiler_selftest", mode="selftest", task_id="-", step_idx=0)
        with profile(rec, "local") as p:
            brain.propose(goal, [], img)
        print(f"warm-up: {rec.local_ms / 1000:.1f}s  net {rec.local_joules} J  [measured]")
        print("resident memory:", json.dumps(brain.memory_report()))

        print(f"\n== {a.calls} calls on {a.image} ==")
        for i in range(a.calls):
            im = img.copy()
            im.putpixel((0, 0), tuple(random.randrange(256) for _ in range(3)))  # defeat the prompt cache
            rec = StepRecord(run_id="profiler_selftest", mode="selftest", task_id="-", step_idx=i + 1)
            with profile(rec, "local") as p:
                prop = brain.propose(goal, [], im)
                p.from_proposal(prop)
            e = p.energy
            rows.append({"call": i + 1, "latency_ms": rec.local_ms, "joules_net": rec.local_joules,
                         "joules_gross": e.joules_gross if e else None, "mean_w": e.mean_w if e else None,
                         "tokens_in": rec.local_tokens_in, "tokens_out": rec.local_tokens_out,
                         "cached_tokens": prop.samples[0].tokens_in_cached, "valid": prop.samples[0].valid})
            jn = f"{rec.local_joules:7.2f}" if rec.local_joules is not None else "   None"
            print(f"call {i + 1}: {rec.local_ms / 1000:5.1f}s  net {jn} J  gross "
                  f"{(e.joules_gross if e else float('nan')):7.2f} J  avg {(e.mean_w if e else float('nan')):5.2f} W  "
                  f"tokens {rec.local_tokens_in}/{rec.local_tokens_out} (cached {rows[-1]['cached_tokens']})")
    except BrainError as e:
        print("STOPPED:", e)
        return 1
    finally:
        stop.set()
        if brain.server_ok():
            brain.unload()
            print("model unloaded")

    js = [r["joules_net"] for r in rows if r["joules_net"] is not None]
    print("\n===== joules per call (measured, net of baseline) =====")
    if len(js) >= 2:
        mean, sd = st.mean(js), st.stdev(js)
        print(f"n={len(js)}  mean {mean:.2f} J  sd {sd:.2f} J  min {min(js):.2f}  max {max(js):.2f}  "
              f"CV {100 * sd / mean:.1f}%")
        lat = [r["latency_ms"] / 1000 for r in rows]
        print(f"latency mean {st.mean(lat):.2f}s  sd {st.stdev(lat):.2f}s   "
              f"=> mean power above idle {mean / st.mean(lat):.2f} W")
    else:
        print("not enough energy readings (sampler stopped?)")
    out = ROOT / "data" / "runs" / ("profiler_selftest_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps({"baselines": [b1, b2], "model": a.model, "image": a.image,
                                                   "calls": rows, "label": "measured"}, indent=2))
    print("results:", out / "results.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
