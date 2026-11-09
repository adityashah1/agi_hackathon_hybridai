import "server-only";

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import {
  type BenchSummary,
  type CallsSummary,
  parseBenchJsonl,
  parseCallsJsonl,
  parseSubgoalJsonl,
  type SubgoalSummary,
  summarizeBench,
} from "../bench";
import { type ParseReport, parseStepsJsonl } from "../jsonl";
import { type RunHealth, runHealth } from "../metrics";
import { isSafeRunId } from "../run-cookie";
import type { StepRecord } from "../schema";
import { type RunData, SAMPLE_RUN } from "./sample-run";

/**
 * Data adapter boundary. Screens only ever call these functions.
 *
 * The Python side writes, per run directory under data/runs/<run_id>/:
 *   steps.jsonl            runner (one StepRecord per line)       → the panel's main input
 *   calls.jsonl            env/sai_env.py and env/local_env.py    → every HTTP/local call, timed
 *   screens/NNNN_tag.png   both envs                              → real screenshots
 *   bench.jsonl            brain/bench.py                         → local brain benchmark
 *   subgoal_results.jsonl  env/subgoal_test.py                    → Sai subgoal containment
 * Plus the seeded sample run, which needs no files at all.
 */

export type RunSource = "sample" | "disk";

export interface RunSummary {
  created_at: string;
  path?: string;
  run_id: string;
  source: RunSource;
  step_count: number;
}

export interface ScreensInfo {
  available: boolean;
  count: number;
}

export interface LoadedRun extends RunData {
  calls: CallsSummary | null;
  health: RunHealth;
  parse: ParseReport | null;
  path?: string;
  screens: ScreensInfo;
  source: RunSource;
}

/** What a run directory contains, for the Benchmarks page and the picker. */
export interface RunArtifacts {
  bench: boolean;
  calls: boolean;
  modified_at: string;
  run_id: string;
  screens: number;
  steps: boolean;
  subgoal: boolean;
}

/** data/runs at the repo root by default. RUNS_DIR overrides it. */
export const runsDir = (): string =>
  env.RUNS_DIR ?? path.resolve(process.cwd(), "../../../data/runs");

const inRun = (runId: string, ...parts: string[]) =>
  path.join(runsDir(), runId, ...parts);
const stepsPath = (runId: string) => inRun(runId, "steps.jsonl");

const LINE_BREAK = /\r?\n/;
const PNG = /\.png$/i;
const SCREEN_FILE = /^[A-Za-z0-9_.-]+\.png$/i;

const countLines = (text: string) =>
  text.split(LINE_BREAK).filter((l) => l.trim()).length;

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const readIfExists = async (p: string): Promise<string | null> => {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
};

const screensInfo = async (runId: string): Promise<ScreensInfo> => {
  try {
    const files = await readdir(inRun(runId, "screens"));
    const count = files.filter((f) => PNG.test(f)).length;
    return { available: count > 0, count };
  } catch {
    return { available: false, count: 0 };
  }
};

const sampleSummary = (): RunSummary => ({
  run_id: SAMPLE_RUN.run_id,
  created_at: SAMPLE_RUN.created_at,
  source: "sample",
  step_count: SAMPLE_RUN.steps.length,
});

const sampleLoaded = (): LoadedRun => ({
  ...SAMPLE_RUN,
  source: "sample",
  health: runHealth(SAMPLE_RUN.steps),
  parse: null,
  calls: null,
  screens: { available: false, count: 0 },
});

const runDirs = async (): Promise<string[]> => {
  try {
    const entries = await readdir(runsDir());
    return entries.filter((id) => isSafeRunId(id));
  } catch {
    return [];
  }
};

export const listRuns = async (): Promise<RunSummary[]> => {
  const disk: RunSummary[] = [];
  for (const id of await runDirs()) {
    const p = stepsPath(id);
    try {
      const [st, text] = await Promise.all([stat(p), readFile(p, "utf8")]);
      disk.push({
        run_id: id,
        created_at: st.mtime.toISOString(),
        source: "disk",
        step_count: countLines(text),
        path: p,
      });
    } catch {
      // No steps.jsonl. Keep runner-style ids (run_*) so a run that has just
      // started can be selected and tailed; skip bench/smoke/subgoal dirs.
      if (id.startsWith("run_")) {
        try {
          const dirStat = await stat(inRun(id));
          disk.push({
            run_id: id,
            created_at: dirStat.mtime.toISOString(),
            source: "disk",
            step_count: 0,
          });
        } catch {
          // ignore
        }
      }
    }
  }
  disk.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...disk, sampleSummary()];
};

export const listArtifacts = async (): Promise<RunArtifacts[]> => {
  const out: RunArtifacts[] = [];
  for (const id of await runDirs()) {
    try {
      const st = await stat(inRun(id));
      if (!st.isDirectory()) {
        continue;
      }
      const [steps, calls, bench, subgoal, screens] = await Promise.all([
        exists(stepsPath(id)),
        exists(inRun(id, "calls.jsonl")),
        exists(inRun(id, "bench.jsonl")),
        exists(inRun(id, "subgoal_results.jsonl")),
        screensInfo(id),
      ]);
      out.push({
        run_id: id,
        modified_at: st.mtime.toISOString(),
        steps,
        calls,
        bench,
        subgoal,
        screens: screens.count,
      });
    } catch {
      // ignore unreadable entries
    }
  }
  return out.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
};

