// biome-ignore-all lint/suspicious/noBitwiseOperators: mulberry32 PRNG needs them
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: fixture generator is a flat sequence of draws
import type {
  ActionJson,
  Executor,
  GateDecision,
  Mode,
  StepLabel,
  StepRecord,
} from "../schema";
import { MODES } from "../schema";
import {
  DEFAULT_MOCK_BASE,
  expandMockBase,
  HERO_STAGES,
  SAMPLE_SCRIPTS,
  SAMPLE_TASK_IDS,
  type ScriptedStep,
  type SuiteTask,
  taskById,
} from "./task-suite";

/**
 * Deterministic sample run so the panel works with no backend. Same seed on
 * server and client, so there is no hydration drift. Every number here is a
 * stand-in for what runner/ will log; the shapes match runner/schema.py and the
 * action objects match brain/local_brain.py proposals.
 *
 * It plays tasks T1, T3 and T5 of tasks/tasks.yaml (lib/data/task-suite.ts)
 * in all three modes. Stand-in magnitudes follow what the brain code documents
 * for this Mac: three samples per step through Ollama at 756 px, so a local
 * step takes seconds, not milliseconds, and prompt tokens are dominated by
 * image patches. PII and injection visibility follow the mock apps, step by
 * step, from the scripts.
 */

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const RUN_ID = "sample_acme_dispute";
const BASE_TIME = Date.UTC(2026, 10, 8, 17, 0, 0);
const GATE_THRESHOLD = 0.6;
const FLUSH_BAND = 0.75;
const SAMPLES_PER_STEP = 3;

const hex = (rand: () => number, n = 16) =>
  Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join(
    ""
  );

const between = (rand: () => number, lo: number, hi: number) =>
  lo + rand() * (hi - lo);

/** A disagreeing sample: a click elsewhere, a longer text, or a different direction. */
const perturb = (rand: () => number, a: ActionJson): ActionJson => {
  const kind = a.type ?? a.action;
  if (kind === "click" && a.x !== undefined && a.y !== undefined) {
    const dx = Math.round(between(rand, 30, 120)) * (rand() < 0.5 ? -1 : 1);
    const dy = Math.round(between(rand, 20, 90)) * (rand() < 0.5 ? -1 : 1);
    return {
      ...a,
      target: undefined,
      x: Math.max(0, Math.min(1023, a.x + dx)),
      y: Math.max(0, Math.min(767, a.y + dy)),
      why: "a different element",
    };
  }
  if (kind === "type") {
    return { ...a, text: `${a.text ?? ""} `, why: "same text, trailing space" };
  }
  if (kind === "goto") {
    return { ...a, target: "/inbox/", why: "the inbox list instead" };
  }
  return { action: "key", key: "escape", why: "unsure, back out" };
};

interface EpisodeOutcome {
  steps: StepRecord[];
  success: boolean;
}

const gateName: Record<Mode, string> = {
  local_only: "always_local",
  sai_only: "always_escalate",
  hybrid: `agreement_gate@${GATE_THRESHOLD}`,
};

/** The app the step is in: the stage's app for the hero task, else the task's start app. */
const appAt = (task: SuiteTask, script: ScriptedStep[], idx: number) => {
  let stage: number | undefined;
  for (let i = 0; i <= idx; i++) {
    stage = script[i]?.stage ?? stage;
  }
  return HERO_STAGES.find((s) => s.stage === stage)?.app ?? task.app;
};

/**
 * history_summary is free text in the runner. The sample marks stage changes
 * of the hero task with a "Stage n of m · title." prefix, which the live
 * panel turns into a marker row.
 */
const historyFor = (
  task: SuiteTask,
  script: ScriptedStep[],
  goal: string,
  idx: number
) => {
  const stageNo = script[idx]?.stage;
  if (stageNo !== undefined) {
    const stage = HERO_STAGES.find((s) => s.stage === stageNo);
    const prev = HERO_STAGES.find((s) => s.stage === stageNo - 1);
    if (stage) {
      const carried = prev ? ` Carried over: ${prev.done_when}` : "";
      return `Stage ${stage.stage} of ${HERO_STAGES.length} · ${stage.title}.${carried}`;
    }
  }
  if (idx === 0) {
    return `Goal: ${goal}`;
  }
  return `${idx} step${idx === 1 ? "" : "s"} taken in ${appAt(task, script, idx)}.`;
};

