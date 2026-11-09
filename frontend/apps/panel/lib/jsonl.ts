// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: line-by-line validator that reports every tolerated problem
import { z } from "zod";
import type { StepRecord } from "./schema";

/**
 * Lenient, validated reader for data/runs/<run_id>/steps.jsonl.
 *
 * The Python side (runner/schema.py) is strict: unknown fields raise. The panel
 * is lenient on purpose so a half-written or slightly drifted log still renders,
 * and it reports exactly what it had to tolerate so nothing is hidden.
 */

/** Accepts both the env action shape (`type`) and the brain proposal shape (`action`). */
const ActionSchema = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  name: z.string().optional(),
  why: z.string().optional(),
  valid: z.boolean().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
});

const nullableNumber = z.number().nullable().default(null);

export const StepRecordSchema = z.object({
  run_id: z.string(),
  mode: z.string().min(1),
  task_id: z.string().min(1),
  step_idx: z.number().int().nonnegative(),
  timestamp: z.string().default(""),

  screenshot_path: z.string().default(""),
  screenshot_hash: z.string().default(""),
  goal: z.string().default(""),
  history_summary: z.string().default(""),

  local_samples: z.array(ActionSchema).default([]),
  local_logprob: nullableNumber,
  agreement_score: nullableNumber,
  flush_action: ActionSchema.nullable().default(null),
  flush_agrees: z.boolean().nullable().default(null),
  laya_scores: z.record(z.string(), z.number()).nullable().default(null),

  gate_name: z.string().default(""),
  gate_decision: z.enum(["local", "flush", "escalate"]),
  executor: z.enum(["local", "sai"]),
  action_taken: ActionSchema.nullable().default(null),
  step_label: z.enum(["ok", "fail", "unknown"]).default("unknown"),

  local_ms: z.number().default(0),
  local_tokens_in: z.number().default(0),
  local_tokens_out: z.number().default(0),
  local_joules: nullableNumber,

  cloud_calls: z.number().default(0),
  cloud_steps: z.number().default(0),
  cloud_ms: z.number().default(0),
  cloud_usd: z.number().default(0),
  cloud_energy_wh_low: nullableNumber,
  cloud_energy_wh_high: nullableNumber,
  handoff_tokens: z.number().default(0),

  pii_strings_visible: z.array(z.string()).default([]),
  injection_visible: z.boolean().default(false),

  // post-action check written by runner/collect.py (null in older logs)
  phash_distance: z.number().int().nullable().default(null),
  screen_changed: z.boolean().nullable().default(null),
});

const KNOWN_KEYS = new Set(Object.keys(StepRecordSchema.shape));
const LINE_BREAK = /\r?\n/;
const MAX_REPORTED = 50;

export interface RejectedLine {
  line: number;
  reason: string;
}

export interface ParseReport {
  accepted: number;
  /** Non-blank lines seen. */
  parsedLines: number;
  /** First MAX_REPORTED rejections with a reason each. */
  rejected: RejectedLine[];
  rejectedCount: number;
  /** Field names the Python schema does not know, with how many lines carried them. */
  unknownFields: Record<string, number>;
  /** Soft problems that did not block a line. */
  warnings: string[];
}

const issueText = (error: z.ZodError): string =>
  error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "record"}: ${i.message}`)
    .join("; ");

export const parseStepsJsonl = (
  text: string
): { steps: StepRecord[]; report: ParseReport } => {
  const steps: StepRecord[] = [];
  const report: ParseReport = {
    parsedLines: 0,
    accepted: 0,
    rejectedCount: 0,
    rejected: [],
    unknownFields: {},
    warnings: [],
  };

  const reject = (line: number, reason: string) => {
    report.rejectedCount++;
    if (report.rejected.length < MAX_REPORTED) {
      report.rejected.push({ line, reason });
    }
  };

  const lines = text.split(LINE_BREAK);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw) {
      continue;
    }
    report.parsedLines++;
    const lineNo = i + 1;

    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      reject(lineNo, `not JSON: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      reject(lineNo, "not a JSON object");
      continue;
    }

    for (const key of Object.keys(obj)) {
      if (!KNOWN_KEYS.has(key)) {
        report.unknownFields[key] = (report.unknownFields[key] ?? 0) + 1;
      }
    }

    const result = StepRecordSchema.safeParse(obj);
    if (!result.success) {
      reject(lineNo, issueText(result.error));
      continue;
    }

    const rec = result.data as StepRecord;
    const lo = rec.cloud_energy_wh_low;
    const hi = rec.cloud_energy_wh_high;
    if (
      (lo === null) !== (hi === null) &&
      report.warnings.length < MAX_REPORTED
    ) {
      report.warnings.push(
        `line ${lineNo}: cloud energy must be a low-high range; only one bound was set`
      );
    } else if (
      lo !== null &&
      hi !== null &&
      lo > hi &&
      report.warnings.length < MAX_REPORTED
    ) {
      report.warnings.push(
        `line ${lineNo}: cloud_energy_wh_low is greater than cloud_energy_wh_high`
      );
    }

    steps.push(rec);
    report.accepted++;
  }

  const unknown = Object.keys(report.unknownFields);
  if (unknown.length) {
    report.warnings.unshift(
      `${unknown.length} field${unknown.length === 1 ? "" : "s"} not in runner/schema.py were ignored: ${unknown.join(", ")}`
    );
  }

  return { steps, report };
};

/** Serialize steps back to JSONL, one compact object per line, same as StepRecord.to_json. */
export const toJsonl = (steps: StepRecord[]): string =>
  `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`;
