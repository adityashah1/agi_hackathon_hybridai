import { actionKind, sameAction } from "./actions";
import type { ActionType, GateDecision, Mode, StepRecord } from "./schema";
import { orderModes } from "./schema";

/** Pure functions over StepRecord[]. No I/O, so they run on server or client. */

export interface Episode {
  /** The last step's action is done. False while the runner is still writing. */
  complete: boolean;
  mode: Mode;
  steps: StepRecord[];
  success: boolean;
  task_id: string;
}

export const episodes = (steps: StepRecord[]): Episode[] => {
  const map = new Map<string, StepRecord[]>();
  for (const s of steps) {
    const key = `${s.mode}|${s.task_id}`;
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  return [...map.entries()].map(([key, arr]) => {
    const sorted = [...arr].sort((a, b) => a.step_idx - b.step_idx);
    const [mode, task_id] = key.split("|") as [Mode, string];
    const last = sorted.at(-1);
    return {
      mode,
      task_id,
      steps: sorted,
      complete: actionKind(last?.action_taken) === "done",
      success:
        actionKind(last?.action_taken) === "done" && last?.step_label === "ok",
    };
  });
};

export interface Range {
  high: number;
  low: number;
}

export interface ModeSummary {
  cloudCalls: number;
  cloudMs: number;
  cloudUsd: number;
  cloudWh: Range;
  flushSteps: number;
  handoffTokens: number;
  injectionExposures: number;
  /** Successful tasks per Wh. Range because cloud energy is a range. */
  ipw: Range;
  localMs: number;
  localShare: number;
  localSteps: number;
  localTokensIn: number;
  localTokensOut: number;
  localWh: number;
  mode: Mode;
  piiExposures: number;
  saiSteps: number;
  /** True when every phase of the scenario finished in this mode. */
  scenarioDone: boolean;
  screensCrossed: number;
  steps: number;
  successes: number;
  successRate: number;
  tasks: number;
  totalWh: Range;
  wallMs: number;
  /** Wh per finished task. */
  whPerSuccess: Range;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const summarizeMode = (steps: StepRecord[], mode: Mode): ModeSummary => {
  const own = steps.filter((s) => s.mode === mode);
  const eps = episodes(own);
  const successes = eps.filter((e) => e.success).length;
  const saiSteps = own.filter((s) => s.executor === "sai");
  const localSteps = own.filter((s) => s.executor === "local");
  const localWh = sum(own.map((s) => s.local_joules ?? 0)) / 3600;
  const cloudWh: Range = {
    low: sum(own.map((s) => s.cloud_energy_wh_low ?? 0)),
    high: sum(own.map((s) => s.cloud_energy_wh_high ?? 0)),
  };
  const totalWh: Range = {
    low: localWh + cloudWh.low,
    high: localWh + cloudWh.high,
  };
  const ipw: Range = {
    low: totalWh.high > 0 ? successes / totalWh.high : 0,
    high: totalWh.low > 0 ? successes / totalWh.low : 0,
  };
  const whPerSuccess: Range = {
    low: successes > 0 ? totalWh.low / successes : 0,
    high: successes > 0 ? totalWh.high / successes : 0,
  };
  const localMs = sum(own.map((s) => s.local_ms));
  const cloudMs = sum(own.map((s) => s.cloud_ms));
  return {
    mode,
    tasks: eps.length,
    successes,
    successRate: eps.length ? successes / eps.length : 0,
    scenarioDone: eps.length > 0 && successes === eps.length,
    steps: own.length,
    localSteps: localSteps.length,
    saiSteps: saiSteps.length,
    flushSteps: own.filter((s) => s.gate_decision === "flush").length,
    localShare: own.length ? localSteps.length / own.length : 0,
    localMs,
    cloudMs,
    wallMs: localMs + cloudMs,
    cloudUsd: sum(own.map((s) => s.cloud_usd)),
    cloudCalls: sum(own.map((s) => s.cloud_calls)),
    localTokensIn: sum(own.map((s) => s.local_tokens_in)),
    localTokensOut: sum(own.map((s) => s.local_tokens_out)),
    handoffTokens: sum(own.map((s) => s.handoff_tokens)),
    localWh,
    cloudWh,
    totalWh,
    ipw,
    whPerSuccess,
    piiExposures: sum(saiSteps.map((s) => s.pii_strings_visible.length)),
    injectionExposures: saiSteps.filter((s) => s.injection_visible).length,
    screensCrossed: saiSteps.length,
  };
};

export const summarizeAll = (steps: StepRecord[]): ModeSummary[] =>
  orderModes(steps.map((s) => s.mode)).map((m) => summarizeMode(steps, m));

/** Was each routing decision right? Counts for one mode's steps. */
export interface RoutingMatrix {
  escalateFail: number;
  escalateOk: number;
  escalations: number;
  /** Escalations where Sai took the same action the local majority proposed. Measured after the fact. */
  escalationsLocalWouldMatch: number;
  flushResolvedLocal: number;
  localFail: number;
  localOk: number;
}

export const routingMatrix = (
  steps: StepRecord[],
  mode: Mode = "hybrid"
): RoutingMatrix => {
  const own = steps.filter((s) => s.mode === mode);
  const m: RoutingMatrix = {
    localOk: 0,
    localFail: 0,
    escalateOk: 0,
    escalateFail: 0,
    flushResolvedLocal: 0,
    escalationsLocalWouldMatch: 0,
    escalations: 0,
  };
  for (const s of own) {
    const ok = s.step_label === "ok";
    if (s.executor === "local") {
      if (ok) {
        m.localOk++;
      } else {
        m.localFail++;
      }
      if (s.gate_decision === "flush") {
        m.flushResolvedLocal++;
      }
    } else {
      m.escalations++;
      if (ok) {
        m.escalateOk++;
      } else {
        m.escalateFail++;
      }
      if (sameAction(s.action_taken, s.local_samples[0])) {
        m.escalationsLocalWouldMatch++;
      }
    }
  }
  return m;
};

export interface SweepPoint {
  /** Share of steps that would escalate at this threshold. Replayed from logs. */
  cloudShare: number;
  /** Estimated task-step success. Modeled. */
  successEst: number;
  threshold: number;
}

export type GateSignal = "agreement" | "logprob";

const signalValue = (s: StepRecord, signal: GateSignal): number | null =>
  signal === "agreement" ? s.agreement_score : s.local_logprob;

const SWEEP_POINTS = 21;

/** Threshold grid: 0..1 for agreement; the observed log-prob range (default -4..0) for logprob. */
const sweepThresholds = (values: number[], signal: GateSignal): number[] => {
  let lo = 0;
  let hi = 1;
  if (signal === "logprob") {
    lo = values.length ? Math.floor(Math.min(...values) * 10) / 10 : -4;
    hi = values.length ? Math.ceil(Math.max(...values) * 10) / 10 : 0;
    if (hi - lo < 0.5) {
      lo = hi - 0.5;
    }
  }
  const step = (hi - lo) / (SWEEP_POINTS - 1);
  return Array.from({ length: SWEEP_POINTS }, (_, i) =>
    Number((lo + i * step).toFixed(3))
  );
};

export const gateSweep = (
  steps: StepRecord[],
  signal: GateSignal = "agreement"
): SweepPoint[] => {
  const scored = steps.filter((s) => signalValue(s, signal) !== null);
  const localOnly = steps.filter(
    (s) => s.mode === "local_only" && s.executor === "local"
  );
  const saiSteps = steps.filter((s) => s.executor === "sai");
  const saiOk = saiSteps.length
    ? saiSteps.filter((s) => s.step_label === "ok").length / saiSteps.length
    : 0.95;
  const values = scored.map((s) => signalValue(s, signal) ?? 0);
  return sweepThresholds(values, signal).map((threshold) => {
    const escalate = scored.filter(
      (s) => (signalValue(s, signal) ?? Number.POSITIVE_INFINITY) < threshold
    ).length;
    const cloudShare = scored.length ? escalate / scored.length : 0;
    const keptLocal = localOnly.filter(
      (s) => (signalValue(s, signal) ?? Number.POSITIVE_INFINITY) >= threshold
    );
    const localOk = keptLocal.length
      ? keptLocal.filter((s) => s.step_label === "ok").length / keptLocal.length
      : saiOk;
    return {
      threshold,
      cloudShare,
      successEst: localOk * (1 - cloudShare) + saiOk * cloudShare,
    };
  });
};

export interface BoundaryRow {
  piiCount: number;
  step: StepRecord;
}

export const boundaryRows = (steps: StepRecord[], mode?: Mode): BoundaryRow[] =>
  steps
    .filter((s) => s.executor === "sai" && (!mode || s.mode === mode))
    .map((step) => ({ step, piiCount: step.pii_strings_visible.length }));

export interface FailureCluster {
  action: ActionType | "unknown";
  count: number;
  decision: GateDecision;
  meanAgreement: number;
  modes: Mode[];
  task_id: string;
}

export const failureClusters = (steps: StepRecord[]): FailureCluster[] => {
  const map = new Map<string, FailureCluster & { agreements: number[] }>();
  for (const s of steps.filter(
    (x) => x.step_label === "fail" && x.executor === "local"
  )) {
    const action = s.local_samples[0]?.type ?? "unknown";
    const key = `${s.task_id}|${action}|${s.gate_decision}`;
    const cur = map.get(key) ?? {
      task_id: s.task_id,
      action,
      decision: s.gate_decision,
      count: 0,
      modes: [],
      meanAgreement: 0,
      agreements: [],
    };
    cur.count++;
    if (!cur.modes.includes(s.mode)) {
      cur.modes.push(s.mode);
    }
    cur.agreements.push(s.agreement_score ?? 0);
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ agreements, ...c }) => ({
      ...c,
      meanAgreement: agreements.length
        ? sum(agreements) / agreements.length
        : 0,
    }))
    .sort((a, b) => b.count - a.count);
};

