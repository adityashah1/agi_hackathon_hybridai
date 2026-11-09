"""LocalEnv: the same screenshot()/act() interface as SaiEnv, driving a local Chromium via
Playwright. Use it to build and debug the loop without spending Sai cloud time.

- Only the browser page is captured, never your real desktop, so no real personal data.
- Viewport defaults to 1024x768, so screenshots already satisfy CLAUDE.md rule 1 and model
  coordinates equal screen coordinates (scale 1.0).
- headless=False opens a visible window you can watch.
- Same action schema and restrictions as SaiEnv: single keys only, scroll in notches. A
  policy that works here doesn't rely on something the cloud computer can't do.

    with LocalEnv("my_run", headless=False) as env:
        env.open_url("https://example.com")
        img = env.screenshot("start")
        env.act({"type": "click", "x": 100, "y": 200})
"""

from __future__ import annotations

import hashlib
import io
import json
import time
from pathlib import Path
from typing import Any, Optional

from PIL import Image
from playwright.sync_api import sync_playwright

from env.sai_env import ROOT, CallRecord, SaiEnv

# our lowercase key names -> Playwright key names
_KEYS = {
    "enter": "Enter", "return": "Enter", "tab": "Tab", "escape": "Escape", "esc": "Escape",
    "backspace": "Backspace", "delete": "Delete", "space": " ", "home": "Home", "end": "End",
    "pageup": "PageUp", "pagedown": "PageDown", "up": "ArrowUp", "down": "ArrowDown",
    "left": "ArrowLeft", "right": "ArrowRight",
}
NOTCH_PX = 100  # one mouse-wheel notch in Chromium


class LocalEnv:
    kind = "local"

    def __init__(self, run_id: str, headless: bool = True, width: int = 1024,
                 height: int = 768, verbose: bool = True):
        self.run_id = run_id
        self.run_dir = ROOT / "data" / "runs" / run_id
        self.screens_dir = self.run_dir / "screens"
        self.screens_dir.mkdir(parents=True, exist_ok=True)
        self.verbose = verbose
        self.screen_size: Optional[tuple[int, int]] = (width, height)
        self.last_screenshot_path: Optional[Path] = None
        self.last_screenshot_hash: Optional[str] = None
        self.calls: list[CallRecord] = []
        self._shot_idx = len(list(self.screens_dir.glob("*.png")))
        self._mouse = (width // 2, height // 2)
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=headless)
        self._page = self._browser.new_page(viewport={"width": width, "height": height})
        self.machine_id = "local"

    # ---------------------------------------------------------------- utils
    def _log(self, *a: Any) -> None:
        if self.verbose:
            print("[local]", *a, flush=True)

    def _timed(self, op: str, fn, *a, **kw):
        t0, p0 = time.time(), time.perf_counter()
        ok = True
        try:
            return fn(*a, **kw)
        except Exception:
            ok = False
            raise
        finally:
            rec = CallRecord(op, "LOCAL", op, 200 if ok else None,
                             round((time.perf_counter() - p0) * 1000, 1), t0)
            self.calls.append(rec)
            with open(self.run_dir / "calls.jsonl", "a") as f:
                f.write(json.dumps(rec.__dict__) + "\n")

    def close(self) -> None:
        try:
            self._browser.close()
        finally:
            self._pw.stop()

    def __enter__(self) -> "LocalEnv":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------- same interface as SaiEnv
    def open_or_reuse_lease(self, *_a: Any, **_kw: Any) -> dict:
        return {"machineId": "local", "status": "open"}

    def open_url(self, url: str, app: str = "chromium") -> dict:
        self._timed("open_url", self._page.goto, url, wait_until="load")
        return {"method": "playwright.goto", "app": app, "url": self._page.url}

    @property
    def url(self) -> str:
        return self._page.url

    def settle(self, timeout_ms: int = 5000) -> None:
        """Best-effort wait for a navigation the last action may have started."""
        try:
            self._page.wait_for_load_state("load", timeout=timeout_ms)
        except Exception:  # noqa: BLE001
            pass

    def element_at(self, x: int, y: int) -> Optional[str]:
        """A short descriptor of the clickable element at (x, y) in screenshot pixels
        (1:1 with CSS px here). On the mock apps it's the same text the event log would show."""
        try:
            return self._page.evaluate(
                """([x, y]) => {
                  const el = document.elementFromPoint(x, y);
                  if (!el) return null;
                  if (window.HG) return HG.describe(el);
                  const t = el.closest('button,a,input,select,textarea,label,[role=button],li,tr,td,th') || el;
                  const txt = (t.innerText || t.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
                  return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (txt ? ' "' + txt + '"' : '');
                }""", [int(x), int(y)])
        except Exception:  # noqa: BLE001
            return None

    def screenshot(self, tag: str | None = None) -> Image.Image:
        raw = self._timed("screenshot", self._page.screenshot, type="png")
        img = Image.open(io.BytesIO(raw))
        img.load()
        self.screen_size = img.size
        path = self.screens_dir / f"{self._shot_idx:04d}{'_' + tag if tag else ''}.png"
        self._shot_idx += 1
        path.write_bytes(raw)
        self.last_screenshot_path = path
        self.last_screenshot_hash = hashlib.sha256(raw).hexdigest()
        return img

    resize_for_model = staticmethod(SaiEnv.resize_for_model)

    def act(self, action: dict) -> dict:
        """Same schema as SaiEnv.act. Coordinates are in screenshot pixels."""
        t = action.get("type")
        m = self._page.mouse
        kb = self._page.keyboard
        p0 = time.perf_counter()
        if t == "click":
            x, y = int(action["x"]), int(action["y"])
            w, h = self.screen_size
            if not (0 <= x < w and 0 <= y < h):
                raise ValueError(f"click ({x},{y}) outside screen {w}x{h}")
            self._timed("act_click", m.click, x, y)
            self._mouse = (x, y)
        elif t == "type":
            self._timed("act_type", kb.type, str(action["text"]))
        elif t == "key":
            name = str(action["name"])
            if "+" in name and len(name) > 1:
                raise NotImplementedError(f"key combos not supported (parity with SaiEnv): {name!r}")
            self._timed("act_key", kb.press, _KEYS.get(name.lower(), name))
        elif t == "scroll":
            dx, dy = int(action.get("dx", 0)), int(action.get("dy", 0))
            if not (dx or dy):
                raise ValueError("scroll needs nonzero dx or dy")
            if action.get("x") is not None and action.get("y") is not None:
                self._mouse = (int(action["x"]), int(action["y"]))
            m.move(*self._mouse)
            self._timed("act_scroll", m.wheel, dx * NOTCH_PX, dy * NOTCH_PX)
        else:
            raise ValueError(f"unknown action type {t!r}")
        self._page.wait_for_timeout(300)  # let the page react, like the cloud round trip does
        return {"action": action, "ms": round((time.perf_counter() - p0) * 1000, 1),
                "exec_ms": None, "logs": []}
