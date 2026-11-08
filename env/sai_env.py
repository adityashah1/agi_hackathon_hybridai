"""Thin client for Simular Sai: direct control (lease, screenshot, act) and Sai tasks.

Docs: https://platform.simular.ai/documentation/llms.txt
- Direct control: /v1/machines/{machineId}/control  (POST open, GET read, POST /exec,
  POST /interrupt, DELETE close). There is no lease id: the machineId + API key is the handle.
- Tasks: POST /v1/agents/message (wait:false) -> {sessionId, turnId, machineId, queued};
  then long-poll GET /v1/agents/events?sessionId=&since=&wait=; final record at
  GET /v1/agents/turns/{turnId}.

Standing rules this file enforces (see CLAUDE.md):
- It never closes a lease. There is no close() method on purpose. On the free plan, closing
  deletes the computer's disk.
- Link-only approvals: it prints approvalUrl and keeps waiting for the user.
- Every HTTP call is timed and appended to data/runs/<run_id>/calls.jsonl.

Things the docs leave unstated, so this code treats them as unverified:
- machine.scroll({direction}) has no documented amount. Here dx/dy count scroll "notches"
  (one call per notch).
- Key names for machine.press({key}) are not listed.
- Screen resolution isn't documented. We take it from the screenshot's own pixel size.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

import requests
from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEASE_PATH = ROOT / "data" / "lease.json"
DEFAULT_BASE_URL = "https://api.simular.ai"


class SaiError(RuntimeError):
    def __init__(self, msg: str, status: int | None = None, body: Any = None):
        super().__init__(msg)
        self.status = status
        self.body = body


class LeaseLost(SaiError):
    """The lease is gone: 410 control_closed, or 404 control_not_open."""


class ExecError(SaiError):
    """A Simulang block ran but did not finish (exception, timeout or interrupted)."""


@dataclass
class CallRecord:
    op: str
    method: str
    path: str
    status: int | None
    ms: float
    t_start: float
    note: str = ""


@dataclass
class SaiTaskResult:
    session_id: str
    turn_id: Optional[str]
    status: str                       # turn status (succeeded|failed|...) or events status
    final_text: Optional[str]
    elapsed_s: float                  # measured, client wall clock
    model_calls: Optional[int]        # from events usage.modelCalls; None if not exposed
    steps: Optional[int]              # trajectory step count; None if not recorded
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    cost_usd_estimate: Optional[float]  # events usage.costUsd: the API's live estimate, not billing
    credits_before_usd: Optional[float]
    credits_after_usd: Optional[float]
    credits_delta_usd: Optional[float]  # measured from the account balance; may lag billing
    reason_code: Optional[str] = None
    approvals_seen: list[dict[str, Any]] = field(default_factory=list)
    trajectory: list[dict[str, Any]] = field(default_factory=list)
    raw_turn: Optional[dict[str, Any]] = None


def _js(s: str) -> str:
    """Safely embed a Python string as a JS string literal."""
    return json.dumps(s)


class SaiEnv:
    def __init__(
        self,
        run_id: str,
        api_key: str | None = None,
        base_url: str | None = None,
        lease_path: str | Path = DEFAULT_LEASE_PATH,
        verbose: bool = True,
    ):
        load_dotenv(ROOT / ".env")
        self.api_key = api_key or os.environ.get("SAI_API_KEY")
        if not self.api_key:
            raise SaiError("SAI_API_KEY not set (put it in .env)")
        self.base_url = (base_url or os.environ.get("SAI_API_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.run_id = run_id
        self.run_dir = ROOT / "data" / "runs" / run_id
        self.screens_dir = self.run_dir / "screens"
        self.screens_dir.mkdir(parents=True, exist_ok=True)
        self.lease_path = Path(lease_path)
        self.verbose = verbose

        self.machine_id: Optional[str] = None
        self.screen_size: Optional[tuple[int, int]] = None  # (w, h) in original pixels
        self.last_screenshot_path: Optional[Path] = None
        self.last_screenshot_hash: Optional[str] = None
        self.calls: list[CallRecord] = []
        # continue numbering if this run_id already has screenshots (don't overwrite)
        self._shot_idx = len(list(self.screens_dir.glob("*.png")))
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"Bearer {self.api_key}"
        self._keepalive_stop: Optional[threading.Event] = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ http
    def _log(self, *a: Any) -> None:
        if self.verbose:
            print("[sai]", *a, flush=True)

    def _request(
        self, op: str, method: str, path: str, *, timeout: float = 60, ok=(200,), **kw: Any
    ) -> tuple[int, Any]:
        url = self.base_url + path
        t0 = time.time()
        p0 = time.perf_counter()
        status: int | None = None
        try:
            r = self._session.request(method, url, timeout=timeout, **kw)
            status = r.status_code
            try:
                body = r.json() if r.content else None
            except ValueError:
                body = r.text
            return status, body
        finally:
            ms = (time.perf_counter() - p0) * 1000
            rec = CallRecord(op, method, path, status, round(ms, 1), t0)
            self.calls.append(rec)
            with open(self.run_dir / "calls.jsonl", "a") as f:
                f.write(json.dumps(rec.__dict__) + "\n")

    @staticmethod
    def _err(body: Any) -> str:
        if isinstance(body, dict):
            return f"{body.get('error')}: {body.get('message', '')}".strip()
        return str(body)[:300]

    # -------------------------------------------------------------- account
    def account(self) -> dict:
        s, b = self._request("account", "GET", "/v1/agents/account", timeout=15)
        if s != 200:
            raise SaiError(f"account failed {s}: {self._err(b)}", s, b)
        return b

    def credits_usd(self) -> Optional[float]:
        try:
            c = self.account().get("credits")
            return None if not c else c.get("usd")
        except Exception:
            return None

    def list_machines(self) -> list[dict]:
        s, b = self._request("list_machines", "GET", "/v1/agents/machines")
        if s != 200:
            raise SaiError(f"list machines failed {s}: {self._err(b)}", s, b)
        return b.get("machines", [])

    def live_url(self, machine_id: str | None = None) -> dict:
        """POST /v1/agents/machines/{id}/live -> {liveUrl, expiresAt, websocketUrl, width, height}.
        A browser link for watching the screen live, valid for 30 minutes. Treat it like a
        secret: the docs don't say whether opening it needs a sign-in. Revoke every link with
        revoke_live_urls(). Fails with 409 machine_not_running while the computer is asleep."""
        mid = machine_id or self.machine_id
        if not mid:
            raise SaiError("live_url needs a machine_id")
        s, b = self._request("live_url", "POST", f"/v1/agents/machines/{mid}/live")
        if s != 200:
            raise SaiError(f"live view failed {s}: {self._err(b)}", s, b)
        return b

    def revoke_live_urls(self, machine_id: str | None = None) -> dict:
        mid = machine_id or self.machine_id
        s, b = self._request("revoke_live", "DELETE", f"/v1/agents/machines/{mid}/live")
        return {"status": s, **(b if isinstance(b, dict) else {})}

    # ---------------------------------------------------------------- lease
    def _save_lease(self, info: dict) -> None:
        self.lease_path.parent.mkdir(parents=True, exist_ok=True)
        info = {**info, "savedAt": int(time.time() * 1000)}
        self.lease_path.write_text(json.dumps(info, indent=2))

    def _load_lease(self) -> Optional[dict]:
        if self.lease_path.exists():
            try:
                return json.loads(self.lease_path.read_text())
            except ValueError:
                return None
        return None

    def lease_status(self, machine_id: str | None = None) -> Optional[dict]:
        """GET /control. Returns the lease dict, or None when no lease is open for this key."""
        mid = machine_id or self.machine_id
        s, b = self._request("lease_status", "GET", f"/v1/machines/{mid}/control", timeout=30)
        if s == 200:
            return b
        if s == 404:
            return None
        raise SaiError(f"lease status failed {s}: {self._err(b)}", s, b)

    def open_or_reuse_lease(self, machine_id: str | None = None, max_wait_s: float = 300) -> dict:
        """Reuse the lease saved in data/lease.json if it's still open, otherwise open one.

        Opening can take up to ~3 minutes (cold start, or waiting for a Sai task to finish).
        """
        saved = self._load_lease()
        mid = machine_id or (saved or {}).get("machineId")
        if mid:
            st = self.lease_status(mid)
            if st and st.get("status") == "open":
                # GET /control can still say "open" after an idle timeout (seen 2026-11-08),
                # so prove the lease works with a no-op exec before reusing it.
                self.machine_id = mid
                try:
                    self.exec("1", timeout_ms=5_000, op="lease_probe")
                    self._save_lease({**(saved or {}), **st, "reused": True})
                    self._log(f"reusing open lease on {mid}")
                    return st
                except LeaseLost as e:
                    st = {"closedReason": str(e)}
                    self.machine_id = None
            if saved:
                self._log(
                    f"saved lease on {mid} is no longer open "
                    f"({(st or {}).get('closedReason', 'not open')}); reopening. "
                    "On the free plan the computer's disk starts fresh."
                )
        if not mid:
            ms = self.list_machines()
            cloud = [m for m in ms if m.get("kind") == "cloud"]
            if len(cloud) != 1:
                raise SaiError(
                    f"need exactly one cloud machine or an explicit machine_id; got {cloud}"
                )
            mid = cloud[0]["machineId"]

        deadline = time.time() + max_wait_s
        while True:
            self._log(f"opening lease on {mid} (may take up to ~3 min)...")
            s, b = self._request(
                "open_lease", "POST", f"/v1/machines/{mid}/control", timeout=240
            )
            if s in (200, 201):
                self.machine_id = mid
                self._save_lease({**b, "status": "open", "openedHttp": s})
                self._log(f"lease {'reused' if s == 200 else 'opened'}: {b}")
                return b
            code = b.get("error") if isinstance(b, dict) else None
            if s == 503 and time.time() < deadline:
                wait = 15
                self._log(f"{code}; retrying in {wait}s")
                time.sleep(wait)
                continue
            raise SaiError(f"open lease failed {s}: {self._err(b)}", s, b)

    def _require_lease(self) -> str:
        if not self.machine_id:
            raise SaiError("no lease: call open_or_reuse_lease() first")
        return self.machine_id

    # ----------------------------------------------------------------- exec
    def exec(self, code: str, timeout_ms: int = 120_000, op: str = "exec") -> dict:
        mid = self._require_lease()
        with self._lock:
            s, b = self._request(
                op,
                "POST",
                f"/v1/machines/{mid}/control/exec",
                json={"code": code, "timeoutMs": timeout_ms},
                timeout=timeout_ms / 1000 + 45,
            )
        if s == 200:
            if b.get("error"):
                e = b["error"]
                raise ExecError(f"{e.get('kind')}: {e.get('message')}", s, b)
            return b
        if s in (404, 410):
            reason = b.get("reason") if isinstance(b, dict) else None
            saved = self._load_lease() or {}
            self._save_lease({**saved, "status": "closed", "closedReason": reason or self._err(b)})
            raise LeaseLost(f"lease lost ({s} {self._err(b)} reason={reason})", s, b)
        raise SaiError(f"exec failed {s}: {self._err(b)}", s, b)

    def keepalive_once(self) -> None:
        self.exec("1", timeout_ms=5_000, op="keepalive")

    def start_keepalive(self, every_s: float = 240) -> None:
        """Keep the lease from hitting its 600s idle timeout. Stop it before running a Sai task:
        a task only takes the computer once the lease has been quiet for about 2 minutes."""
        self.stop_keepalive()
        stop = threading.Event()
        self._keepalive_stop = stop

        def loop() -> None:
            while not stop.wait(every_s):
                try:
                    self.keepalive_once()
                except Exception as e:  # noqa: BLE001
                    self._log(f"keepalive failed: {e}")

        threading.Thread(target=loop, daemon=True, name="sai-keepalive").start()

    def stop_keepalive(self) -> None:
        if self._keepalive_stop:
            self._keepalive_stop.set()
            self._keepalive_stop = None

    # ----------------------------------------------------------- screenshot
    def _grab_screen_b64(self) -> tuple[str, str]:
        """Capture the full screen. Prefer exec's observations.screenshot. If the API leaves
        it out for size, read the base64 back in chunks from a persisted var."""
        r = self.exec(
            "var __shot = await machine.pageContent(); "
            "({len: __shot.imageBase64 ? __shot.imageBase64.length : 0})",
            op="screenshot",
        )
        obs = (r.get("observations") or {}).get("screenshot")
        if obs and obs.get("base64"):
            return obs["base64"], obs.get("mimeType", "image/png")
        n = (r.get("result") or {}).get("len", 0) if isinstance(r.get("result"), dict) else 0
        if not n:
            raise SaiError(f"screenshot returned no image: {json.dumps(r)[:400]}")
        chunk, parts = 180_000, []
        for i in range(0, n, chunk):
            part = self.exec(f"__shot.imageBase64.slice({i}, {i + chunk})", op="screenshot_chunk")
            parts.append(part["result"])
        return "".join(parts), "image/png"

    def screenshot(self, tag: str | None = None) -> Image.Image:
        """Full-resolution screenshot as a PIL image. Saved as PNG under
        data/runs/<run_id>/screens/. Sets screen_size to the original resolution."""
        b64, mime = self._grab_screen_b64()
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        img.load()
        self.screen_size = img.size
        name = f"{self._shot_idx:04d}{'_' + tag if tag else ''}.png"
        self._shot_idx += 1
        path = self.screens_dir / name
        if mime == "image/png":
            path.write_bytes(raw)
        else:
            img.save(path, "PNG")
        self.last_screenshot_path = path
        self.last_screenshot_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        del raw, b64
        return img

    @staticmethod
    def resize_for_model(img: Image.Image, max_w: int = 1024) -> tuple[Image.Image, float]:
        """Downscale for the local model (CLAUDE.md rule 1). Returns (small_img, scale), where
        original_xy = small_xy / scale."""
        if img.width <= max_w:
            return img, 1.0
        scale = max_w / img.width
        return img.resize((max_w, round(img.height * scale)), Image.LANCZOS), scale

    # ------------------------------------------------------------------ act
    def act(self, action: dict) -> dict:
        """Run one GUI action. Coordinates are in the ORIGINAL screen resolution.

        {"type": "click", "x": int, "y": int}
        {"type": "type",  "text": str}
        {"type": "key",   "name": str}            single key; verified: "enter", "Escape"
        {"type": "scroll","dx": int, "dy": int}   notches; +dy = down, +dx = right
        Returns {"action", "ms", "exec_ms", "logs"}.
        """
        t = action.get("type")
        if t == "click":
            x, y = int(action["x"]), int(action["y"])
            if self.screen_size:
                w, h = self.screen_size
                if not (0 <= x < w and 0 <= y < h):
                    raise ValueError(f"click ({x},{y}) outside screen {w}x{h}")
            code = f"await machine.click({{ x: {x}, y: {y} }}); 'ok'"
        elif t == "type":
            code = f"await machine.type({{ text: {_js(str(action['text']))} }}); 'ok'"
        elif t == "key":
            name = str(action["name"])
            if "+" in name and len(name) > 1:
                # Verified on the live API: "ctrl+l", "Ctrl+L", "control+l", "ctrl-l" are all
                # "Unknown key string", and a `modifiers` field is silently ignored.
                # The combo format isn't documented, so refuse rather than press the wrong key.
                raise NotImplementedError(f"key combos not supported yet: {name!r}")
            code = f"await machine.press({{ key: {_js(name)} }}); 'ok'"
        elif t == "scroll":
            dx, dy = int(action.get("dx", 0)), int(action.get("dy", 0))
            steps = []
            if dy:
                steps += [("down" if dy > 0 else "up")] * abs(dy)
            if dx:
                steps += [("right" if dx > 0 else "left")] * abs(dx)
            if not steps:
                raise ValueError("scroll needs nonzero dx or dy")
            code = (
                f"for (var __d of {json.dumps(steps)}) "
                "{ await machine.scroll({ direction: __d }); } 'ok'"
            )
        else:
            raise ValueError(f"unknown action type {t!r}")
        p0 = time.perf_counter()
        r = self.exec(code, op=f"act_{t}")
        return {
            "action": action,
            "ms": round((time.perf_counter() - p0) * 1000, 1),
            "exec_ms": r.get("durationMs"),
            "logs": r.get("logs", []),
        }

    def open_url(self, url: str, app: str = "chrome") -> dict:
        """Open a URL in a browser. Tries machine.open({app, url}) first, then falls back to
        machine.browser.newtab(url). Returns which one worked."""
        try:
            r = self.exec(
                f"await machine.open({{ app: {_js(app)}, url: {_js(url)} }}); 'open'",
                op="open_url",
            )
            return {"method": "machine.open", "app": app, "result": r.get("result")}
        except ExecError as e:
            self._log(f"machine.open failed ({e}); falling back to browser.newtab")
            r = self.exec(f"var __page = await machine.browser.newtab({_js(url)}); 'newtab'",
                          op="open_url_fallback")
            return {"method": "machine.browser.newtab", "result": r.get("result")}

    # ---------------------------------------------------------------- tasks
    def start_sai_task(
        self,
        instruction: str,
        machine_id: str | None = None,
        record_trajectory: bool = True,
        new_session: bool = False,
    ) -> dict:
        """POST /v1/agents/message with wait:false. Returns {sessionId, turnId, machineId,
        queued, ms, credits_before_usd}. Fails if a link-only approval is needed before start."""
        mid = machine_id or self.machine_id
        if not mid:
            raise SaiError("start_sai_task needs a machine_id")
        if new_session:
            s, b = self._request("new_session", "POST", "/v1/agents/new-session",
                                 json={"machineId": mid})
            if s != 200:
                raise SaiError(f"new-session failed {s}: {self._err(b)}", s, b)
        credits_before = self.credits_usd()
        body: dict[str, Any] = {"message": instruction, "machineId": mid, "wait": False}
        if record_trajectory:
            body["options"] = {"recordTrajectory": True}
        p0 = time.perf_counter()
        s, b = self._request("start_task", "POST", "/v1/agents/message", json=body, timeout=240)
        ms = round((time.perf_counter() - p0) * 1000, 1)
        if s not in (200, 202) or not isinstance(b, dict) or "sessionId" not in b:
            raise SaiError(f"start task failed {s}: {self._err(b)}", s, b)
        out = {**b, "ms": ms, "credits_before_usd": credits_before, "t_start": time.time()}
        self._log(f"task started: session={b['sessionId']} turn={b.get('turnId')}")
        return out

    def wait_sai_task(
        self,
        session_id: str,
        turn_id: str | None = None,
        started: dict | None = None,
        timeout_s: float = 900,
        on_approval: Callable[[dict], Optional[str]] | None = None,
        on_progress: Callable[[str], None] | None = None,
    ) -> SaiTaskResult:
        """Long-poll /events until the turn is idle or error, then read the turn record.

        Approvals: a link-only approval prints approvalUrl and keeps waiting (rule 3). Any
        other approval goes to on_approval(approval) -> "yes"|"no"|"task"|None. The default
        handler prints it and answers "no".
        """
        t_start = (started or {}).get("t_start", time.time())
        credits_before = (started or {}).get("credits_before_usd")
        since: Optional[str] = None
        approvals: list[dict] = []
        usage: dict = {}
        text: Optional[str] = None
        ev_status = "running"
        seen_approval_ids: set[str] = set()
        deadline = time.time() + timeout_s

        while time.time() < deadline:
            params = {"sessionId": session_id, "wait": 30}
            if since:
                params["since"] = since
            s, b = self._request("poll_events", "GET", "/v1/agents/events",
                                 params=params, timeout=90)
            if s == 429:
                self._log("events rate limited; sleeping 60s")
                time.sleep(60)
                continue
            if s != 200:
                raise SaiError(f"events failed {s}: {self._err(b)}", s, b)
            since = b.get("cursor") or since
            ev_status = b.get("status", ev_status)
            usage = b.get("usage") or usage
            text = b.get("text", text)
            for ev in b.get("events", []):
                if ev.get("type") == "data-progress" and on_progress:
                    on_progress((ev.get("data") or {}).get("text", ""))
                if ev.get("type") in ("error", "tool-output-error"):
                    self._log(f"event {ev.get('type')}: {ev.get('errorText')} {ev.get('code', '')}")
            if ev_status == "needs_approval":
                ap = b.get("approval") or {}
                aid = ap.get("approvalId")
                if aid and aid not in seen_approval_ids:
                    seen_approval_ids.add(aid)
                    approvals.append(ap)
                    if ap.get("isLinkOnly"):
                        print("\n" + "=" * 70)
                        print("Sai needs a human approval in the browser:")
                        print(f"  {ap.get('title')}: {ap.get('description')}")
                        print(f"  OPEN: {ap.get('approvalUrl')}")
                        print("Waiting for you to finish it...")
                        print("=" * 70 + "\n", flush=True)
                    else:
                        handler = on_approval or self._default_approval
                        resp = handler(ap)
                        if resp:
                            self._request("approve", "POST", "/v1/agents/approve",
                                          json={"approvalId": aid, "response": resp})
                continue
            if ev_status in ("idle", "error"):
                break
        else:
            ev_status = "timeout"

        elapsed = round(time.time() - t_start, 2)
        turn = self.get_turn(turn_id) if turn_id else None
        if turn and turn.get("status") == "finalizing":
            for _ in range(20):
                time.sleep(3)
                turn = self.get_turn(turn_id)
                if turn.get("status") in ("succeeded", "failed"):
                    break
        steps, traj = None, []
        if turn_id:
            traj = self.get_trajectory(turn_id)
            steps = len(traj) if traj else None
        credits_after = self.credits_usd()
        tu = (turn or {}).get("usage") or {}
        return SaiTaskResult(
            session_id=session_id,
            turn_id=turn_id,
            status=(turn or {}).get("status") or ev_status,
            final_text=(turn or {}).get("output") if turn and turn.get("output") is not None
            else text,
            elapsed_s=elapsed,
            model_calls=usage.get("modelCalls"),
            steps=steps,
            input_tokens=tu.get("inputTokens", usage.get("inputTokens")),
            output_tokens=tu.get("outputTokens", usage.get("outputTokens")),
            cost_usd_estimate=usage.get("costUsd"),
            credits_before_usd=credits_before,
            credits_after_usd=credits_after,
            credits_delta_usd=(round(credits_before - credits_after, 4)
                               if credits_before is not None and credits_after is not None
                               else None),
            reason_code=(turn or {}).get("reason_code"),
            approvals_seen=approvals,
            trajectory=traj,
            raw_turn=turn,
        )

    def _default_approval(self, ap: dict) -> str:
        print(f"[sai] approval requested ({ap.get('approvalType')}): {ap.get('title')} "
              f"{ap.get('command', '')} -> answering 'no' (pass on_approval to change)")
        return "no"

    def get_turn(self, turn_id: str) -> Optional[dict]:
        s, b = self._request("get_turn", "GET", f"/v1/agents/turns/{turn_id}")
        return b if s == 200 else None

    def get_trajectory(self, turn_id: str) -> list[dict]:
        s, b = self._request("get_trajectory", "GET", f"/v1/agents/turns/{turn_id}/trajectory")
        if s != 200 or not isinstance(b, dict):
            return []
        return b.get("steps", [])

    def save_trajectory_screenshot(self, turn_id: str, index: int, tag: str = "") -> Optional[Path]:
        """Download the JPEG of trajectory step `index` into the screens dir (as PNG)."""
        url = f"/v1/agents/turns/{turn_id}/trajectory/screenshots/{index}"
        p0, t0 = time.perf_counter(), time.time()
        r = self._session.get(self.base_url + url, timeout=60)
        rec = CallRecord("traj_screenshot", "GET", url, r.status_code,
                         round((time.perf_counter() - p0) * 1000, 1), t0)
        self.calls.append(rec)
        with open(self.run_dir / "calls.jsonl", "a") as f:
            f.write(json.dumps(rec.__dict__) + "\n")
        if r.status_code != 200:
            return None
        img = Image.open(io.BytesIO(r.content))
        path = self.screens_dir / f"{self._shot_idx:04d}_traj{index}{'_' + tag if tag else ''}.png"
        self._shot_idx += 1
        img.save(path, "PNG")
        return path

    def browser_reset(self, url: str = "about:blank") -> list[dict]:
        """Leave exactly one tab open, at `url`, using Sai's browser API (direct control).
        NOTE: the first machine.browser.* call relaunches Chrome under CDP control, which
        closes any manually opened Chrome windows. Returns the tabs after the reset."""
        r = self.exec(
            "var __old = await machine.browser.listTabs(); "
            f"var __p = await machine.browser.newtab({_js(url)}); "
            "for (var __t of __old) { try { await machine.browser.closeTab(__t.tabId); } catch (e) {} } "
            "await machine.browser.listTabs()",
            op="browser_reset",
        )
        return r.get("result") or []

    def list_tabs(self) -> list[dict]:
        return self.exec("await machine.browser.listTabs()", op="list_tabs").get("result") or []

    def abort_task(self, session_id: str) -> dict:
        s, b = self._request("abort", "POST", "/v1/agents/abort", json={"sessionId": session_id})
        return {"status": s, **(b if isinstance(b, dict) else {})}
