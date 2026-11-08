"""Smoke test for direct control (no Sai credits; direct control itself is not billed).

Opens Chrome on the cloud computer to https://example.com, screenshots, clicks the
"More information" link (example.com's link now reads "Learn more"), screenshots again,
and checks that the two screenshots differ.

The cloud computer exposes no accessibility tree for Chrome (the snapshot is empty), so the
link is found locally by its blue link colour in the screenshot. No billed grounding call.

    python -m env.smoke_test                      # Sai cloud computer
    python -m env.smoke_test --watch              # + print a live-view link first
    python -m env.smoke_test --env local          # local Chromium, headless (no Sai time)
    python -m env.smoke_test --env local --watch  # local Chromium in a visible window
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime

import numpy as np
from PIL import Image

from env.sai_env import SaiEnv


def find_link(img: Image.Image, top_frac: float = 0.18, taskbar_px: int = 60,
              min_run: int = 30):
    """Find an underlined blue link and return (x, y, underline_bbox) in original screen
    coordinates. Only the underline is matched: a long horizontal run of saturated blue
    pixels. ClearType's coloured fringes on grey text never form such a run. Skips the
    browser chrome/infobar (top) and the taskbar (bottom)."""
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mask = (b > 180) & (b - r > 100) & (b - g > 100)
    h = a.shape[0]
    mask[: int(h * top_frac)] = False
    mask[h - taskbar_px:] = False
    best = None  # (run_len, y, x0, x1)
    for y in np.where(mask.any(axis=1))[0]:
        row = mask[y].astype(np.int8)
        # longest run of consecutive True in this row
        d = np.diff(np.concatenate(([0], row, [0])))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        lens = ends - starts
        i = int(lens.argmax())
        if lens[i] >= min_run and (best is None or lens[i] > best[0]):
            best = (int(lens[i]), int(y), int(starts[i]), int(ends[i]) - 1)
    if not best:
        return None
    _, y, x0, x1 = best
    # the text sits just above its underline
    return (x0 + x1) // 2, y - 6, (x0, y, x1, y)


def changed_fraction(a: Image.Image, b: Image.Image) -> float:
    if a.size != b.size:
        return 1.0
    x = np.asarray(a.convert("L"), dtype=np.int16)
    y = np.asarray(b.convert("L"), dtype=np.int16)
    return float((np.abs(x - y) > 16).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["sai", "local"], default="sai")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()

    run_id = f"smoke_{args.env}_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.env == "local":
        from env.local_env import LocalEnv
        env = LocalEnv(run_id, headless=not args.watch)
        # page-only screenshot: no browser toolbar and no taskbar to skip
        find = lambda img: find_link(img, top_frac=0.0, taskbar_px=0)  # noqa: E731
        settle = 1.5 if args.watch else 0.5
    else:
        env = SaiEnv(run_id)
        env.open_or_reuse_lease()
        find = find_link
        settle = 4
        if args.watch:
            live = env.live_url()
            print("\nWatch live (valid 30 min):\n  " + live["liveUrl"] + "\n")
            input("Open it, then press Enter (in THIS terminal) to start the test... ")
            env.open_or_reuse_lease()  # the lease may have idled out while we waited

    try:
        return run(env, find, settle, args.env)
    finally:
        if args.env == "local":
            env.close()


def run(env, find, settle: float, kind: str) -> int:
    opened = env.open_url("https://example.com")
    print("open:", opened)
    time.sleep(settle)
    before = env.screenshot("before")
    h1 = env.last_screenshot_hash
    print("screen (measured):", env.screen_size, "->", env.last_screenshot_path)

    hit = find(before)
    assert hit, "could not find a blue link on screen (Chrome first-run page still up?)"
    x, y, bbox = hit
    print(f"link bbox={bbox} click=({x},{y})")
    print("act:", env.act({"type": "click", "x": x, "y": y}))
    time.sleep(settle)
    after = env.screenshot("after")
    if kind == "local":
        print("url after click:", env.url)

    frac = changed_fraction(before, after)
    h2 = env.last_screenshot_hash
    print(f"changed pixels (measured): {frac:.1%}")
    assert h1 != h2, "screenshots are byte-identical"
    # The taskbar clock alone changes ~0.01% of pixels, so require a real page change.
    assert frac > 0.01, f"screenshots barely differ ({frac:.3%}); click had no visible effect"

    total_ms = sum(c.ms for c in env.calls)
    print(f"PASS ({kind}). {len(env.calls)} calls, {total_ms / 1000:.1f}s total (measured)."
          + (" Lease left open on purpose." if kind == "sai" else ""))
    for c in env.calls:
        print(f"  {c.op:<16} {c.status} {c.ms:>8.0f} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
