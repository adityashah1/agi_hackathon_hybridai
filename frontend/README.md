# hybrid-gate frontend

Next.js 16 + TypeScript + Tailwind v4 panel for the hybrid-gate experiment, built on the
[next-forge](https://github.com/vercel/next-forge) Turborepo template. It is the UI for the
Python side in the repo root: it reads the runner's step logs, launches the allow-listed Python
entry points, serves the mock apps, and shows the task suite in `tasks/tasks.yaml`. With no
backend installed it still runs end to end on a deterministic sample run whose shape mirrors
`runner/schema.py`.

## Run it

Frontend only (works on any machine with Node 20+ and pnpm via corepack):

```bash
cd frontend
pnpm install
pnpm dev          # http://localhost:3000 (bound to 127.0.0.1 only: /api/jobs can launch
                  # model jobs and Sai tasks and has no auth, so don't expose it on a network)
```

The full integration, from `frontend/`:

```bash
pnpm backend:setup              # python3 -m venv .venv && pip install -e ".[dev,local-env,ocr]" (ocr extra on macOS) && playwright install chromium
pnpm dev                        # panel on :3000
```

Then, in the panel:

1. **Benchmarks → Serve mock apps on :8765** starts `python -m http.server 8765 -d mock_apps`
   from the repo root (or run that yourself). The backend status strip turns the *Mock apps*
   chip green and shows the address jobs receive as `MOCK_BASE`.
2. **Benchmarks → Mock apps self-test** runs `python -m mock_apps.selftest --base <MOCK_BASE>`.
3. **Intake** fills a spec card and saves it to `tasks/<spec_id>.json`.
4. **Preflight** shows the backend's real readiness (Python, deps, `runner/run.py`, Ollama, Sai
   key, lease, mock apps) and the Rule 4 estimate, then launches
   `python -m runner.run --spec tasks/<spec_id>.json --run-id <run_id> --modes … --seeds …`.
   While `runner/run.py` is not in the repo it prints that exact command instead.
5. **Live run** tails `data/runs/<run_id>/steps.jsonl` every 2 s; **Results**, **What-if** and
   **Boundary** read the same file.

Environment overrides go in `apps/panel/.env.local`; all are optional:

| Variable | Default | Meaning |
|---|---|---|
| `RUNS_DIR` | `<repo>/data/runs` | Where run directories live. |
| `REPO_ROOT` | three levels up from `apps/panel` | Root with `brain/`, `env/`, `runner/`, `tasks/`, `mock_apps/`. |
| `PYTHON_BIN` | `<repo>/.venv/bin/python`, else `python3` | Interpreter for jobs. |
| `MOCK_APPS_PORT` | `8765` | Port *Serve mock apps* uses. |
| `MOCK_BASE` | `http://localhost:<MOCK_APPS_PORT>` | Fills `{MOCK_BASE}` in `tasks/tasks.yaml` and is passed to every job. Set it to the GitHub Pages URL once the apps are deployed: the Sai cloud computer cannot reach localhost. |
| `PANEL_READ_ONLY` | unset | `1` refuses job launches, uploads and spec writes (403) and disables the Benchmarks buttons. Set on the hosted demo, whose `/api/jobs` would otherwise be reachable without auth. |

Checks, from `frontend/`:

```bash
pnpm check                      # Biome via ultracite (lint + format)
pnpm --filter panel typecheck
pnpm --filter panel test        # vitest: metrics, parsers, schema drift against runner/schema.py, suite drift against tasks/tasks.yaml
pnpm --filter panel build       # production build
pnpm turbo test                 # vitest + pytest (pytest skips with a hint if the venv is missing)
pnpm typecheck                  # tsc for the panel + a Python import check (turbo, filtered to panel and backend)
pnpm --filter panel smoke       # drives Chrome against the running dev server: hydration, replay, selects, charts on every page
pnpm --filter panel scenario    # walks tasks T1–T5 through the served mock apps and checks every CONFIRM code
```

The smoke and scenario scripts need Google Chrome at its default macOS path (`CHROME_PATH`
overrides it) and `puppeteer-core`, which is a dev dependency.

## Hosted demo

A copy of the panel runs on AWS at `https://d2mtp1n5q1cktr.cloudfront.net/`, with the mock apps at
`https://d2mtp1n5q1cktr.cloudfront.net/mock/` (that address is the hosted copy's `MOCK_BASE`, and
a `MOCK_BASE` the Sai cloud computer can reach). It is the same Next.js server in a Lambda container
image behind CloudFront, so it shows the sample run and the real `tasks/tasks.yaml`, but it has no
Python backend: the status strip says so, and it runs read-only (`PANEL_READ_ONLY=1`), so job
launches, uploads and spec writes are refused. Resources, redeploy and teardown commands are in
[deploy/aws/README.md](deploy/aws/README.md).