export const getRun = async (runId?: string | null): Promise<LoadedRun> => {
  if (!runId || runId === SAMPLE_RUN.run_id) {
    return sampleLoaded();
  }
  if (!isSafeRunId(runId)) {
    throw new Error(`invalid run id "${runId}"`);
  }
  const p = stepsPath(runId);
  if (!(await exists(p))) {
    // The runner creates the directory first and appends steps as it goes.
    // An empty run keeps the live panel tailing instead of falling back.
    const dirStat = await stat(inRun(runId));
    const [callsText, screens] = await Promise.all([
      readIfExists(inRun(runId, "calls.jsonl")),
      screensInfo(runId),
    ]);
    return {
      run_id: runId,
      created_at: dirStat.mtime.toISOString(),
      spec_id: "",
      steps: [],
      source: "disk",
      path: p,
      health: runHealth([]),
      parse: {
        parsedLines: 0,
        accepted: 0,
        rejectedCount: 0,
        rejected: [],
        unknownFields: {},
        warnings: ["steps.jsonl not written yet"],
      },
      calls: callsText === null ? null : parseCallsJsonl(callsText),
      screens,
    };
  }
  const [text, st, callsText, screens] = await Promise.all([
    readFile(p, "utf8"),
    stat(p),
    readIfExists(inRun(runId, "calls.jsonl")),
    screensInfo(runId),
  ]);
  const { steps, report } = parseStepsJsonl(text);
  return {
    run_id: runId,
    created_at: st.mtime.toISOString(),
    spec_id: "",
    steps,
    source: "disk",
    path: p,
    health: runHealth(steps),
    parse: report,
    calls: callsText === null ? null : parseCallsJsonl(callsText),
    screens,
  };
};

/** Steps appended after position `after`. Used by the live panel to tail a growing log. */
export const readStepsAfter = async (
  runId: string,
  after: number
): Promise<{ steps: StepRecord[]; total: number; source: RunSource }> => {
  const run = await getRun(runId);
  return {
    steps: run.steps.slice(Math.max(0, after)),
    total: run.steps.length,
    source: run.source,
  };
};

/** Save an uploaded steps.jsonl under data/runs/<run_id>/ after checking it parses. */
export const saveUploadedRun = async (
  runId: string,
  text: string
): Promise<{ run_id: string; path: string; report: ParseReport }> => {
  if (!isSafeRunId(runId)) {
    throw new Error(`invalid run id "${runId}"`);
  }
  const { report } = parseStepsJsonl(text);
  if (report.accepted === 0) {
    const why = report.rejected[0]?.reason ?? "no non-blank lines";
    throw new Error(`no valid StepRecord lines found (${why})`);
  }
  await mkdir(inRun(runId), { recursive: true });
  const p = stepsPath(runId);
  await writeFile(p, text, "utf8");
  return { run_id: runId, path: p, report };
};

/** A screenshot PNG from data/runs/<run_id>/screens/, or null. File names are plain. */
export const readScreen = async (
  runId: string,
  file: string
): Promise<Buffer | null> => {
  if (!(isSafeRunId(runId) && SCREEN_FILE.test(file))) {
    return null;
  }
  try {
    return await readFile(inRun(runId, "screens", file));
  } catch {
    return null;
  }
};

/** Every brain/bench.py result on disk, newest first. */
export const loadBenches = async (): Promise<BenchSummary[]> => {
  const out: BenchSummary[] = [];
  for (const a of await listArtifacts()) {
    if (!a.bench) {
      continue;
    }
    const text = await readIfExists(inRun(a.run_id, "bench.jsonl"));
    if (text) {
      out.push(summarizeBench(a.run_id, parseBenchJsonl(text)));
    }
  }
  return out;
};

/** Every env/subgoal_test.py result on disk, newest first. */
export const loadSubgoalResults = async (): Promise<SubgoalSummary[]> => {
  const out: SubgoalSummary[] = [];
  for (const a of await listArtifacts()) {
    if (!a.subgoal) {
      continue;
    }
    const text = await readIfExists(inRun(a.run_id, "subgoal_results.jsonl"));
    if (text) {
      out.push(parseSubgoalJsonl(a.run_id, text));
    }
  }
  return out;
};

/** calls.jsonl summaries for runs that have one but no steps.jsonl (smoke tests). */
export const loadCallsOnly = async (): Promise<
  { run_id: string; calls: CallsSummary }[]
> => {
  const out: { run_id: string; calls: CallsSummary }[] = [];
  for (const a of await listArtifacts()) {
    if (!a.calls || a.steps) {
      continue;
    }
    const text = await readIfExists(inRun(a.run_id, "calls.jsonl"));
    if (text) {
      out.push({ run_id: a.run_id, calls: parseCallsJsonl(text) });
    }
  }
  return out;
};
