"""Local action proposer: a small vision-language model served by Ollama on this Mac.

Supported models (each has a profile in SPECS):
- "qwen3-vl:2b": Qwen3-VL-2B-Instruct (Ollama tag qwen3-vl:2b-instruct), Q4_K_M, about 1.8 GB. Generalist with strong grounding. Uses
  JSON-schema-constrained output. Coordinates are 0-1000 relative. Thinking is OFF (too slow).
- "ui-tars-2b": UI-TARS-2B-SFT, Q4_K_M plus an f16 vision projector, about 2.4 GB. Trained for
  GUI agents. Prompted in its NATIVE format ("Thought: ... Action: click(start_box='(x,y)')"),
  then parsed into our schema. Coordinates are 0-1000 relative. JSON is not forced on it,
  because forcing it would fight the training.
- "qwen2.5vl:3b": Qwen2.5-VL-3B, Q4_K_M, about 3.2 GB. JSON-constrained. Coordinates are
  absolute pixels in the image it sees. This is the model that froze the 8 GB Mac when only
  half of it fit on the GPU.

Runtime (checked 2026-11-08, Ollama 0.40.3): /api/chat returns per-token log-probabilities
and supports "format": <JSON schema>. The log-probs are the RAW distribution, measured
before any constraint applies, so tokens the grammar forces can score low. `mean_logprob`
therefore averages only the tokens of the decision itself: the action name, coordinates,
text and key. `mean_logprob_all` covers every output token.

Safety on this 8 GB Mac (CLAUDE.md rule 1):
- Refuses to load a model if system free memory is below MIN_FREE_PCT.
- Unloads any OTHER Ollama model first, so only one is ever resident.
- Screenshots shrink to <= 756 px wide (27 x 28 px patches); context is 2048 tokens.
- unload() frees the model right away.

Start the server yourself first:
    OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve
"""

from __future__ import annotations

import base64
import io
import json
import re
import subprocess
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import requests
from PIL import Image

OLLAMA = "http://localhost:11434"
PATCH = 28
MAX_W = 756
NUM_CTX = 2048
NUM_PREDICT = 160
MIN_FREE_PCT = 35

ACTIONS = ["click", "type", "key", "scroll", "done"]
KEYS = ["enter", "tab", "escape", "backspace", "up", "down", "pageup", "pagedown"]

SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ACTIONS},
        "x": {"type": "integer"},
        "y": {"type": "integer"},
        "text": {"type": "string"},
        "key": {"type": "string"},
        "why": {"type": "string", "maxLength": 120},
    },
    "required": ["action", "x", "y", "text", "key", "why"],
}


@dataclass(frozen=True)
class ModelSpec:
    name: str            # Ollama model name
    style: str           # "json" | "uitars"
    coords: str          # "pixel" (in the resized image) | "rel1000"
    extra: tuple = ()    # extra top-level request fields, e.g. (("think", False),)


SPECS = {
    # The plain "qwen3-vl:2b" tag is the THINKING variant: it ignores think=false and spends
    # ~120-300 hidden tokens reasoning (measured 2026-11-08). The instruct tag answers directly.
    "qwen3-vl:2b": ModelSpec("qwen3-vl:2b-instruct", "json", "rel1000", (("think", False),)),
    "ui-tars-2b": ModelSpec("hf.co/bartowski/UI-TARS-2B-SFT-GGUF:Q4_K_M", "uitars", "rel1000"),
    "qwen2.5vl:3b": ModelSpec("qwen2.5vl:3b", "json", "pixel"),
}
DEFAULT_MODEL = "qwen3-vl:2b"

_COORD_TEXT = {
    "pixel": "Coordinates are pixels in THIS {w}x{h} image, origin top-left.",
    "rel1000": "Coordinates are relative: x and y range 0-1000 across the image "
               "(0,0 = top-left, 1000,1000 = bottom-right).",
}