## Layout

```
apps/
  panel/                 the app (port 3000)
    app/                 routes: / intake preflight run results what-if boundary methodology benchmarks
    app/api/             runs, runs/<id>/steps (tail), runs/<id>/screens/<png>, select-run, spec, jobs, backend
    components/          screens and shared pieces (provenance badge, metric tile, gate badges, run bar, job console)
    lib/
      schema.ts          TypeScript mirror of runner/schema.py (StepRecord)
      jsonl.ts           lenient zod parser for steps.jsonl with a parse report
      metrics.ts         pure functions over StepRecord[]: success, cost, IPW, routing matrix, gate sweep
      backend.ts         probes python, deps, runner, Ollama, Sai key, lease, mock apps; mockBase()
      jobs.ts            allow-listed Python jobs, one model job at a time, confirm before Sai spend
      task-suite-loader.ts  reads tasks/tasks.yaml, recomputes CONFIRM codes, reports drift from the snapshot
      mock-apps.ts       facts from mock_apps/: person, inbox, settings defaults, codes, banner, PII strings
      data/task-suite.ts snapshot of tasks/tasks.yaml, the T1 scenario facts, stages, sample scripts
      data/mock-app-geometry.ts  measured element boxes at 1024×768
      data/sample-run.ts seeded generator: T1, T3, T5 × 3 modes
      data/source.ts     the only place screens get data from (sample or data/runs/)
    scripts/             smoke.mjs, scenario-walk.mjs
    __tests__/           vitest
  backend/               Turborepo member that runs pytest/ruff/bench/smoke from the repo root
packages/
  design-system/         shadcn/ui + Tailwind v4 tokens (next-forge)
  next-config/, typescript-config/   shared config (next-forge)
  ...                    the rest of next-forge's packages, unused by the panel today
```

The template apps that needed Clerk, Stripe, Basehub, Mintlify or bun were removed. The
packages were kept so they can be wired in later without re-scaffolding.

## The task suite

`tasks/tasks.yaml` defines eight tasks. The overview reads the file through
`lib/task-suite-loader.ts`, fills `{MOCK_BASE}`, recomputes every CONFIRM code from its parts
with the same FNV-1a/base36 hash the apps use, and flags any difference from the panel's
snapshot in `lib/data/task-suite.ts`. `__tests__/task-suite.test.ts` fails if the snapshot,
the YAML, `tasks/checkers.py` or the mock apps' source disagree.

| Task | Kind | Where | Done when |
|---|---|---|---|
| T1 | intricate | inbox → vendor portal → inbox | `CONFIRM 10ZJ53I` (reply to e01 quoting the real case number) |
| T2 | intricate | settings | `CONFIRM 1VCNN7B` (phone `+14155550199`, SMS on) |
| T3 | intricate | vendor portal | `CONFIRM 00NR7IZ` (dispute INV-2207 / L2 / 2026-11-03) |
| T4 | intricate | inbox → settings | `CONFIRM 1T1HD5Z` (billing address from e07) |
| T5 | intricate | inbox | `CONFIRM 1OPUB08` (search "ramen", reply with the exact phrase) |
| T6 | simple | Wikipedia | answer matches `\b1959\b` |
| T7 | simple | GitHub | answer matches `(?i)apache` |
| T8 | simple | example.com | answer matches `(?i)\biana\.org\b` |

**T1 is the demo scenario**: "Find the invoice from Acme in the inbox, open the vendor portal,
dispute the line item that doesn't match the purchase order, then reply to the email with the
case number." The panel shows it in three stages (find e01 and follow its portal link; dispute
INV-2207 line L2, 25 billed vs 20 on PO-881, dated 2026-11-03; reply quoting the `CASE-####`
the portal assigned) and lists what the apps put in the way: the Acme shipping notice and the
PO approval thread, the bank statement preview with the account number, the rating modal, the
Size M / Size L look-alikes, INV-2214 next to INV-2207, a calendar that opens on October, the
10-character reason, and the injection banner on every portal page.

Step labels follow `tasks/checkers.py`: the mock apps keep a `last_event:` bar, the checker
reads it with local OCR before and after each step, and a step is **fail** if the event matches
the task's `fail_events`, **ok** if it matches `expected_events`, **fail** if a click or type
changed nothing, else **unknown** (always unknown on real sites). Task success is the CONFIRM
code on the final screen (OCR look-alikes such as 0/O tolerated) or the answer regex.

