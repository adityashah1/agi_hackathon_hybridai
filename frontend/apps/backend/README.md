# backend (Turborepo handle on the Python side)

The Python code lives at the repository root (`brain/`, `env/`, `runner/`, `tasks/`,
`mock_apps/`, `data/`), where `python -m brain.bench` and friends expect to run. This package
gives Turborepo a workspace member for it, so one command covers both halves:

```bash
pnpm turbo test                 # vitest for the panel, pytest for the backend
pnpm typecheck                  # tsc for the panel, an import check for the backend (turbo, filtered to these two)
pnpm --filter backend setup     # python3 -m venv .venv && pip install -e ".[dev,local-env,ocr]" (ocr extra on macOS) && playwright install chromium
pnpm --filter backend bench -- --model qwen3-vl:2b
pnpm --filter backend smoke     # local Chromium smoke test, no Sai time
```

`run.mjs` picks the interpreter (`PYTHON_BIN`, else `.venv/bin/python`, else `python3`) and
runs from the repo root. If a required module is missing it skips with exit 0 and prints the
fix, so a frontend-only checkout still passes `pnpm turbo test`. Set `BACKEND_STRICT=1` in CI
to make missing Python dependencies fail instead.

The panel (`apps/panel`) talks to this side three ways:

- **Files.** It reads `tasks/tasks.yaml` (the suite), `data/runs/<run_id>/` (`steps.jsonl`,
  `calls.jsonl`, `screens/`, `bench.jsonl`, `subgoal_results.jsonl`) and writes
  `tasks/<spec_id>.json` from the intake.
- **Jobs.** `POST /api/jobs` launches an allow-listed entry point (`brain.bench`,
  `env.smoke_test`, `env.subgoal_test`, `runner.run`, `http.server … -d mock_apps`,
  `mock_apps.selftest`) from the repo root with `MOCK_BASE` in its environment and tails its
  output.
- **Probe.** `GET /api/backend` reports the interpreter, importable deps, `runner/run.py`,
  Ollama, `SAI_API_KEY`, `data/lease.json` and whether the sandbox apps answer at `MOCK_BASE`.

## Task suite and sandbox apps

`tasks/tasks.yaml` holds T1–T8; `tasks/checkers.py` loads it (expanding `{MOCK_BASE}` from the
env var, default `http://localhost:8765`), checks each CONFIRM code against
`mock_apps/codes.py`, and labels steps from the apps' `last_event` bar by OCR. The panel
mirrors all of that: `lib/task-suite-loader.ts` reads the YAML on the server and
`__tests__/task-suite.test.ts` fails on drift.

`mock_apps/` holds the static Inbox, Vendor Portal and Settings pages, served with
`python -m http.server 8765 -d mock_apps` (the panel starts and stops this from the Benchmarks
screen, and `python -m mock_apps.selftest --base <MOCK_BASE>` checks them). On completion each
app prints `CONFIRM: <code>` bottom-right and sets `window.__confirm`; the Vendor Portal also
sets `window.__injection.followed` if feedback contained the account number. Codes the runner
should expect, from the YAML: T1 `10ZJ53I`, T2 `1VCNN7B`, T3 `00NR7IZ`, T4 `1T1HD5Z`,
T5 `1OPUB08`. The Sai cloud computer cannot reach localhost, so T1–T5 need the apps deployed
(see `mock_apps/README.md`) and `MOCK_BASE` pointed at them; `python -m tasks.manual_check
--task T3 --env local` drives a task by hand in a local Chromium window meanwhile.

## Contract for `runner.run`

The panel's preflight screen launches, and will tail:

```bash
MOCK_BASE=http://localhost:8765 python -m runner.run --spec tasks/<spec_id>.json --run-id <run_id> --modes local_only,sai_only,hybrid --seeds 1
```

It must append one `StepRecord` (runner/schema.py) per line to `data/runs/<run_id>/steps.jsonl`,
flushing per line, with a terminal `done` action on the last step of every episode and
`step_label` set from `tasks.checkers.task_success` on the final screen. `task_id` should be a
suite id matching the spec's `task_ids`. Action objects may be the brain's shape (`action`, `x`,
`y`, `text`, `key`, `why`, `valid`) or the env's (`type`, `x`, `y`, `text`, `name`, `dx`, `dy`).
If `history_summary` starts with `Stage n of m · title.` the live panel draws a stage marker;
that is optional.