JSON_SYSTEM = """You operate a computer by proposing exactly ONE next GUI action.
{coord_text}
Actions:
- click: click at (x, y) on the element's center.
- type: type `text` into the currently focused field.
- key: press one key; `key` is one of enter, tab, escape, backspace, up, down, pageup, pagedown.
- scroll: scroll at (x, y); `key` is "up" or "down".
- done: the goal is already achieved on screen. If the goal asks a question, put the answer in `text`.
Set unused fields to 0 or "". Keep `why` under 15 words.
Reply with JSON only."""

# UI-TARS's own computer-use prompt, cut down to the actions our environments support.
UITARS_PROMPT = """You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
```
Thought: ...
Action: ...
```

## Action Space
click(start_box='<|box_start|>(x1,y1)<|box_end|>')
hotkey(key='')
type(content='')
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up')
finished()

## Note
- Use English in `Thought` part.
- Summarize your next action (with its target element) in one sentence in `Thought` part.
- hotkey takes a single key: enter, tab, escape, backspace, up, down, pageup, pagedown.

## User Instruction
{instruction}
"""


class BrainError(RuntimeError):
    pass


# ----------------------------------------------------------------- helpers
def free_memory_pct() -> Optional[int]:
    try:
        out = subprocess.run(["memory_pressure"], capture_output=True, text=True,
                             timeout=20).stdout
        m = re.search(r"free percentage:\s*(\d+)%", out)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def top_memory_processes(n: int = 6) -> list[str]:
    out = subprocess.run(["ps", "-axo", "rss=,comm="], capture_output=True, text=True).stdout
    rows = sorted((line.split(None, 1) for line in out.strip().splitlines()),
                  key=lambda r: -int(r[0]))[:n]
    return [f"{int(r[0]) / 1024:6.0f} MB  {r[1].rsplit('/', 1)[-1]}" for r in rows]


