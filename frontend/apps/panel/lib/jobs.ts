import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  getBackendStatus,
  mockAppsPort,
  mockBase,
  pythonBin,
  repoRoot,
} from "./backend";
import { isSafeRunId } from "./run-cookie";

/**
 * Launches the Python entry points from the panel and keeps their logs.
 *
 * Only an allow-list of commands can run, every argument is validated, one
 * model-using job runs at a time (CLAUDE.md rule 1), and anything that spends
 * Sai credits needs an explicit confirm flag (rule 4). Jobs live in the Next
 * server process; logs are appended to apps/panel/.jobs/<job_id>.log.
 */

export type JobKind =
  | "bench"
  | "smoke"
  | "subgoal"
  | "run"
  | "mockapps"
  | "selftest";
export type JobStatus = "running" | "succeeded" | "failed" | "stopped";

export interface JobRecord {
  /** Command line as spawned, python binary first. */
  command: string[];
  cwd: string;
  endedAt: string | null;
  exitCode: number | null;
  id: string;
  kind: JobKind;
  lineCount: number;
  logPath: string;
  note: string;
  /** The data/runs directory this job writes, when it is known in advance. */
  runId: string | null;
  startedAt: string;
  status: JobStatus;
}

interface JobInternal extends JobRecord {
  lines: string[];
  proc: ChildProcess | null;
}

export class JobError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type StartJobRequest =
  | { kind: "bench"; model: string; maxW?: number }
  | { kind: "smoke"; env: "local" | "sai" }
  | { kind: "subgoal"; confirm?: boolean }
  | {
      kind: "run";
      spec_id: string;
      run_id: string;
      modes: string[];
      seeds?: number;
      confirm?: boolean;
    }
  | { kind: "mockapps" }
  | { kind: "selftest" };

/** Keys of brain/local_brain.py SPECS. */
export const BENCH_MODELS = [
  "qwen3-vl:2b",
  "ui-tars-2b",
  "qwen2.5vl:3b",
] as const;

/** Long-running servers do not hold the local model, so they may run beside one model job. */
const SERVER_KINDS: ReadonlySet<JobKind> = new Set<JobKind>(["mockapps"]);

const MAX_LINES = 2000;
const MODE_NAME = /^[a-z][a-z0-9_]{0,40}$/;
const ID_CHARS = /[-:.TZ]/g;
const LINE_BREAK = /\r?\n/;

const registryKey = "__hybridGateJobs";
const globalStore = globalThis as Record<string, unknown>;
if (!globalStore[registryKey]) {
  globalStore[registryKey] = new Map<string, JobInternal>();
}
const registry = globalStore[registryKey] as Map<string, JobInternal>;

const jobsDir = () => path.join(process.cwd(), ".jobs");

const strip = (j: JobInternal): JobRecord => {
  const { proc: _proc, lines: _lines, ...rest } = j;
  return { ...rest, lineCount: j.lines.length };
};

export const listJobs = (): JobRecord[] =>
  [...registry.values()]
    .map(strip)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

export const getJob = (id: string): JobRecord | null => {
  const j = registry.get(id);
  return j ? strip(j) : null;
};

export const readJobLog = (
  id: string,
  after: number
): { lines: string[]; total: number } | null => {
  const j = registry.get(id);
  if (!j) {
    return null;
  }
  const start = Math.max(0, Math.min(after, j.lines.length));
  return { lines: j.lines.slice(start), total: j.lines.length };
};

export const stopJob = (id: string): JobRecord | null => {
  const j = registry.get(id);
  if (!j) {
    return null;
  }
  if (j.proc && j.status === "running") {
    j.proc.kill("SIGTERM");
    j.status = "stopped";
    j.endedAt = new Date().toISOString();
  }
  return strip(j);
};

interface Plan {
  args: string[];
  note: string;
  runId: string | null;
}

