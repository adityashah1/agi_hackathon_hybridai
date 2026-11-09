/**
 * TypeScript mirror of runner/schema.py (StepRecord). Field names match the
 * JSONL exactly so the panel can read the Python runner's output unchanged.
 *
 * Provenance follows CLAUDE.md rule 5:
 * - measured: local_ms, local_tokens_in, local_tokens_out, local_joules,
 *   cloud_calls, cloud_steps, cloud_ms, handoff_tokens
 * - modeled:  cloud_energy_wh_low / cloud_energy_wh_high (always a range)
 * - cloud_usd is measured when Sai reports it (usage.costUsd), else modeled.
 */

/** Mode is a free string in schema.py. Three names are known; others are shown as written. */
export type Mode = string;
export const KNOWN_MODES = ["local_only", "sai_only", "hybrid"] as const;
export const MODES: Mode[] = [...KNOWN_MODES];

export type GateDecision = "local" | "flush" | "escalate";
export type Executor = "local" | "sai";
export type StepLabel = "ok" | "fail" | "unknown";
export type Provenance = "measured" | "modeled";

/** Action JSON is free-form in the runner. These are the common types. */
export type ActionType = string;

/**
 * Both logged shapes. env/*.py: `{type, x, y, text, name, dx, dy}` with
 * coordinates in original screen pixels. brain/local_brain.py:
 * `{action, x, y, text, key, why, valid}`. See lib/actions.ts.
 */
export interface ActionJson {
  action?: ActionType;
  dx?: number;
  dy?: number;
  key?: string;
  name?: string;
  target?: string;
  text?: string;
  type?: ActionType;
  valid?: boolean;
  why?: string;
  x?: number;
  y?: number;
}

export interface StepRecord {
  action_taken: ActionJson | null;
  agreement_score: number | null;

  // cloud usage
  cloud_calls: number;
  cloud_energy_wh_high: number | null; // modeled
  cloud_energy_wh_low: number | null; // modeled
  cloud_ms: number;
  cloud_steps: number;
  cloud_usd: number;
  executor: Executor;
  flush_action: ActionJson | null;
  flush_agrees: boolean | null;
  gate_decision: GateDecision;

  // gate
  gate_name: string;
  goal: string;
  handoff_tokens: number;
  history_summary: string;
  injection_visible: boolean;
  laya_scores: Record<string, number> | null;
  local_joules: number | null;
  local_logprob: number | null;

  // local compute (measured)
  local_ms: number;

  // local proposals
  local_samples: ActionJson[];
  local_tokens_in: number;
  local_tokens_out: number;
  mode: Mode;

  // post-action check (runner/collect.py): dHash-32 distance, measured; null in older logs
  phash_distance: number | null;

  // privacy exposure
  pii_strings_visible: string[];
  // identity
  run_id: string;
  screen_changed: boolean | null;
  screenshot_hash: string;

  // observation
  screenshot_path: string;
  step_idx: number;
  step_label: StepLabel;
  task_id: string;
  timestamp: string;
}

const KNOWN_LABEL: Record<string, string> = {
  local_only: "Local only",
  sai_only: "Sai only",
  hybrid: "Hybrid gate",
};

/** Human label for a mode. Unknown modes are shown as written, underscores as spaces. */
export const modeLabel = (mode: Mode): string =>
  KNOWN_LABEL[mode] ?? mode.replace(/_/g, " ");

/** Known modes first in their canonical order, then any others alphabetically. */
export const orderModes = (modes: Iterable<Mode>): Mode[] => {
  const present = [...new Set(modes)];
  const known = KNOWN_MODES.filter((m) => present.includes(m));
  const rest = present
    .filter((m) => !(KNOWN_MODES as readonly string[]).includes(m))
    .sort();
  return [...known, ...rest];
};

/** The mode that plays the role of "the gate" in a run, even if the runner named it differently. */
export const pickHybridMode = (modes: Mode[]): Mode | undefined => {
  if (modes.includes("hybrid")) {
    return "hybrid";
  }
  return (
    modes.find((m) => m.includes("hybrid") || m.includes("gate")) ??
    modes.find((m) => m !== "local_only" && m !== "sai_only") ??
    modes[0]
  );
};

const THRESHOLD_IN_NAME = /@(-?\d+(?:\.\d+)?)/;

/** Reads the threshold out of a gate name such as agreement_gate@0.6. */
export const gateThresholdFromName = (
  name: string | undefined
): number | undefined => {
  const m = name?.match(THRESHOLD_IN_NAME);
  return m?.[1] ? Number(m[1]) : undefined;
};

export const GATE_LABEL: Record<GateDecision, string> = {
  local: "local",
  flush: "flush",
  escalate: "escalate",
};

/** How each measured field is measured. Shown in the methodology popover. */
export const METHOD: Record<string, string> = {
  local_ms:
    "Wall clock around the Ollama /api/chat calls for the step's samples, time.perf_counter in brain/local_brain.py (Proposal.latency_ms).",
  local_tokens:
    "prompt_eval_count and eval_count reported by Ollama, summed over the step's samples. Prompt tokens include cached ones.",
  local_logprob:
    "Mean log-probability of the decision tokens only (action, coordinates, text, key), from Ollama's raw per-token logprobs, measured before the JSON grammar constraint applies.",
  local_joules:
    "Integrated from macOS powermetrics CPU+GPU package power sampled every 100 ms during the local call. Not wired yet in profiler/.",
  cloud_ms: "Wall clock around each Sai API call, from calls.jsonl.",
  cloud_usd:
    "Sai's usage.costUsd is the API's live estimate. The account credits delta before and after the task is the measured spend and may lag billing. The runner records which it logged, split across the task's cloud steps by cloud_ms share.",
  cloud_energy:
    "Modeled. Cloud step time multiplied by a 300 W to 1200 W per-agent power band. Never a point value.",
  handoff_tokens:
    "Token count of the goal, history summary and screenshot payload sent across the boundary.",
  success:
    "Final-state check after the episode's last step (tasks/checkers.py task_success): the mock app's CONFIRM code, or the answer regex from tasks/tasks.yaml, logged on the terminal done step.",
  ipw: "Successful tasks divided by energy. Local energy is measured; any cloud share is modeled, so hybrid and Sai-only values are ranges.",
  gate_sweep:
    "Cloud-call share replays the logged signal (agreement score or decision-token log-prob) against each threshold. Success is estimated from local-only and Sai-only step outcomes, so it is modeled.",
  forecast:
    "Per-task means from this run multiplied by the intake's daily volume and 30 days. Modeled.",
  spec_sheet: "Vendor specification sheet. Not measured on this machine.",
  bench:
    "brain/bench.py: 5 saved screenshots × 2 calls, n_samples=1, temperature 0, on this Mac via Ollama. Latency, tokens, valid-schema rate and click hits are all measured.",
};
