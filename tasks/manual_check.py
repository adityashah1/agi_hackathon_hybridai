"""Drive a task by hand through the env wrapper and run both checkers, to validate them.

    python -m tasks.manual_check --task T8                 # Sai cloud computer (default)
    python -m tasks.manual_check --task T8 --live          # + print a live-view link
    python -m tasks.manual_check --task T3 --env local     # local Chromium window (no Sai time)

Mock-app tasks (T1-T5) need MOCK_BASE to be reachable from the chosen environment. Locally:
`python -m http.server 8765 -d mock_apps`. The cloud computer can't reach localhost, so use
--env local for T1-T5 until the mock apps are deployed.

Commands at the prompt (coordinates are screenshot pixels):
  click X Y          type TEXT        key NAME        scroll up|down [N]
  goto URL           (open a URL: like typing it into the address bar; the local window has none)
  find TEXT          (OCR: print matching text and its click point)
  click_text TEXT    (OCR: click the best match for TEXT)
  shot               (save a screenshot and print its path)
  done [ANSWER]      (finish: run task_success on ANSWER, or on the final screen if no answer)
  quit
After every action: screenshot -> OCR -> event before/after -> label_step(), printed and logged.

Steps are logged in the runner/schema.py format (CLAUDE.md rule 6) to
data/runs/<run_id>/steps.jsonl with mode="manual", gate_name="human", gate_decision="local",
executor="local". The schema has no "human" executor; the action runs through the local wrapper.
"""

from __future__ import annotations

import argparse
import json
import shlex
import sys
import time
from datetime import datetime

from runner.schema import StepRecord, StepWriter
from tasks.checkers import (injection_visible, label_step, load_tasks, normalize_event, ocr,
                            pii_visible, read_event, task_success)

HELP = __doc__.split("Commands at the prompt")[1].split("After every action")[0]


def parse(line: str) -> tuple[str, list[str], str]:
    cmd, _, rest = line.strip().partition(" ")
    return cmd.lower(), (shlex.split(rest) if rest and cmd.lower() not in ("type", "done", "find", "click_text") else []), rest.strip()