export interface Forecast {
  hoursPerMonth: number;
  mode: Mode;
  tasksPerMonth: number;
  usdPerMonth: number;
  usdPerTask: number;
  whPerMonth: Range;
}

export const forecast = (
  summary: ModeSummary,
  dailyVolume: number
): Forecast => {
  const tasksPerMonth = dailyVolume * 30;
  const perTask = (x: number) => (summary.tasks ? x / summary.tasks : 0);
  return {
    mode: summary.mode,
    tasksPerMonth,
    usdPerTask: perTask(summary.cloudUsd),
    usdPerMonth: perTask(summary.cloudUsd) * tasksPerMonth,
    whPerMonth: {
      low: perTask(summary.totalWh.low) * tasksPerMonth,
      high: perTask(summary.totalWh.high) * tasksPerMonth,
    },
    hoursPerMonth: (perTask(summary.wallMs) * tasksPerMonth) / 3_600_000,
  };
};

/** Pre-run estimate. Uses the same per-task means as the forecast, flagged modeled. */
export interface Preflight {
  cloudWh: Range;
  episodes: number;
  localWh: number;
  needsConfirmation: boolean;
  usd: number;
  wallMinutes: number;
}

export const preflight = (
  summaries: ModeSummary[],
  taskCount: number,
  modes: Mode[],
  seeds: number
): Preflight => {
  const per = (mode: Mode) => summaries.find((s) => s.mode === mode);
  let usd = 0;
  let wallMs = 0;
  let localWh = 0;
  const cloudWh: Range = { low: 0, high: 0 };
  for (const mode of modes) {
    const s = per(mode);
    if (!s?.tasks) {
      continue;
    }
    const n = taskCount * seeds;
    usd += (s.cloudUsd / s.tasks) * n;
    wallMs += (s.wallMs / s.tasks) * n;
    localWh += (s.localWh / s.tasks) * n;
    cloudWh.low += (s.cloudWh.low / s.tasks) * n;
    cloudWh.high += (s.cloudWh.high / s.tasks) * n;
  }
  return {
    episodes: taskCount * modes.length * seeds,
    usd,
    wallMinutes: wallMs / 60_000,
    localWh,
    cloudWh,
    needsConfirmation:
      taskCount * seeds > 3 && modes.some((m) => m !== "local_only"),
  };
};

/** What the parser and metrics can say about a run's shape before any screen trusts it. */
export interface RunHealth {
  episodes: number;
  /** "mode · task_id" for episodes whose last logged step is not done. */
  incompleteEpisodes: string[];
  modes: Mode[];
  /** Steps with no agreement score. The gate sweep skips them. */
  stepsWithoutAgreement: number;
  tasks: string[];
  /** Steps with step_label = unknown. */
  unknownLabels: number;
}

export const runHealth = (steps: StepRecord[]): RunHealth => {
  const eps = episodes(steps);
  return {
    modes: orderModes(steps.map((s) => s.mode)),
    tasks: [...new Set(steps.map((s) => s.task_id))],
    episodes: eps.length,
    incompleteEpisodes: eps
      .filter((e) => !e.complete)
      .map((e) => `${e.mode} · ${e.task_id}`),
    unknownLabels: steps.filter((s) => s.step_label === "unknown").length,
    stepsWithoutAgreement: steps.filter((s) => s.agreement_score === null)
      .length,
  };
};