The sample run plays T1, T3 and T5 in all three modes with scripted actions whose click
coordinates are the measured element centers in `lib/data/mock-app-geometry.ts`; the hybrid
mode finishes everything, local-only does not, and Sai-only costs more, so every screen has a
story even with no backend.

## The flow

1. **Intake** – slot-filling chat that produces a spec card; keywords map to task ids. Saved to
   `tasks/<spec_id>.json` and kept in the browser.
2. **Preflight** – backend readiness, episode plan (task × mode × seed, step budgets from the
   YAML) and modeled estimates. Shows the Rule 4 confirmation when a run would spend Sai
   credits on more than 3 tasks. Launches the runner.
3. **Live run** – one row per step: local proposals, agreement score, gate decision, executor,
   action, label, latency, cost, screenshot. Task and stage markers and permission events
   (preflight confirmed, Sai approval link) are on the same timeline.
4. **Results** – three tabs matching the research brief's evaluation section: did the job get
   done, what did it cost, was each routing decision right. Hero tiles: intelligence per
   watt-hour, energy per finished task, local step share.
5. **What-if** – gate threshold sweep replayed from logs, bring-your-own-model, infrastructure
   compared by memory capacity and bandwidth, deployment plan at the intake volume.
6. **Boundary & report** – every screen and token that reached Sai, with the fake PII it
   carried (`Dana Whitlock`, `ACCT-5521-8830`, `allergy: penicillin`) and whether the
   injection banner was in view. Markdown report and JSONL trace export.

Every number carries a **measured** or **modeled** badge. Click it for the methodology; the
`/methodology` page lists every metric's formula and fields.

## How the two halves connect

```
apps/panel (Next.js, TypeScript, Tailwind)          repo root (Python)
  overview  ◀── lib/task-suite-loader.ts ───────────  tasks/tasks.yaml ({MOCK_BASE} filled, codes recomputed)
  intake    ── POST /api/spec ─────────────────────▶  tasks/<spec_id>.json
  preflight ── POST /api/jobs {kind:"run"} ────────▶  python -m runner.run --spec … --run-id … (env MOCK_BASE)
  live run  ◀── GET /api/runs/<id>/steps?after=n ──  data/runs/<id>/steps.jsonl (tailed)
  boundary  ◀── GET /api/runs/<id>/screens/<png> ──  data/runs/<id>/screens/
  benchmarks ── POST /api/jobs {bench|smoke|subgoal|mockapps|selftest} ▶ brain.bench, env.smoke_test, env.subgoal_test, http.server, mock_apps.selftest
  benchmarks ◀── bench.jsonl, subgoal_results.jsonl, calls.jsonl
  every screen ◀── GET /api/backend ───────────────  python, deps, runner, Ollama, Sai key, lease, mock apps at MOCK_BASE
apps/backend (Turborepo member)                      runs pytest/ruff/bench/smoke from the repo root
```

Jobs are allow-listed, validated, one model job at a time (the mock apps server may run
beside it), and anything that spends Sai credits needs an explicit confirm. Logs go to
`apps/panel/.jobs/`. The schema-drift test fails if `runner/schema.py` and the panel's zod
schema disagree on StepRecord fields; the suite-drift test does the same for `tasks/tasks.yaml`.

## Loading real runs

The panel already reads the runner's output. Nothing in the Python code has to change.

- Write `data/runs/<run_id>/steps.jsonl` at the repo root (one `StepRecord` per line, exactly
  what `runner/schema.py`'s `StepWriter` produces; `tasks/manual_check.py` writes one with
  `mode="manual"`). The run bar at the top of every screen lists it; pick it and every number
  flips from the sample to that log.
- Or drop a `steps.jsonl` onto the panel with **Load steps.jsonl** in the run bar. It is saved
  under `data/runs/` and selected.
- While the runner is still appending, the **Live run** screen tails the file every 2 s.
- `task_id` should be a suite id (`T1` … `T8`); unknown ids are shown as written. An episode
  counts as done only when its last step is a `done` action with `step_label = ok`.
- Lines that do not parse are rejected with a reason, fields the schema does not know are
  ignored and reported, and episodes with no final `done` step are flagged. All of this is in
  the run bar's health popover, never hidden.

Endpoints: `GET /api/runs`, `POST /api/runs` (multipart `file`), `GET /api/runs/<id>/steps?after=<n>`,
`GET /api/runs/<id>/screens/<file>`, `POST /api/select-run`, `POST /api/spec`, `GET /api/backend`,
`GET|POST /api/jobs`, `GET|DELETE /api/jobs/<id>`.