def best_match(lines, query: str):
    """OCR lines containing `query`, shortest first, each with the box narrowed to the
    query's estimated position. Vision often merges a whole row (e.g. a nav bar) into one
    line, so clicking the line's centre would hit the wrong item."""
    q = query.lower()
    hits = []
    for t, c, (x0, y0, x1, y1) in lines:
        i = t.lower().find(q)
        if i < 0:
            continue
        n = max(1, len(t))
        nx0 = x0 + (x1 - x0) * i / n
        nx1 = x0 + (x1 - x0) * (i + len(q)) / n
        hits.append((t, c, (round(nx0), y0, round(nx1), y1)))
    return sorted(hits, key=lambda h: (len(h[0]), -h[1]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--env", choices=["sai", "local"], default="sai")
    ap.add_argument("--live", action="store_true", help="print a Sai live-view link")
    ap.add_argument("--settle", type=float, default=None, help="seconds to wait after actions")
    ap.add_argument("--headless", action="store_true", help="local only: no visible window")
    a = ap.parse_args()

    tasks = load_tasks()
    if a.task not in tasks:
        print("unknown task; choose from", ", ".join(tasks))
        return 2
    task = tasks[a.task]
    run_id = f"manual_{a.task}_{a.env}_" + datetime.now().strftime("%Y%m%d_%H%M%S")

    if a.env == "local":
        from env.local_env import LocalEnv
        env = LocalEnv(run_id, headless=a.headless)
        settle = 0.6 if a.settle is None else a.settle
    else:
        from env.sai_env import SaiEnv
        if task["start_url"].startswith(("http://localhost", "http://127.")):
            print("WARNING: this task's start_url is on localhost; the cloud computer can't reach it.\n"
                  "         Use --env local, or set MOCK_BASE to the deployed URL.")
        env = SaiEnv(run_id)
        env.open_or_reuse_lease()
        if a.live:
            print("\nLive view (30 min):\n  " + env.live_url()["liveUrl"] + "\n")
        settle = 2.0 if a.settle is None else a.settle

    writer = StepWriter(env.run_dir / "steps.jsonl")
    print(f"\n=== {task['id']}: {task['title']}\nGOAL: {task['goal']}\n"
          f"start: {task['start_url']}   max_steps: {task['max_steps']}\n")
    print("Commands:" + HELP)

    env.open_url(task["start_url"])
    time.sleep(settle + 1)
    shot = env.screenshot("start")
    lines = ocr(shot)
    event = read_event(lines)
    print(f"screen {shot.size}  event: {event!r}  -> {env.last_screenshot_path}")

    history: list[dict] = []
    labels: dict[str, int] = {"ok": 0, "fail": 0, "unknown": 0}
    step = 0
    try:
        while True:
            try:
                line = input(f"[{task['id']} step {step + 1}/{task['max_steps']}] > ")
            except EOFError:
                line = "quit"
            if not line.strip():
                continue
            cmd, args, rest = parse(line)
            action = None
            try:
                if cmd == "quit":
                    print("quit without a success check.")
                    break
                if cmd in ("help", "?"):
                    print(HELP)
                    continue
                if cmd == "shot":
                    shot = env.screenshot("manual")
                    lines = ocr(shot)
                    print(env.last_screenshot_path)
                    continue
                if cmd == "find":
                    for t, c, (x0, y0, x1, y1) in best_match(lines, rest)[:8]:
                        print(f"  ({(x0 + x1) // 2},{(y0 + y1) // 2})  conf={c:.2f}  {t!r}")
                    continue
                if cmd == "done":
                    final = env.screenshot("final")
                    text = "\n".join(t for t, _, _ in ocr(final))
                    ok = task_success(task, rest if rest else text)
                    print(f"\nSUCCESS={ok}  (checked {'your answer' if rest else 'final screen OCR'}; "
                          f"rule: {task['success']['regex']})")
                    print(f"steps={step}  labels={labels}  final event={read_event(text)!r}")
                    break
                if cmd == "click":
                    action = {"type": "click", "x": int(args[0]), "y": int(args[1])}
                elif cmd == "click_text":
                    hits = best_match(lines, rest)
                    if not hits:
                        print("  no OCR match on the last screenshot (try `shot` first)")
                        continue
                    t, _, (x0, y0, x1, y1) = hits[0]
                    action = {"type": "click", "x": (x0 + x1) // 2, "y": (y0 + y1) // 2}
                    print(f"  -> clicking {t!r} at ({action['x']},{action['y']})")
                elif cmd == "type":
                    action = {"type": "type", "text": rest}
                elif cmd == "goto":
                    if not rest:
                        print("  usage: goto URL")
                        continue
                    action = {"type": "goto", "url": rest}
                elif cmd == "key":
                    action = {"type": "key", "name": args[0]}
                elif cmd == "scroll":
                    n = int(args[1]) if len(args) > 1 else 3
                    action = {"type": "scroll", "dx": 0, "dy": n if args[0] == "down" else -n}
                else:
                    print("  unknown command; type `help`")
                    continue

                before = event
                if action["type"] == "goto":
                    env.open_url(action["url"])
                else:
                    env.act(action)
                time.sleep(settle)
                shot = env.screenshot(f"s{step + 1:02d}")
                lines = ocr(shot)
                text = "\n".join(t for t, _, _ in lines)
                event = read_event(lines)
                label = label_step(task, before, event, action)
                labels[label] += 1
                step += 1
                history.append(action)
                writer.write(StepRecord(
                    run_id=run_id, mode="manual", task_id=task["id"], step_idx=step - 1,
                    screenshot_path=str(env.last_screenshot_path),
                    screenshot_hash=env.last_screenshot_hash or "", goal=task["goal"],
                    history_summary=json.dumps(history[-4:-1]), gate_name="human",
                    gate_decision="local", executor="local", action_taken=action,
                    step_label=label, pii_strings_visible=pii_visible(text),
                    injection_visible=injection_visible(text)))
                print(f"  event: {normalize_event(before)!r} -> {normalize_event(event)!r}   label={label}"
                      f"   pii={pii_visible(text)} injection={injection_visible(text)}")
                if step >= task["max_steps"]:
                    print(f"  (reached max_steps={task['max_steps']}; `done` to check success)")
            except (ValueError, IndexError) as e:
                print(f"  bad command: {e}")
            except NotImplementedError as e:
                print(f"  not supported: {e}")
    finally:
        writer.close()
        if a.env == "local":
            env.close()
        print(f"steps log: {env.run_dir / 'steps.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
