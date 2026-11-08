"""Benchmark the local brain on 5 saved screenshots: 2 calls each, n_samples=1, temperature 0.

Before running:
  1. Quit Firefox, Docker Desktop and other heavy apps (8 GB Mac; an earlier run froze it).
  2. In another terminal:  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve
  3. python -m brain.bench --model qwen3-vl:2b     (or ui-tars-2b, or qwen2.5vl:3b)

Prints resident memory after the model loads, then median latency, the valid-JSON rate and
token counts. All numbers are measured. The model is unloaded at the end, even on errors.
Results go to data/runs/bench_<timestamp>/bench.jsonl.
"""

from __future__ import annotations

import json
import statistics as st
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from PIL import Image

import argparse

from brain.local_brain import DEFAULT_MODEL, SPECS, BrainError, LocalBrain

ROOT = Path(__file__).resolve().parents[1]

# (screenshot, goal, expected click box in ORIGINAL pixels or None)
CASES = [
    ("data/runs/smoke_20261108_131021/screens/0000_before.png",
     "Click the 'Learn more' link.", (430, 900, 535, 935)),
    ("data/runs/smoke_20261108_131021/screens/0001_after.png",
     "Open the 'Domains' section of the IANA website.", (610, 180, 690, 210)),
    ("data/runs/probe/screens/0000_example.png",
     "Continue without signing in to Chrome.", (965, 775, 1100, 805)),
    ("data/runs/subgoal_20261108_132010/screens/0000_reset.png",
     "Open https://en.wikipedia.org in the browser.", None),
    ("data/runs/smoke_local_20261108_134500/screens/0000_before.png",
     "Click the 'Learn more' link.", (465, 728, 560, 752)),
]
REPEATS = 2


def hit(action: dict, box) -> str:
    if box is None or action.get("action") != "click" or not action.get("valid"):
        return "-"
    x0, y0, x1, y1 = box
    return "hit" if x0 <= action["x"] <= x1 and y0 <= action["y"] <= y1 else "miss"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=list(SPECS), default=DEFAULT_MODEL)
    ap.add_argument("--max-w", type=int, default=756, help="model image width (<=1024)")
    args = ap.parse_args()
    brain = LocalBrain(model=args.model, max_w=args.max_w, keep_alive="5m")
    tag = args.model.replace(":", "-").replace(".", "") + f"_w{args.max_w}"
    run_dir = ROOT / "data" / "runs" / (f"bench_{tag}_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
    run_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    try:
        brain.ensure_ready()
        print(f"model {brain.model}  max_w={brain.max_w}  num_ctx={brain.num_ctx}")
        for ci, (path, goal, box) in enumerate(CASES):
            img = Image.open(ROOT / path)
            img.load()
            for rep in range(REPEATS):
                p = brain.propose(goal, [], img, temperature=0.0, n_samples=1)
                s, a = p.samples[0], p.actions[0]
                if ci == 0 and rep == 0:
                    mem = brain.memory_report()
                    print("resident memory after load (measured):", json.dumps(mem))
                row = {
                    "case": ci, "rep": rep, "screenshot": path, "goal": goal,
                    "original_size": p.original_size, "model_image_size": p.image_size,
                    "action": a, "valid": s.valid, "error": s.error, "retried": s.retried,
                    "latency_ms": p.latency_ms, "tokens_in": s.tokens_in,
                    "tokens_in_cached": s.tokens_in_cached, "tokens_out": s.tokens_out,
                    "mean_logprob": s.mean_logprob, "mean_logprob_all": s.mean_logprob_all,
                    "ollama_ms": s.ollama_ms, "target": hit(a, box), "raw": s.raw,
                }
                rows.append(row)
                with open(run_dir / "bench.jsonl", "a") as f:
                    f.write(json.dumps(row) + "\n")
                lp = f"{s.mean_logprob:.3f}" if s.mean_logprob is not None else "None"
                print(f"[{ci}.{rep}] {p.latency_ms / 1000:6.1f}s in={s.tokens_in:>5} "
                      f"out={s.tokens_out:>3} lp={lp:>7} valid={s.valid!s:<5} "
                      f"{row['target']:<4} {json.dumps({k: a.get(k) for k in ('action', 'x', 'y', 'text', 'key')})}")
        mem_end = brain.memory_report()
    except BrainError as e:
        print("STOPPED:", e)
        return 1
    finally:
        if brain.server_ok():
            brain.unload()
            print("model unloaded")

    lat = [r["latency_ms"] for r in rows]
    warm = [r["latency_ms"] for r in rows[1:]]
    print("\n===== summary (all measured) =====")
    print(f"calls: {len(rows)}   valid JSON+schema: {sum(r['valid'] for r in rows)}/{len(rows)} "
          f"({100 * sum(r['valid'] for r in rows) / len(rows):.0f}%)   retries: "
          f"{sum(r['retried'] for r in rows)}")
    print(f"latency median: {st.median(lat) / 1000:.1f}s  (warm, excl. first call: "
          f"{st.median(warm) / 1000:.1f}s; first call incl. load: {lat[0] / 1000:.1f}s)")
    print(f"tokens_in median: {st.median(r['tokens_in'] for r in rows):.0f}   "
          f"tokens_out median: {st.median(r['tokens_out'] for r in rows):.0f}")
    lps = [r["mean_logprob"] for r in rows if r["mean_logprob"] is not None]
    print(f"mean_logprob (decision tokens) median: "
          f"{st.median(lps):.3f}" if lps else "mean_logprob: None")
    same = sum(rows[i]["raw"] == rows[i + 1]["raw"] for i in range(0, len(rows), 2))
    print(f"identical output on repeat (temp 0): {same}/{len(CASES)}")
    hits = [r["target"] for r in rows if r["target"] != "-"]
    print(f"click on expected target: {hits.count('hit')}/{len(hits)}")
    print("memory at end (measured):", json.dumps(mem_end))
    print("results:", run_dir / "bench.jsonl")
    return 0


if __name__ == "__main__":
    sys.exit(main())
