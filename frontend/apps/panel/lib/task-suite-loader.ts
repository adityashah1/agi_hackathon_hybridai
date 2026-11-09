import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { mockBase, repoRoot } from "./backend";
import {
  appFor,
  expandMockBase,
  MOCK_BASE_PLACEHOLDER,
  recomputedCode,
  SUITE,
  type SuiteTask,
} from "./data/task-suite";

/**
 * Reads tasks/tasks.yaml the way tasks/checkers.py load_tasks() does: expands
 * {MOCK_BASE}, recomputes every confirm code from its parts, and reports any
 * difference from the panel's snapshot (lib/data/task-suite.ts). Falls back to
 * the snapshot when the file is missing or malformed, and says so.
 */

const RawTask = z.object({
  id: z.string(),
  kind: z.enum(["intricate", "simple"]),
  title: z.string(),
  start_url: z.string(),
  max_steps: z.number().int().positive(),
  goal: z.string(),
  success: z.object({
    type: z.enum(["confirm", "answer"]),
    kind: z.string().optional(),
    parts: z.array(z.union([z.string(), z.number()])).optional(),
    code: z.string().optional(),
    regex: z.string(),
  }),
  expected_events: z.array(z.string()).default([]),
  fail_events: z.array(z.string()).default([]),
});
const RawSuite = z.object({ tasks: z.array(RawTask) });

type RawTask = z.infer<typeof RawTask>;

const toSuiteTask = (r: RawTask): SuiteTask => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  start_url: r.start_url,
  max_steps: r.max_steps,
  goal: r.goal,
  app: appFor(r.start_url),
  mock: r.start_url.includes(MOCK_BASE_PLACEHOLDER),
  success:
    r.success.type === "confirm"
      ? {
          type: "confirm",
          kind: r.success.kind ?? "",
          parts: (r.success.parts ?? []).map(String),
          code: r.success.code ?? "",
          regex: r.success.regex,
        }
      : { type: "answer", regex: r.success.regex },
  expected_events: r.expected_events,
  fail_events: r.fail_events,
});

/** The same task with {MOCK_BASE} filled in, for display and for the runner. */
export const expandTask = (t: SuiteTask, base: string): SuiteTask => ({
  ...t,
  start_url: expandMockBase(t.start_url, base),
  goal: expandMockBase(t.goal, base),
});

export interface LoadedSuite {
  /** Tasks whose yaml `code` does not equal confirm_code(kind, parts). */
  codeMismatches: string[];
  error: string | null;
  /** The base the panel filled {MOCK_BASE} with. */
  mockBase: string;
  path: string;
  /** Ids whose yaml definition differs from the panel's snapshot, plus missing or extra ids. */
  snapshotDrift: string[];
  source: "yaml" | "snapshot";
  /** With {MOCK_BASE} expanded. */
  tasks: SuiteTask[];
}

/** JSON with object keys sorted, so key order never counts as drift. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_key, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        )
      : val
  );

const drift = (fromYaml: SuiteTask[]): string[] => {
  const out: string[] = [];
  const snap = new Map(SUITE.map((t) => [t.id, canon(t)]));
  for (const t of fromYaml) {
    const s = snap.get(t.id);
    if (s === undefined) {
      out.push(`${t.id} is not in the panel snapshot`);
    } else if (s !== canon(t)) {
      out.push(`${t.id} differs from the panel snapshot`);
    }
    snap.delete(t.id);
  }
  for (const id of snap.keys()) {
    out.push(`${id} is in the panel snapshot but not in tasks.yaml`);
  }
  return out;
};

export const loadSuite = async (): Promise<LoadedSuite> => {
  const file = path.join(repoRoot(), "tasks", "tasks.yaml");
  const base = mockBase();
  const fallback = (error: string): LoadedSuite => ({
    tasks: SUITE.map((t) => expandTask(t, base)),
    source: "snapshot",
    path: file,
    mockBase: base,
    codeMismatches: SUITE.filter(
      (t) =>
        t.success.type === "confirm" && recomputedCode(t) !== t.success.code
    ).map((t) => t.id),
    snapshotDrift: [],
    error,
  });
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return fallback("tasks/tasks.yaml is not in this checkout");
  }
  let parsed: z.infer<typeof RawSuite>;
  try {
    parsed = RawSuite.parse(parse(text));
  } catch (e) {
    return fallback(
      `tasks/tasks.yaml did not parse: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`
    );
  }
  const tasks = parsed.tasks.map(toSuiteTask);
  return {
    tasks: tasks.map((t) => expandTask(t, base)),
    source: "yaml",
    path: file,
    mockBase: base,
    codeMismatches: tasks
      .filter(
        (t) =>
          t.success.type === "confirm" && recomputedCode(t) !== t.success.code
      )
      .map((t) => t.id),
    snapshotDrift: drift(tasks),
    error: null,
  };
};