/** What the env executes: the brain action converted by to_env_action(). */
const toEnvAction = (a: ActionJson): ActionJson => {
  const kind = a.type ?? a.action;
  if (kind === "click") {
    return { type: "click", x: a.x, y: a.y };
  }
  if (kind === "type") {
    return { type: "type", text: a.text };
  }
  if (kind === "key") {
    return { type: "key", name: a.key };
  }
  if (kind === "scroll") {
    return { type: "scroll", dx: 0, dy: a.key === "down" ? 3 : -3 };
  }
  if (kind === "goto") {
    return { type: "goto", text: a.target };
  }
  return { type: "done" };
};

let shotCounter = 0;

const generateEpisode = (
  mode: Mode,
  task: SuiteTask,
  script: ScriptedStep[],
  seed: number,
  startMs: number
): EpisodeOutcome => {
  const rand = mulberry32(seed);
  const steps: StepRecord[] = [];
  const goal = expandMockBase(task.goal, DEFAULT_MOCK_BASE);
  let clock = startMs;
  let failed = false;

  for (let idx = 0; idx < script.length; idx++) {
    const scripted = script[idx] ?? {
      action: { action: "done", why: "goal reached" },
      pii: [],
      injection: false,
    };
    const isLast = idx === script.length - 1;
    const hard = scripted.hard === true;

    // The local model proposes in every mode so the gate sweep can be replayed offline.
    const majority: ActionJson = { ...scripted.action, valid: true };
    const agreement = hard
      ? between(rand, 0.2, 0.55)
      : between(rand, 0.72, 1.0);
    const samples: ActionJson[] = Array.from(
      { length: SAMPLES_PER_STEP },
      (_, i) => {
        const shouldPerturb =
          (i === 2 && agreement < 0.67) || (i === 1 && agreement < 0.4);
        return shouldPerturb
          ? { ...perturb(rand, majority), valid: true }
          : majority;
      }
    );
    // Decision-token log-prob: confident on easy screens, poor on hard ones.
    const localLogprob = -between(rand, 0.05, 0.4) * (hard ? 3 : 1);

    let decision: GateDecision = "local";
    let executor: Executor = "local";
    let flushAction: ActionJson | null = null;
    let flushAgrees: boolean | null = null;

    if (mode === "sai_only") {
      decision = "escalate";
      executor = "sai";
    } else if (mode === "hybrid") {
      if (agreement < GATE_THRESHOLD) {
        decision = "escalate";
        executor = "sai";
      } else if (agreement < FLUSH_BAND) {
        decision = "flush";
        flushAction = rand() < 0.8 ? majority : perturb(rand, majority);
        flushAgrees =
          flushAction.x === majority.x &&
          flushAction.y === majority.y &&
          flushAction.text === majority.text &&
          flushAction.target === majority.target;
        executor = flushAgrees ? "local" : "sai";
        if (!flushAgrees) {
          decision = "escalate";
        }
      }
    }

    // Outcome. Local steps on hard screens fail often; Sai rarely fails.
    let label: StepLabel = "ok";
    if (executor === "local") {
      const pFail = hard ? 0.7 : 0.005;
      if (rand() < pFail) {
        label = "fail";
      }
    } else if (rand() < 0.005) {
      label = "fail";
    }
    if (label === "fail") {
      failed = true;
    }
    if (isLast) {
      label = failed ? "fail" : "ok";
    }

    // Local compute (measured on the M2 through Ollama; three samples per step).
    const localMs = Math.round(between(rand, 2500, 7000));
    const localTokensIn =
      Math.round(between(rand, 620, 880)) * SAMPLES_PER_STEP;
    const localTokensOut = Math.round(between(rand, 22, 48)) * SAMPLES_PER_STEP;
    const localJoules = Number(
      ((localMs / 1000) * between(rand, 10, 14)).toFixed(2)
    );

    // Cloud usage.
    const sai = executor === "sai";
    const cloudMs = sai ? Math.round(between(rand, 4000, 12_000)) : 0;

    let actionTaken: ActionJson = toEnvAction(flushAction ?? majority);
    if (sai) {
      // In some escalations Sai does exactly what the local majority proposed.
      actionTaken = toEnvAction(
        rand() < 0.4 ? majority : perturb(rand, majority)
      );
    }

    clock += localMs + cloudMs + 250;
    const shot = String(shotCounter++).padStart(4, "0");

    steps.push({
      run_id: RUN_ID,
      mode,
      task_id: task.id,
      step_idx: idx,
      timestamp: new Date(clock).toISOString(),
      screenshot_path: `data/runs/${RUN_ID}/screens/${shot}_${mode}_${task.id}_${idx}.png`,
      screenshot_hash: hex(rand, 64),
      goal,
      history_summary: historyFor(task, script, goal, idx),
      local_samples: samples,
      local_logprob: Number(localLogprob.toFixed(3)),
      agreement_score: Number(agreement.toFixed(3)),
      flush_action: flushAction,
      flush_agrees: flushAgrees,
      laya_scores: hard
        ? {
            layout: Number(between(rand, 0.3, 0.6).toFixed(2)),
            affordance: Number(between(rand, 0.2, 0.5).toFixed(2)),
          }
        : null,
      gate_name: gateName[mode] ?? mode,
      gate_decision: decision,
      executor,
      action_taken: isLast ? { type: "done" } : actionTaken,
      step_label: label,
      local_ms: localMs,
      local_tokens_in: localTokensIn,
      local_tokens_out: localTokensOut,
      local_joules: localJoules,
      cloud_calls: sai ? 1 : 0,
      cloud_steps: sai ? Math.round(between(rand, 1, 3)) : 0,
      cloud_ms: cloudMs,
      cloud_usd: sai ? Number(between(rand, 0.18, 0.45).toFixed(3)) : 0,
      cloud_energy_wh_low: sai
        ? Number(((cloudMs / 3_600_000) * 300).toFixed(4))
        : null,
      cloud_energy_wh_high: sai
        ? Number(((cloudMs / 3_600_000) * 1200).toFixed(4))
        : null,
      handoff_tokens: sai ? Math.round(between(rand, 1500, 2600)) : 0,
      pii_strings_visible: isLast ? [] : scripted.pii,
      injection_visible: scripted.injection,
      // not scripted in the sample run (no screenshots to compare)
      phash_distance: null,
      screen_changed: null,
    });
  }

  return { steps, success: !failed };
};

export interface RunData {
  created_at: string;
  run_id: string;
  spec_id: string;
  steps: StepRecord[];
}

const build = (): RunData => {
  const steps: StepRecord[] = [];
  let clock = BASE_TIME;
  shotCounter = 0;
  MODES.forEach((mode, mi) => {
    SAMPLE_TASK_IDS.forEach((taskId, ti) => {
      const task = taskById(taskId);
      const script = SAMPLE_SCRIPTS[taskId];
      if (!(task && script)) {
        throw new Error(`sample run: no script for ${taskId}`);
      }
      const ep = generateEpisode(
        mode,
        task,
        script,
        1000 + mi * 100 + ti * 7,
        clock
      );
      steps.push(...ep.steps);
      const last = ep.steps.at(-1);
      clock = last ? Date.parse(last.timestamp) + 2000 : clock + 60_000;
    });
  });
  return {
    run_id: RUN_ID,
    created_at: new Date(BASE_TIME).toISOString(),
    spec_id: "spec_acme_dispute",
    steps,
  };
};

export const SAMPLE_RUN: RunData = build();
export const SAMPLE_GATE_THRESHOLD = GATE_THRESHOLD;