const planBench = (req: Extract<StartJobRequest, { kind: "bench" }>): Plan => {
  if (!(BENCH_MODELS as readonly string[]).includes(req.model)) {
    throw new JobError(`model must be one of ${BENCH_MODELS.join(", ")}`);
  }
  const maxW = req.maxW ?? 756;
  if (!Number.isInteger(maxW) || maxW < 224 || maxW > 1024) {
    throw new JobError(
      "maxW must be an integer between 224 and 1024 (CLAUDE.md rule 1)"
    );
  }
  return {
    args: ["-m", "brain.bench", "--model", req.model, "--max-w", String(maxW)],
    runId: null,
    note: `Local brain benchmark for ${req.model}. Needs Ollama running. Writes data/runs/bench_*/bench.jsonl.`,
  };
};

const planSmoke = (req: Extract<StartJobRequest, { kind: "smoke" }>): Plan => {
  if (req.env !== "local" && req.env !== "sai") {
    throw new JobError("env must be local or sai");
  }
  return {
    args: ["-m", "env.smoke_test", "--env", req.env],
    runId: null,
    note:
      req.env === "local"
        ? "Smoke test on local Chromium. No Sai time. Writes data/runs/smoke_local_*/calls.jsonl and screens."
        : "Smoke test on the Sai cloud computer. Direct control is not billed. Reuses the lease in data/lease.json.",
  };
};

const planSubgoal = (
  req: Extract<StartJobRequest, { kind: "subgoal" }>
): Plan => {
  if (!req.confirm) {
    throw new JobError(
      "subgoal test spends Sai credits on exactly 3 tasks; pass confirm: true",
      428
    );
  }
  return {
    args: ["-m", "env.subgoal_test"],
    runId: null,
    note: "Three Sai tasks. Confirmed by the user. Writes data/runs/subgoal_*/subgoal_results.jsonl.",
  };
};

const planMockApps = (): Plan => {
  const port = mockAppsPort();
  return {
    args: ["-m", "http.server", String(port), "-d", "mock_apps"],
    runId: null,
    note: `Serves the static mock apps (Inbox, Vendor Portal, Settings) on http://localhost:${port}/ until stopped. Fictional data only.`,
  };
};

const planSelftest = (): Plan => {
  const base = mockBase();
  return {
    args: ["-m", "mock_apps.selftest", "--base", base],
    runId: null,
    note: "27 DOM-level checks of the mock apps in headless Chromium. Needs playwright and the mock apps server running.",
  };
};

const readSpecTaskCount = async (specId: string): Promise<number> => {
  const text = await readFile(
    path.join(repoRoot(), "tasks", `${specId}.json`),
    "utf8"
  );
  const spec = JSON.parse(text) as { task_ids?: unknown };
  return Array.isArray(spec.task_ids) ? spec.task_ids.length : 0;
};

const planRun = async (
  req: Extract<StartJobRequest, { kind: "run" }>
): Promise<Plan> => {
  if (!(isSafeRunId(req.spec_id) && isSafeRunId(req.run_id))) {
    throw new JobError("spec_id and run_id must be plain identifiers");
  }
  if (
    !(
      Array.isArray(req.modes) &&
      req.modes.length &&
      req.modes.every((m) => MODE_NAME.test(m))
    )
  ) {
    throw new JobError("modes must be a non-empty list of mode names");
  }
  const seeds = req.seeds ?? 1;
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 5) {
    throw new JobError("seeds must be an integer from 1 to 5");
  }
  const status = await getBackendStatus();
  if (!status.runner) {
    throw new JobError(
      "runner/run.py is not in the repo yet. The panel expects: python -m runner.run --spec tasks/<spec_id>.json --run-id <run_id> --modes a,b --seeds n, writing data/runs/<run_id>/steps.jsonl.",
      501
    );
  }
  let tasks: number;
  try {
    tasks = await readSpecTaskCount(req.spec_id);
  } catch {
    throw new JobError(
      `tasks/${req.spec_id}.json not found; save the spec from intake first`,
      404
    );
  }
  const spendsCredits = req.modes.some((m) => m !== "local_only");
  if (tasks * seeds > 3 && spendsCredits && !req.confirm) {
    throw new JobError(
      "more than 3 tasks would spend Sai credits; confirm the estimate first (CLAUDE.md rule 4)",
      428
    );
  }
  return {
    args: [
      "-m",
      "runner.run",
      "--spec",
      `tasks/${req.spec_id}.json`,
      "--run-id",
      req.run_id,
      "--modes",
      req.modes.join(","),
      "--seeds",
      String(seeds),
    ],
    runId: req.run_id,
    note: `Runner for ${req.spec_id}: ${req.modes.join(", ")} × ${seeds} seed${seeds === 1 ? "" : "s"}. Tails into data/runs/${req.run_id}/steps.jsonl.`,
  };
};

