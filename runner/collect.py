"""Local-only data collection for the gate lab (no escalation, no Sai).

    python -m runner.collect --tasks T6 [--run-id NAME] [--watch]     # dry run on one task
    python -m runner.collect --tasks all --run-id gate1               # full suite (resumable)
    python -m runner.collect --tasks all --run-id gate1               # re-run the same: resumes
    python -m runner.collect --estimate                               # wall-time estimate only

Per step, on the same screenshot:
  primary  = propose(goal, history, shot, temperature=0)          -> action_taken, local_logprob
  samples  = propose(goal, history, shot, temperature=0.7, n=3)   -> local_samples
  agreement_score = fraction of the 3 samples that agree with the primary
      click: within 30 px (original resolution) OR same element under the point;
      type: normalized text equal; key/scroll: same key; done: same normalized answer
  flush    = propose(goal, history=[], shot, temperature=0)        -> flush_action, flush_agrees
  execute the PRIMARY in LocalEnv, screenshot again
  post-check: dHash-32 distance (bottom 30 px / event bar excluded) >= 3 -> screen_changed
  step_label: tasks/checkers.label_step (an invalid primary -> fail; a done step -> success check)
Every model call runs inside profiler.context.profile (timing, tokens, joules if the
power sampler is running). Records follow runner/schema.py and go to
data/runs/<run_id>/steps.jsonl.

Stopping rules per task: the primary says done; a mock task's CONFIRM code shows up;
max_steps; 2 invalid primaries in a row; or the same action 3 times with no screen change.
Resumable per task: a task with data/runs/<run_id>/tasks/<id>.json is skipped. A task that
was interrupted restarts from scratch (the browser state can't be restored).
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import re
import statistics as st
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from PIL import Image

from brain.local_brain import DEFAULT_MODEL, BrainError, LocalBrain, to_env_action
from profiler import energy as energy_mod
from profiler.context import profile
from runner.schema import StepRecord, StepWriter
from tasks.checkers import (injection_visible, label_step, load_tasks, ocr, pii_visible, read_event,
                            task_success)

ROOT = Path(__file__).resolve().parents[1]
N_SAMPLES, SAMPLE_TEMP = 3, 0.7
AGREE_PX = 30
PHASH_N, PHASH_THRESHOLD, BAR_PX = 32, 3, 30   # calibrated 2026-11-08 on manual T1 runs
SETTLE_S = 0.6
STEP_OVERHEAD_S = 2.5   # assumed: screenshots, 2x OCR, page settle, energy-sample waits


# ------------------------------------------------------------ helpers
def dhash(img: Image.Image, n: int = PHASH_N, crop_bottom: int = BAR_PX) -> int:
    im = img.crop((0, 0, img.width, max(1, img.height - crop_bottom)))
    g = im.convert("L").resize((n + 1, n), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for r in range(n):
        row = r * (n + 1)
        for c in range(n):
            bits = (bits << 1) | (px[row + c] > px[row + c + 1])
    return bits


def phash_distance(a: Image.Image, b: Image.Image) -> int:
    return bin(dhash(a) ^ dhash(b)).count("1")


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def actions_agree(a: dict, b: dict) -> bool:
    if not (a.get("valid") and b.get("valid")) or a.get("action") != b.get("action"):
        return False
    act = a["action"]
    if act == "click":
        if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) <= AGREE_PX:
            return True
        return bool(a.get("target")) and a.get("target") == b.get("target")
    if act == "type":
        return _norm(a.get("text")) == _norm(b.get("text"))
    if act in ("key", "scroll"):
        return _norm(a.get("key")) == _norm(b.get("key"))
    if act == "done":
        return _norm(a.get("text")) == _norm(b.get("text"))
    return False


def compact(a: dict) -> dict:
    keep = {"action": a.get("action")}
    if a.get("action") in ("click", "scroll"):
        keep.update(x=a.get("x"), y=a.get("y"))
    if a.get("text"):
        keep["text"] = a["text"]
    if a.get("key"):
        keep["key"] = a["key"]
    return keep


def watchdog(stop: threading.Event, min_free_pct: int = 15) -> None:
    while not stop.wait(2.0):
        out = subprocess.run(["memory_pressure"], capture_output=True, text=True).stdout
        m = re.search(r"free percentage:\s*(\d+)%", out)
        if m and int(m.group(1)) < min_free_pct:
            subprocess.run(["pkill", "-f", "llama-server"])
            print(f"\nWATCHDOG: free memory {m.group(1)}% < {min_free_pct}% -> killed the model", flush=True)


# ----------------------------------------------------------- estimate
def estimate(tasks: dict, ids: list[str]) -> dict:
    """Wall-time estimate from the latest brain/bench.py run of the default model."""
    runs = sorted(glob.glob(str(ROOT / "data/runs/bench_qwen3-vl-2b_*/bench.jsonl")))
    runs = [r for r in runs if "_w" not in Path(r).parent.name] or runs
    if not runs:
        return {}
    rows = [json.loads(l) for l in open(runs[-1])]
    first = [r["latency_ms"] / 1000 for r in rows if r["rep"] == 0][1:]   # skip the model-load call
    cached = [r["latency_ms"] / 1000 for r in rows if r["rep"] == 1]
    f, c = st.median(first), st.median(cached)
    # primary is a fresh screenshot; the 3 samples reuse its prompt (cached); flush may or may not
    lo = f + N_SAMPLES * c + c + STEP_OVERHEAD_S
    hi = f + N_SAMPLES * c + f + STEP_OVERHEAD_S
    max_steps = sum(tasks[i]["max_steps"] for i in ids)
    return {"bench": Path(runs[-1]).parent.name, "first_call_s": f, "cached_call_s": c,
            "step_s": (lo, hi), "max_steps": max_steps,
            "worst_case_min": (lo * max_steps / 60, hi * max_steps / 60)}


def print_estimate(e: dict, ids: list[str]) -> None:
    if not e:
        print("no bench results found; run python -m brain.bench first")
        return
    lo, hi = e["step_s"]
    print(f"estimate from {e['bench']} (latencies measured; +{STEP_OVERHEAD_S}s/step overhead assumed):\n"
          f"  model calls: first {e['first_call_s']:.1f}s, prompt-cached {e['cached_call_s']:.1f}s  ->  "
          f"one step = 5 calls + overhead = {lo:.0f}-{hi:.0f}s (modeled)\n"
          f"  tasks {','.join(ids)}: at most {e['max_steps']} steps -> worst case "
          f"{e['worst_case_min'][0]:.0f}-{e['worst_case_min'][1]:.0f} min (modeled; most tasks stop earlier)")


# ---------------------------------------------------------------- run
class Collector:
    def __init__(self, run_id: str, model: str, headless: bool):
        self.run_id = run_id
        self.run_dir = ROOT / "data" / "runs" / run_id
        (self.run_dir / "tasks").mkdir(parents=True, exist_ok=True)
        self.brain = LocalBrain(model=model, keep_alive="10m")
        self.headless = headless
        self.measure_energy = energy_mod.sampler_running()
        if not self.measure_energy:
            energy_mod._loud("power sampler isn't running: local_joules will be None for this run. "
                             "Start it with:  sudo profiler/power_sampler.sh")

    def propose(self, rec: StepRecord, env, goal, history, img, temperature, n) -> list[dict]:
        with profile(rec, "local", measure_energy=self.measure_energy) as p:
            prop = self.brain.propose(goal, history, img, temperature=temperature, n_samples=n)
            p.from_proposal(prop)
        out = []
        for a, s in zip(prop.actions, prop.samples):
            a = dict(a)
            if a.get("valid") and a.get("action") == "click":
                a["target"] = env.element_at(a["x"], a["y"])
            a["logprob"] = s.mean_logprob
            out.append(a)
        return out

    def run_task(self, task: dict) -> dict:
        from env.local_env import LocalEnv
        tid = task["id"]
        part = self.run_dir / "tasks" / f"{tid}.steps.jsonl"
        part.unlink(missing_ok=True)
        for f in glob.glob(str(self.run_dir / "screens" / f"*_{tid}_*.png")):
            Path(f).unlink()
        env = LocalEnv(self.run_id, headless=self.headless, verbose=False)
        writer = StepWriter(part)
        t_task = time.time()
        result = {"task_id": tid, "success": False, "stop_reason": "max_steps", "steps": 0}
        try:
            env.open_url(task["start_url"])
            env.settle()
            time.sleep(SETTLE_S)
            before = env.screenshot(f"{tid}_s00")
            lines = ocr(before)
            before_text = "\n".join(t for t, _, _ in lines)
            before_event = read_event(lines)
            before_path, before_hash = str(env.last_screenshot_path), env.last_screenshot_hash
            history: list[dict] = []
            invalid_streak = noop_streak = 0
            last_sig = None
            for step in range(task["max_steps"]):
                rec = StepRecord(
                    run_id=self.run_id, mode="collect", task_id=tid, step_idx=step,
                    screenshot_path=before_path, screenshot_hash=before_hash or "", goal=task["goal"],
                    history_summary=json.dumps(history[-3:]), gate_name="none (collect)",
                    gate_decision="local", executor="local",
                    pii_strings_visible=pii_visible(before_text),
                    injection_visible=injection_visible(before_text))
                primary = self.propose(rec, env, task["goal"], history, before, 0.0, 1)[0]
                rec.local_logprob = primary.get("logprob")
                samples = self.propose(rec, env, task["goal"], history, before, SAMPLE_TEMP, N_SAMPLES)
                rec.local_samples = samples
                rec.agreement_score = round(sum(actions_agree(primary, s) for s in samples) / len(samples), 3)
                flush = self.propose(rec, env, task["goal"], [], before, 0.0, 1)[0]
                rec.flush_action, rec.flush_agrees = flush, actions_agree(primary, flush)
                rec.action_taken = primary

                valid = bool(primary.get("valid"))
                is_done = valid and primary["action"] == "done"
                env_action = to_env_action(primary) if valid and not is_done else None
                if env_action:
                    try:
                        env.act(env_action)
                    except (ValueError, NotImplementedError) as e:
                        print(f"    act failed: {e}")
                    env.settle()
                    time.sleep(SETTLE_S)
                after = env.screenshot(f"{tid}_s{step + 1:02d}")
                lines = ocr(after)
                after_text = "\n".join(t for t, _, _ in lines)
                after_event = read_event(lines)
                rec.phash_distance = phash_distance(before, after)
                rec.screen_changed = rec.phash_distance >= PHASH_THRESHOLD

                if not valid:
                    rec.step_label = "fail"
                elif is_done:
                    answer = primary.get("text") or ""
                    ok = task_success(task, answer) or task_success(task, after_text)
                    rec.step_label = "ok" if ok else "fail"
                else:
                    rec.step_label = label_step(task, before_event, after_event, env_action)
                writer.write(rec)
                result["steps"] = step + 1

                jn = f"{rec.local_joules:.0f}J" if rec.local_joules is not None else "-J"
                print(f"  {tid} s{step:02d} {json.dumps(compact(primary)) if valid else 'INVALID: ' + primary.get('error', '')[:40]:<58} "
                      f"agree={rec.agreement_score:.2f} flush={'Y' if rec.flush_agrees else 'n'} "
                      f"lp={rec.local_logprob if rec.local_logprob is None else round(rec.local_logprob, 2)} "
                      f"d={rec.phash_distance} {rec.step_label:<7} {rec.local_ms / 1000:.1f}s {jn}", flush=True)

                if valid:
                    history.append(compact(primary))
                if is_done:
                    result.update(success=rec.step_label == "ok", stop_reason="done",
                                  answer=primary.get("text"))
                    break
                if task["success"]["type"] == "confirm" and task_success(task, after_text):
                    result.update(success=True, stop_reason="confirm code on screen")
                    break
                invalid_streak = 0 if valid else invalid_streak + 1
                if invalid_streak >= 2:
                    result["stop_reason"] = "stuck: 2 invalid primaries"
                    break
                sig = json.dumps(compact(primary), sort_keys=True)
                noop_streak = (noop_streak + 1 if sig == last_sig else 1) if not rec.screen_changed else 0
                last_sig = sig
                if noop_streak >= 3:
                    result["stop_reason"] = "stuck: same action 3x, no screen change"
                    break
                before, before_text, before_event = after, after_text, after_event
                before_path, before_hash = str(env.last_screenshot_path), env.last_screenshot_hash
            else:
                if task["success"]["type"] == "confirm":
                    result["success"] = task_success(task, after_text)
        finally:
            writer.close()
            env.close()
        result["wall_s"] = round(time.time() - t_task, 1)
        # commit: append this task's records to the run log, then mark the task complete
        with open(self.run_dir / "steps.jsonl", "a") as out, open(part) as src:
            out.write(src.read())
        (self.run_dir / "tasks" / f"{tid}.json").write_text(json.dumps(result, indent=2))
        return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="T6", help="comma list, or 'all'")
    ap.add_argument("--run-id", default=None, help="reuse an existing run id to resume")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--watch", action="store_true", help="show the browser window")
    ap.add_argument("--estimate", action="store_true", help="print the estimate and exit")
    a = ap.parse_args()

    tasks = load_tasks()
    ids = list(tasks) if a.tasks == "all" else [t.strip() for t in a.tasks.split(",")]
    unknown = [i for i in ids if i not in tasks]
    if unknown:
        print("unknown tasks:", unknown)
        return 2
    print_estimate(estimate(tasks, ids), ids)
    if a.estimate:
        return 0

    run_id = a.run_id or "collect_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    col = Collector(run_id, a.model, headless=not a.watch)
    print(f"run: {col.run_dir}")
    stop = threading.Event()
    threading.Thread(target=watchdog, args=(stop,), daemon=True).start()
    summary = []
    try:
        col.brain.ensure_ready()
        # warm-up (not recorded) so the first step's latency and energy don't include model loading
        t_w = time.time()
        col.brain.propose("warm-up", [], Image.new("RGB", (1024, 768), "white"))
        print(f"model warm-up (not recorded): {time.time() - t_w:.1f}s")
        for tid in ids:
            done_file = col.run_dir / "tasks" / f"{tid}.json"
            if done_file.exists():
                print(f"{tid}: already complete in this run -> skipped")
                summary.append(json.loads(done_file.read_text()))
                continue
            t = tasks[tid]
            if t["start_url"].startswith("http://localhost"):
                import requests
                try:
                    requests.get(t["start_url"].split("?")[0], timeout=3).raise_for_status()
                except Exception:  # noqa: BLE001
                    print(f"{tid}: mock apps not reachable at {t['start_url']} -> skipped "
                          "(python -m http.server 8765 -d mock_apps)")
                    continue
            print(f"\n=== {tid}: {t['title']} (max {t['max_steps']} steps)")
            r = col.run_task(t)
            summary.append(r)
            print(f"=== {tid}: success={r['success']} steps={r['steps']} stop={r['stop_reason']} "
                  f"wall={r['wall_s']}s (measured)")
    except BrainError as e:
        print("STOPPED:", e)
        return 1
    finally:
        stop.set()
        if col.brain.server_ok():
            col.brain.unload()
    print("\nsummary:", json.dumps(summary))
    print("records:", col.run_dir / "steps.jsonl")
    return 0


if __name__ == "__main__":
    sys.exit(main())
