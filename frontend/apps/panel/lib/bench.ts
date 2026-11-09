/**
 * Readers for the other files the Python side writes into data/runs/<run_id>/:
 * - calls.jsonl           every env HTTP call (env/sai_env.py CallRecord, also LocalEnv)
 * - bench.jsonl           brain/bench.py rows: latency, tokens, validity, click hits
 * - subgoal_results.jsonl env/subgoal_test.py: does Sai stop at a handed-off subgoal?
 * Pure functions, so they are unit-testable and usable on either side.
 */

const LINE_BREAK = /\r?\n/;

const parseLines = <T>(text: string): T[] => {
  const out: T[] = [];
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // skip a torn line; the writer appends one JSON object per line
    }
  }
  return out;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[mid] ?? null)
    : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

// ---------------------------------------------------------------- calls.jsonl

export interface CallRecord {
  method: string;
  ms: number;
  note?: string;
  op: string;
  path: string;
  status: number | null;
  t_start: number;
}

export interface CallsSummary {
  byOp: { op: string; count: number; ms: number }[];
  count: number;
  failed: number;
  /** Calls that went to the local Playwright env instead of the cloud. */
  localCalls: number;
  totalMs: number;
}

export const parseCallsJsonl = (text: string): CallsSummary => {
  const rows = parseLines<CallRecord>(text).filter(
    (r) => typeof r.op === "string"
  );
  const by = new Map<string, { count: number; ms: number }>();
  let failed = 0;
  let localCalls = 0;
  for (const r of rows) {
    const cur = by.get(r.op) ?? { count: 0, ms: 0 };
    cur.count++;
    cur.ms += Number(r.ms) || 0;
    by.set(r.op, cur);
    if (
      r.status === null ||
      (typeof r.status === "number" && r.status >= 400)
    ) {
      failed++;
    }
    if (r.method === "LOCAL") {
      localCalls++;
    }
  }
  return {
    count: rows.length,
    totalMs: rows.reduce((a, r) => a + (Number(r.ms) || 0), 0),
    failed,
    byOp: [...by.entries()]
      .map(([op, v]) => ({ op, ...v }))
      .sort((a, b) => b.ms - a.ms),
    localCalls,
  };
};

// ---------------------------------------------------------------- bench.jsonl

export interface BenchRow {
  action?: Record<string, unknown>;
  case: number;
  error?: string;
  goal: string;
  latency_ms: number;
  mean_logprob: number | null;
  mean_logprob_all?: number | null;
  model_image_size?: [number, number];
  original_size?: [number, number];
  raw?: string;
  rep: number;
  retried?: boolean;
  screenshot: string;
  target: "hit" | "miss" | "-";
  tokens_in: number;
  tokens_in_cached?: number;
  tokens_out: number;
  valid: boolean;
}

export interface BenchSummary {
  calls: number;
  firstCallMs: number | null;
  hits: number;
  image_width: number | null;
  judged: number;
  medianLatencyMs: number | null;
  medianLogprob: number | null;
  medianTokensIn: number | null;
  medianTokensOut: number | null;
  /** Model key as brain/bench.py tags it in the directory name, e.g. qwen3-vl-2b. */
  model_tag: string;
  retries: number;
  run_id: string;
  validRate: number;
  /** Median excluding the first call, which includes model load. */
  warmMedianLatencyMs: number | null;
}

const BENCH_DIR = /^bench_(.+?)_w(\d+)_\d{8}_\d{6}$/;
const BENCH_DIR_NO_WIDTH = /^bench_(.+?)_\d{8}_\d{6}$/;

/** bench_<tag>_w<width>_<date>_<time> → {tag, width}. Older dirs may lack the width. */
export const benchDirInfo = (
  dir: string
): { tag: string; width: number | null } | null => {
  const m = dir.match(BENCH_DIR);
  if (m?.[1]) {
    return { tag: m[1], width: Number(m[2]) };
  }
  const n = dir.match(BENCH_DIR_NO_WIDTH);
  if (n?.[1]) {
    return { tag: n[1], width: null };
  }
  return null;
};

/** The tag brain/bench.py derives from a model key: ':' → '-', '.' removed. */
export const benchTagForModel = (modelKey: string): string =>
  modelKey.replace(/:/g, "-").replace(/\./g, "");

export const parseBenchJsonl = (text: string): BenchRow[] =>
  parseLines<BenchRow>(text).filter((r) => typeof r.latency_ms === "number");

export const summarizeBench = (
  runId: string,
  rows: BenchRow[]
): BenchSummary => {
  const info = benchDirInfo(runId);
  const lat = rows.map((r) => r.latency_ms);
  const judged = rows.filter((r) => r.target === "hit" || r.target === "miss");
  return {
    run_id: runId,
    model_tag: info?.tag ?? "unknown",
    image_width: info?.width ?? rows[0]?.model_image_size?.[0] ?? null,
    calls: rows.length,
    validRate: rows.length
      ? rows.filter((r) => r.valid).length / rows.length
      : 0,
    retries: rows.filter((r) => r.retried).length,
    medianLatencyMs: median(lat),
    warmMedianLatencyMs: median(lat.slice(1)),
    firstCallMs: lat[0] ?? null,
    medianTokensIn: median(rows.map((r) => r.tokens_in)),
    medianTokensOut: median(rows.map((r) => r.tokens_out)),
    medianLogprob: median(
      rows
        .map((r) => r.mean_logprob)
        .filter((x): x is number => typeof x === "number")
    ),
    hits: judged.filter((r) => r.target === "hit").length,
    judged: judged.length,
  };
};

// ------------------------------------------------------- subgoal_results.jsonl

export type SubgoalVerdict =
  | "kept_going"
  | "stopped_at_done"
  | "did_not_reach"
  | "unknown";

export interface SubgoalRow {
  cost_usd_estimate?: number | null;
  credits_delta_usd?: number | null;
  elapsed_s?: number;
  evidence?: Record<string, unknown>;
  model_calls?: number | null;
  run: number;
  status?: string;
  steps?: number | null;
  verdict: SubgoalVerdict;
}

export interface SubgoalSummary {
  counts: Record<SubgoalVerdict, number>;
  rows: SubgoalRow[];
  run_id: string;
  totalCostEstimate: number;
  totalCreditsDelta: number | null;
}

export const parseSubgoalJsonl = (
  runId: string,
  text: string
): SubgoalSummary => {
  const rows = parseLines<SubgoalRow>(text).filter(
    (r) => typeof r.verdict === "string"
  );
  const counts: Record<SubgoalVerdict, number> = {
    kept_going: 0,
    stopped_at_done: 0,
    did_not_reach: 0,
    unknown: 0,
  };
  for (const r of rows) {
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  }
  const deltas = rows
    .map((r) => r.credits_delta_usd)
    .filter((x): x is number => typeof x === "number");
  return {
    run_id: runId,
    rows,
    counts,
    totalCostEstimate: rows.reduce((a, r) => a + (r.cost_usd_estimate ?? 0), 0),
    totalCreditsDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) : null,
  };
};