const planJob = (req: StartJobRequest): Promise<Plan> | Plan => {
  switch (req.kind) {
    case "bench":
      return planBench(req);
    case "smoke":
      return planSmoke(req);
    case "subgoal":
      return planSubgoal(req);
    case "run":
      return planRun(req);
    case "mockapps":
      return planMockApps();
    case "selftest":
      return planSelftest();
    default:
      throw new JobError("unknown job kind");
  }
};

const attach = (
  job: JobInternal,
  proc: ChildProcess,
  push: (text: string) => void
) => {
  job.proc = proc;
  proc.stdout?.on("data", (d: Buffer) => push(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => push(d.toString()));
  proc.on("error", (e) => {
    push(`spawn error: ${e.message}`);
    job.status = "failed";
    job.endedAt = new Date().toISOString();
  });
  proc.on("close", (code) => {
    job.exitCode = code;
    job.endedAt = new Date().toISOString();
    if (job.status === "running") {
      job.status = code === 0 ? "succeeded" : "failed";
    }
    push(`[exit ${code ?? "?"}] ${job.status}`);
  });
};

const guardConcurrency = (kind: JobKind) => {
  const running = [...registry.values()].filter((j) => j.status === "running");
  if (SERVER_KINDS.has(kind)) {
    const same = running.find((j) => j.kind === kind);
    if (same) {
      throw new JobError(`${kind} is already running as job ${same.id}`, 409);
    }
    return;
  }
  const busy = running.find((j) => !SERVER_KINDS.has(j.kind));
  if (busy) {
    throw new JobError(
      `job ${busy.id} (${busy.kind}) is still running; one job at a time keeps one model resident`,
      409
    );
  }
};

export const startJob = async (req: StartJobRequest): Promise<JobRecord> => {
  guardConcurrency(req.kind);
  const plan = await planJob(req);
  const bin = await pythonBin();
  const cwd = repoRoot();
  const id = `${req.kind}_${new Date().toISOString().replace(ID_CHARS, "").slice(0, 14)}`;
  await mkdir(jobsDir(), { recursive: true });
  const logPath = path.join(jobsDir(), `${id}.log`);

  const job: JobInternal = {
    id,
    kind: req.kind,
    status: "running",
    command: [bin, ...plan.args],
    cwd,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    runId: plan.runId,
    note: plan.note,
    logPath,
    lineCount: 0,
    proc: null,
    lines: [],
  };
  registry.set(id, job);

  const push = (text: string) => {
    for (const line of text.split(LINE_BREAK)) {
      if (!line) {
        continue;
      }
      job.lines.push(line);
      if (job.lines.length > MAX_LINES) {
        job.lines.shift();
      }
    }
    appendFile(logPath, text.endsWith("\n") ? text : `${text}\n`).catch(
      () => undefined
    );
  };

  push(`$ ${job.command.join(" ")}\n(cwd ${cwd})`);
  try {
    const proc = spawn(bin, plan.args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", MOCK_BASE: mockBase() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    attach(job, proc, push);
  } catch (e) {
    job.status = "failed";
    job.endedAt = new Date().toISOString();
    push(`failed to spawn: ${e instanceof Error ? e.message : String(e)}`);
  }
  return strip(job);
};