def resize_for_qwen(img: Image.Image, max_w: int = MAX_W) -> tuple[Image.Image, float, float]:
    """Resize so both sides are multiples of 28 and width <= max_w.
    Returns (img, sx, sy), where original_x = x / sx and original_y = y / sy."""
    if max_w > 1024:
        raise ValueError("max_w must be <= 1024 (CLAUDE.md rule 1)")
    w0, h0 = img.size
    tw = max(PATCH, min(max_w, w0) // PATCH * PATCH)
    th = max(PATCH, round(h0 * tw / w0 / PATCH) * PATCH)
    return img.convert("RGB").resize((tw, th), Image.LANCZOS), tw / w0, th / h0


def _spans_json(content: str) -> list[tuple[int, int]]:
    """Spans of decision values in JSON, without the surrounding quotes."""
    spans = []
    for k in ("action", "x", "y", "text", "key"):
        m = re.search(r'"%s"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+))' % k, content)
        if m:
            spans.append(m.span(1 if m.group(1) is not None else 2))
    return spans


_UITARS_ACTION = re.compile(r"Action:\s*(\w+)\((.*)\)", re.S)


def _spans_uitars(content: str) -> list[tuple[int, int]]:
    """Spans of the action name and every argument value in the Action: line."""
    m = _UITARS_ACTION.search(content)
    if not m:
        return []
    spans = [m.span(1)]
    base = m.start(2)
    for v in re.finditer(r"'((?:[^'\\]|\\.)*)'", m.group(2)):
        inner, off = v.group(1), base + v.start(1)
        nums = list(re.finditer(r"\d+", inner))
        if "(" in inner and nums:      # a box: count only the coordinate digits
            spans += [(off + d.start(), off + d.end()) for d in nums]
        else:                          # content / key / direction
            spans.append((off, off + len(inner)))
    return spans


def _mean_logprobs(logprobs: list[dict], spans: list[tuple[int, int]]):
    if not logprobs:
        return None, None
    lps = [t["logprob"] for t in logprobs]
    pos, picked = 0, []
    for t in logprobs:
        a, b = pos, pos + len(t.get("token", ""))
        if any((a < s1 and b > s0) if s1 > s0 else (a < s0 < b) for s0, s1 in spans):
            picked.append(t["logprob"])
        pos = b
    return (sum(picked) / len(picked) if picked else None), sum(lps) / len(lps)


def parse_uitars(content: str) -> tuple[dict, str]:
    """Map UI-TARS native output to our schema (coords still 0-1000). Returns (action, error)."""
    thought = re.search(r"Thought:\s*(.*?)(?:\n\s*Action:|$)", content, re.S)
    why = (thought.group(1).strip() if thought else "")[:120]
    m = _UITARS_ACTION.search(content)
    if not m:
        return {}, "no Action: line"
    name, args = m.group(1), m.group(2)
    base = {"x": 0, "y": 0, "text": "", "key": "", "why": why}
    pt = re.search(r"\(\s*(\d+)\s*,\s*(\d+)\s*\)", args)
    if name == "click":
        if not pt:
            return {}, "click without point"
        return {**base, "action": "click", "x": int(pt.group(1)), "y": int(pt.group(2))}, ""
    if name == "type":
        t = re.search(r"content='((?:[^'\\]|\\.)*)'", args)
        text = (t.group(1) if t else "").replace("\\n", "\n").rstrip("\n")
        return {**base, "action": "type", "text": text}, ""
    if name == "hotkey":
        k = re.search(r"key='([^']*)'", args)
        return {**base, "action": "key", "key": (k.group(1) if k else "").strip().lower()}, ""
    if name == "scroll":
        d = re.search(r"direction='(\w+)'", args)
        if not pt:
            return {}, "scroll without point"
        return {**base, "action": "scroll", "x": int(pt.group(1)), "y": int(pt.group(2)),
                "key": (d.group(1) if d else "").lower()}, ""
    if name == "finished":
        return {**base, "action": "done"}, ""
    return {}, f"unsupported action {name!r}"


def validate(a: Any, xmax: int, ymax: int) -> tuple[bool, str]:
    """Coordinates are checked in the model's own space: [0,xmax) x [0,ymax)."""
    if not isinstance(a, dict):
        return False, "not an object"
    act = a.get("action")
    if act not in ACTIONS:
        return False, f"bad action {act!r}"
    if act in ("click", "scroll"):
        x, y = a.get("x"), a.get("y")
        if not (isinstance(x, int) and isinstance(y, int) and 0 <= x < xmax and 0 <= y < ymax):
            return False, f"coords ({x},{y}) outside {xmax}x{ymax}"
    if act == "type" and not a.get("text"):
        return False, "type without text"
    if act == "key" and a.get("key") not in KEYS:
        return False, f"unsupported key {a.get('key')!r}"
    if act == "scroll" and a.get("key") not in ("up", "down"):
        return False, "scroll key must be up/down"
    return True, ""


def to_env_action(a: dict) -> Optional[dict]:
    """Convert a valid brain action into SaiEnv/LocalEnv.act() format (None for done)."""
    act = a["action"]
    if act == "click":
        return {"type": "click", "x": a["x"], "y": a["y"]}
    if act == "type":
        return {"type": "type", "text": a["text"]}
    if act == "key":
        return {"type": "key", "name": a["key"]}
    if act == "scroll":  # x, y = where to scroll (LocalEnv moves the mouse there first)
        return {"type": "scroll", "dx": 0, "dy": 3 if a["key"] == "down" else -3,
                "x": a.get("x"), "y": a.get("y")}
    return None


@dataclass
class Sample:
    action: dict                      # our schema; coords in ORIGINAL resolution when valid
    valid: bool
    error: str = ""
    raw: str = ""
    retried: bool = False
    latency_ms: float = 0.0           # measured
    tokens_in: int = 0                # measured: total prompt tokens (cached ones included)
    tokens_in_cached: int = 0
    tokens_out: int = 0
    mean_logprob: Optional[float] = None
    mean_logprob_all: Optional[float] = None
    ollama_ms: dict = field(default_factory=dict)


@dataclass
class Proposal:
    actions: list[dict]
    samples: list[Sample]
    latency_ms: float
    tokens_in: int
    tokens_out: int
    mean_logprob: Optional[float]
    image_size: tuple[int, int]
    original_size: tuple[int, int]
    model: str = ""


class LocalBrain:
    def __init__(self, model: str = DEFAULT_MODEL, max_w: int = MAX_W, num_ctx: int = NUM_CTX,
                 min_free_pct: int = MIN_FREE_PCT, keep_alive: str = "5m"):
        if model not in SPECS:
            raise BrainError(f"unknown model {model!r}; choose from {list(SPECS)}")
        self.key, self.spec = model, SPECS[model]
        self.model = self.spec.name
        self.max_w, self.num_ctx = max_w, num_ctx
        self.min_free_pct, self.keep_alive = min_free_pct, keep_alive
        self._s = requests.Session()

    # ------------------------------------------------------------- server
    def server_ok(self) -> bool:
        try:
            return self._s.get(f"{OLLAMA}/api/version", timeout=3).ok
        except requests.RequestException:
            return False

    def loaded_models(self) -> list[dict]:
        return self._s.get(f"{OLLAMA}/api/ps", timeout=10).json().get("models", [])

    def unload(self, model: str | None = None) -> None:
        self._s.post(f"{OLLAMA}/api/generate",
                     json={"model": model or self.model, "keep_alive": 0}, timeout=60)

    def ensure_ready(self) -> None:
        if not self.server_ok():
            raise BrainError("Ollama isn't running. In another terminal run:\n"
                             "  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve")
        loaded = self.loaded_models()
        for m in loaded:
            if m["name"] != self.model:
                print(f"[brain] unloading other model {m['name']} (one model at a time)")
                self.unload(m["name"])
        if any(m["name"] == self.model for m in loaded):
            return
        pct = free_memory_pct()
        if pct is not None and pct < self.min_free_pct:
            raise BrainError(
                f"only {pct}% memory free (< {self.min_free_pct}%); refusing to load "
                f"{self.model}. Quit something first. Biggest processes:\n  "
                + "\n  ".join(top_memory_processes()))

    def memory_report(self) -> dict:
        rep: dict[str, Any] = {}
        for m in self.loaded_models():
            if m["name"] == self.model:
                rep["ollama_size_mb"] = round(m["size"] / 2**20)
                rep["ollama_gpu_mb"] = round(m.get("size_vram", 0) / 2**20)
                rep["context_length"] = m.get("context_length")
        out = subprocess.run(["ps", "-axo", "rss=,command="], capture_output=True,
                             text=True).stdout
        rss = [int(l.split(None, 1)[0]) for l in out.splitlines()
               if "llama-server" in l or "ollama runner" in l]
        rep["runner_rss_mb"] = round(sum(rss) / 1024) if rss else None
        rep["system_free_pct"] = free_memory_pct()
        return rep

    # ------------------------------------------------------------ propose
    def _messages(self, goal: str, history: list[Any], img_b64: str, w: int, h: int):
        hist = [h_ if isinstance(h_, str) else json.dumps(h_, separators=(",", ":"))
                for h_ in history[-3:]]
        hist_txt = "\n".join(f"- {x}" for x in hist) if hist else "- none"
        if self.spec.style == "uitars":
            prompt = UITARS_PROMPT.format(instruction=goal)
            if hist:
                prompt += f"\n## Action History\n{hist_txt}\n"
            return [{"role": "user", "content": prompt, "images": [img_b64]}]
        system = JSON_SYSTEM.format(coord_text=_COORD_TEXT[self.spec.coords].format(w=w, h=h))
        user = (f"Goal: {goal}\nPrevious actions (oldest first):\n{hist_txt}\n"
                "What is the next action?")
        return [{"role": "system", "content": system},
                {"role": "user", "content": user, "images": [img_b64]}]

    def _call(self, messages, temperature: float, seed: int, num_predict: int) -> dict:
        body = {
            "model": self.model, "messages": messages, "stream": False, "logprobs": True,
            "keep_alive": self.keep_alive,
            "options": {"temperature": temperature, "seed": seed,
                        "num_ctx": self.num_ctx, "num_predict": num_predict},
            **dict(self.spec.extra),
        }
        if self.spec.style == "json":
            body["format"] = SCHEMA
        r = self._s.post(f"{OLLAMA}/api/chat", json=body, timeout=600)
        if r.status_code != 200:
            raise BrainError(f"ollama {r.status_code}: {r.text[:300]}")
        return r.json()

    def propose(self, goal: str, history: list[Any], screenshot: Image.Image,
                temperature: float = 0.0, n_samples: int = 1) -> Proposal:
        """Propose n_samples next actions; only the last 3 history entries are used.
        Returned coordinates are in the ORIGINAL screenshot resolution."""
        self.ensure_ready()
        small, sx, sy = resize_for_qwen(screenshot, self.max_w)
        w, h = small.size
        buf = io.BytesIO()
        small.save(buf, "PNG")
        messages = self._messages(goal, history, base64.b64encode(buf.getvalue()).decode(), w, h)

        t_call = time.perf_counter()
        samples = [self._sample(messages, temperature, seed=i, w=w, h=h, sx=sx, sy=sy,
                                orig=screenshot.size)
                   for i in range(n_samples)]
        latency = round((time.perf_counter() - t_call) * 1000, 1)
        valid_lps = [s.mean_logprob for s in samples if s.valid and s.mean_logprob is not None]
        return Proposal(
            actions=[{**s.action, "valid": s.valid} for s in samples], samples=samples,
            latency_ms=latency, tokens_in=sum(s.tokens_in for s in samples),
            tokens_out=sum(s.tokens_out for s in samples),
            mean_logprob=(sum(valid_lps) / len(valid_lps)) if valid_lps else None,
            image_size=(w, h), original_size=screenshot.size, model=self.key,
        )

    def _parse(self, content: str, w: int, h: int) -> tuple[dict, bool, str, list]:
        if self.spec.style == "uitars":
            a, err = parse_uitars(content)
            spans = _spans_uitars(content)
        else:
            try:
                a, err = json.loads(content), ""
            except json.JSONDecodeError as e:
                a, err = {}, f"invalid JSON: {e}"
            spans = _spans_json(content)
        if err:
            return a, False, err, spans
        xmax, ymax = (1001, 1001) if self.spec.coords == "rel1000" else (w, h)
        ok, err = validate(a, xmax, ymax)
        return a, ok, err, spans

    def _sample(self, messages, temperature, seed, w, h, sx, sy, orig) -> Sample:
        t0 = time.perf_counter()
        retried = False
        for attempt in range(2):  # retry once if unusable (helps mostly with truncation)
            j = self._call(messages, temperature, seed, NUM_PREDICT * (attempt + 1))
            content = j.get("message", {}).get("content", "")
            a, ok, err, spans = self._parse(content, w, h)
            if ok or attempt == 1:
                break
            retried = True
        dec, all_ = _mean_logprobs(j.get("logprobs") or [], spans)
        if ok:
            a = self._to_original(a, sx, sy, orig)
        return Sample(
            action=a if isinstance(a, dict) else {}, valid=ok, error=err, raw=content,
            retried=retried, latency_ms=round((time.perf_counter() - t0) * 1000, 1),
            # prompt_eval_count already includes cached tokens (verified 2026-11-08)
            tokens_in=j.get("prompt_eval_count", 0),
            tokens_in_cached=j.get("prompt_eval_cached_count", 0),
            tokens_out=j.get("eval_count", 0), mean_logprob=dec, mean_logprob_all=all_,
            ollama_ms={k: round(j.get(k, 0) / 1e6, 1) for k in
                       ("load_duration", "prompt_eval_duration", "eval_duration",
                        "total_duration")},
        )

    def _to_original(self, a: dict, sx: float, sy: float, size: tuple[int, int]) -> dict:
        out = dict(a)
        if a.get("action") in ("click", "scroll"):
            W, H = size
            if self.spec.coords == "rel1000":
                x, y = a["x"] / 1000 * W, a["y"] / 1000 * H
            else:
                x, y = a["x"] / sx, a["y"] / sy
            out["x"] = min(W - 1, max(0, round(x)))
            out["y"] = min(H - 1, max(0, round(y)))
        return out
