// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one timeline composes replay, live tailing and the mode filter
"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Card } from "@repo/design-system/components/ui/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/design-system/components/ui/toggle-group";
import { cn } from "@repo/design-system/lib/utils";
import {
  FastForwardIcon,
  FlagIcon,
  KeyRoundIcon,
  PauseIcon,
  PlayIcon,
  RadioIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExecutorBadge, GateBadge, LabelBadge } from "@/components/gate-badge";
import { MetricTile } from "@/components/metric-tile";
import { ScreenThumb } from "@/components/screen-thumb";
import { actionKind, describeAction } from "@/lib/actions";
import { successLabel, suiteOrder, taskById } from "@/lib/data/task-suite";
import { fmtMs, fmtPct, fmtUsd, shortHash } from "@/lib/format";
import {
  type ActionJson,
  gateThresholdFromName,
  METHOD,
  type Mode,
  modeLabel,
  orderModes,
  type StepRecord,
} from "@/lib/schema";

const tally = (samples: ActionJson[]) => {
  const counts = new Map<string, number>();
  for (const a of samples) {
    const k = describeAction(a, false);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const STAGE_RE = /^Stage (\d+) of (\d+) · ([^.]+)\.\s*(.*)$/;

/** The sample run (and any runner that wants a marker) prefixes history_summary with "Stage n of m · title." */
const stageOf = (history: string) => {
  const m = STAGE_RE.exec(history);
  if (!m) {
    return null;
  }
  return {
    n: Number(m[1]),
    of: Number(m[2]),
    title: m[3] ?? "",
    rest: m[4] ?? "",
  };
};

/** Suite tasks first, in tasks/tasks.yaml order, then unknown task ids in order of first appearance. */
const sortSteps = (steps: StepRecord[]): StepRecord[] => {
  const order = new Map<string, number>(suiteOrder);
  for (const s of steps) {
    if (!order.has(s.task_id)) {
      order.set(s.task_id, order.size);
    }
  }
  return [...steps].sort(
    (a, b) =>
      (order.get(a.task_id) ?? 0) - (order.get(b.task_id) ?? 0) ||
      a.step_idx - b.step_idx
  );
};

const EventIcon = ({
  kind,
}: {
  kind: "shield" | "key" | "check" | "phase";
}) => {
  if (kind === "key") {
    return <KeyRoundIcon className="mt-0.5 size-4 text-gate-flush" />;
  }
  if (kind === "phase") {
    return <FlagIcon className="mt-0.5 size-4 text-primary" />;
  }
  return <ShieldCheckIcon className="mt-0.5 size-4 text-measured" />;
};

type Row =
  | {
      kind: "event";
      id: string;
      title: string;
      detail: string;
      icon: "shield" | "key" | "check" | "phase";
    }
  | { kind: "step"; id: string; step: StepRecord };

interface LivePanelProps {
  defaultMode: Mode | undefined;
  fallbackThreshold: number;
  /** Tail /api/runs/<id>/steps for new lines. Off for the sample run. */
  live: boolean;
  /** Start in replay mode (steps revealed one by one). On for the sample run. */
  replayByDefault: boolean;
  runId: string;
  /** `/api/runs/<id>/screens` when real screenshots exist, else null. */
  screensBase: string | null;
  steps: StepRecord[];
}

const POLL_MS = 2000;

export const LivePanel = ({
  steps,
  runId,
  live,
  replayByDefault,
  defaultMode,
  fallbackThreshold,
  screensBase,
}: LivePanelProps) => {
  const [all, setAll] = useState<StepRecord[]>(steps);
  const [modeFilter, setModeFilter] = useState<string>(defaultMode ?? "all");
  const [replay, setReplay] = useState(replayByDefault);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [approved, setApproved] = useState(false);
  const [lastNew, setLastNew] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);

  // Tail the log when it may still be growing.
  useEffect(() => {
    if (!live) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/runs/${encodeURIComponent(runId)}/steps?after=${all.length}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as { steps: StepRecord[] };
        if (data.steps.length && !cancelled) {
          setAll((prev) => [...prev, ...data.steps]);
          setLastNew(Date.now());
        }
      } catch {
        // transient; try again next tick
      }
    };
    const t = window.setInterval(() => {
      tick().catch(() => undefined);
      setNow(Date.now());
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [live, runId, all.length]);

  const modes = useMemo(() => orderModes(all.map((s) => s.mode)), [all]);
  const source = useMemo(
    () =>
      sortSteps(
        modeFilter === "all" ? all : all.filter((s) => s.mode === modeFilter)
      ),
    [all, modeFilter]
  );
  const threshold =
    gateThresholdFromName(source.find((s) => s.gate_name)?.gate_name) ??
    fallbackThreshold;

  const firstSai = useMemo(
    () => source.findIndex((s) => s.executor === "sai"),
    [source]
  );
  const awaitingApproval =
    replay && !approved && firstSai >= 0 && cursor === firstSai;
  const finished = cursor >= source.length;

  useEffect(() => {
    if (!(replay && playing) || awaitingApproval || finished) {
      return;
    }
    const t = window.setInterval(
      () => setCursor((c) => Math.min(source.length, c + 1)),
      1300 / speed
    );
    return () => window.clearInterval(t);
  }, [replay, playing, awaitingApproval, finished, speed, source.length]);

  const visible = replay ? source.slice(0, cursor) : source;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a row appears
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visible.length, awaitingApproval]);

  const localSteps = visible.filter((s) => s.executor === "local").length;
  const spend = visible.reduce((a, s) => a + s.cloud_usd, 0);
  const elapsed = visible.reduce((a, s) => a + s.local_ms + s.cloud_ms, 0);
  const escalations = visible.filter((s) => s.executor === "sai").length;
  const lastStep = visible.at(-1);
  // A logged run is complete when its last step is done. A live tail cannot
  // know whether the runner will start another task.
  const runComplete =
    (replay && finished && source.length > 0) ||
    (!(replay || live) &&
      !!lastStep &&
      actionKind(lastStep.action_taken) === "done");

  const rows: Row[] = [];
  if (visible.length || replay) {
    rows.push({
      kind: "event",
      id: "ev-preflight",
      title: "Preflight confirmed by user",
      detail:
        "Rule 4 estimate shown and accepted. Logged as a permission event.",
      icon: "shield",
    });
  }
  visible.forEach((s, i) => {
    const prev = visible[i - 1];
    if (!prev || prev.task_id !== s.task_id) {
      const task = taskById(s.task_id);
      rows.push({
        kind: "event",
        id: `ev-task-${s.mode}-${s.task_id}`,
        title: task
          ? `Task ${task.id} · ${task.title}`
          : `Task ${s.task_id} · ${modeLabel(s.mode)}`,
        detail: task
          ? `${task.app} · ${task.kind} · up to ${task.max_steps} steps · done when ${successLabel(task)}`
          : s.goal,
        icon: "phase",
      });
    }
    const stage = stageOf(s.history_summary);
    const prevStage =
      prev && prev.task_id === s.task_id ? stageOf(prev.history_summary) : null;
    if (stage && prevStage?.title !== stage.title) {
      rows.push({
        kind: "event",
        id: `ev-stage-${s.mode}-${s.task_id}-${stage.n}`,
        title: `Stage ${stage.n} of ${stage.of} · ${stage.title}`,
        detail: stage.rest || `${taskById(s.task_id)?.app ?? ""}.`,
        icon: "phase",
      });
    }
    if (replay && i === firstSai) {
      rows.push({
        kind: "event",
        id: "ev-approval",
        title: "Sai approval link printed, user approved",
        detail:
          "Rule 3. The runner printed the link-only approval URL and waited.",
        icon: "key",
      });
    }
    rows.push({
      kind: "step",
      id: `${s.mode}-${s.task_id}-${s.step_idx}`,
      step: s,
    });
  });
  if (awaitingApproval) {
    rows.push({
      kind: "event",
      id: "ev-await",
      title: "Sai asks for link-only approval",
      detail:
        "The runner printed the approval URL and is waiting for you. Nothing is sent until you approve.",
      icon: "key",
    });
  }
  if (runComplete) {
    rows.push({
      kind: "event",
      id: "ev-done",
      title: "Run complete",
      detail:
        "Every step is in data/runs/<run_id>/steps.jsonl. Results and the boundary view read from it.",
      icon: "check",
    });
  }

  const startReplay = () => {
    setReplay(true);
    setCursor(0);
    setApproved(false);
    setPlaying(true);
  };

  const showAll = () => {
    setReplay(false);
    setCursor(source.length);
  };

  const jumpToEscalation = () => {
    if (firstSai < 0) {
      return;
    }
    setCursor(firstSai);
    setPlaying(true);
  };

  const sinceNew = lastNew ? Math.round((now - lastNew) / 1000) : null;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          how="Steps executed by the local model so far, over steps shown."
          label="Local step share"
          provenance="measured"
          value={visible.length ? fmtPct(localSteps / visible.length) : "–"}
        />
        <MetricTile
          how={METHOD.cloud_usd ?? ""}
          label="Cloud spend so far"
          provenance="measured"
          value={fmtUsd(spend)}
        />
        <MetricTile
          how={`${METHOD.local_ms ?? ""} Plus ${METHOD.cloud_ms ?? ""}`}
          label="Agent time"
          provenance="measured"
          value={fmtMs(elapsed)}
        />
        <MetricTile
          how="Count of steps with executor = sai."
          label="Escalations"
          provenance="measured"
          value={String(escalations)}
        />
        <MetricTile
          how="Steps shown over steps logged for the selected mode."
          label="Progress"
          provenance="measured"
          value={`${visible.length} / ${source.length}`}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {replay ? (
          <>
            <Button
              onClick={() => setPlaying((p) => !p)}
              size="sm"
              variant="outline"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}{" "}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              onClick={() => setSpeed((s) => (s === 1 ? 4 : 1))}
              size="sm"
              variant="outline"
            >
              <FastForwardIcon /> {speed}×
            </Button>
            <Button
              disabled={firstSai < 0}
              onClick={jumpToEscalation}
              size="sm"
              variant="outline"
            >
              Jump to first escalation
            </Button>
            <Button onClick={startReplay} size="sm" variant="ghost">
              <RotateCcwIcon /> Restart
            </Button>
            <Button onClick={showAll} size="sm" variant="ghost">
              Show all
            </Button>
          </>
        ) : (
          <Button onClick={startReplay} size="sm" variant="outline">
            <PlayIcon /> Replay from start
          </Button>
        )}
        {modes.length > 1 ? (
          <ToggleGroup
            className="ml-1"
            onValueChange={(v) => {
              if (v) {
                setModeFilter(v);
                setCursor(0);
                setApproved(false);
              }
            }}
            size="sm"
            type="single"
            value={modeFilter}
            variant="outline"
          >
            {modes.map((m) => (
              <ToggleGroupItem className="text-xs" key={m} value={m}>
                {modeLabel(m)}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem className="text-xs" value="all">
              All
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {live ? (
            <Badge
              className="gap-1.5 border-measured/60 font-mono text-[10px] text-measured"
              variant="outline"
            >
              <RadioIcon className="size-3 animate-pulse" />
              live · tailing steps.jsonl
              {sinceNew !== null ? ` · last step ${sinceNew}s ago` : ""}
            </Badge>
          ) : (
            <Badge className="font-mono text-[10px]" variant="outline">
              replaying logged run
            </Badge>
          )}
          <Badge className="font-mono text-[10px]" variant="outline">
            gate:{" "}
            {source.find((s) => s.gate_name)?.gate_name ??
              `agreement_gate@${threshold}`}
          </Badge>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="hidden grid-cols-[3rem_9rem_6rem_1fr_7rem_5.5rem_4rem_1fr_4rem_6rem_5rem] gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground lg:grid">
          <span>#</span>
          <span>task · app</span>
          <span>screen</span>
          <span>local proposals</span>
          <span>agreement</span>
          <span>gate</span>
          <span>ran on</span>
          <span>action taken</span>
          <span>label</span>
          <span className="text-right">latency</span>
          <span className="text-right">cost</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center text-muted-foreground text-sm">
              <RadioIcon className="size-5 animate-pulse" />
              {live
                ? "Waiting for the runner to append the first step…"
                : "No steps in this mode."}
            </div>
          ) : null}
          {rows.map((r) =>
            r.kind === "event" ? (
              <div
                className="flex items-start gap-3 border-b bg-muted/30 px-3 py-2 text-xs"
                key={r.id}
              >
                <EventIcon kind={r.icon} />
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-muted-foreground">{r.detail}</div>
                </div>
                {r.id === "ev-await" ? (
                  <Button
                    className="ml-auto"
                    onClick={() => setApproved(true)}
                    size="sm"
                  >
                    Approve (demo)
                  </Button>
                ) : null}
              </div>
            ) : (
              <StepRow
                key={r.id}
                screensBase={screensBase}
                step={r.step}
                threshold={threshold}
              />
            )
          )}
          <div ref={endRef} />
        </div>
      </Card>
    </div>
  );
};

const StepRow = ({
  step,
  threshold,
  screensBase,
}: {
  step: StepRecord;
  threshold: number;
  screensBase: string | null;
}) => {
  const agreement = step.agreement_score ?? 0;
  const hesitant = agreement < threshold;
  const app = taskById(step.task_id)?.app;
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 border-b px-3 py-2 text-xs lg:grid-cols-[3rem_9rem_6rem_1fr_7rem_5.5rem_4rem_1fr_4rem_6rem_5rem] lg:items-center",
        "border-l-2 border-l-transparent",
        step.executor === "sai" && "border-l-gate-escalate bg-gate-escalate/5",
        step.executor === "local" &&
          step.gate_decision === "flush" &&
          "border-l-gate-flush"
      )}
    >
      <span className="tabular font-mono text-muted-foreground">
        {step.step_idx}
      </span>
      <span className="flex min-w-0 flex-col font-mono leading-4">
        <span className="truncate">{step.task_id}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {app ?? "–"}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <ScreenThumb
          base={screensBase}
          screenshotPath={step.screenshot_path}
          taskId={step.task_id}
        />
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {shortHash(step.screenshot_hash || "–")}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-1 lg:col-span-1">
        {tally(step.local_samples).map(([text, n]) => (
          <Badge
            className="max-w-full font-mono text-[10px]"
            key={text}
            variant="secondary"
          >
            <span className="truncate">{text}</span>
            {n > 1 ? <span className="text-muted-foreground">×{n}</span> : null}
          </Badge>
        ))}
        {step.local_samples.length === 0 ? (
          <span className="text-muted-foreground">–</span>
        ) : null}
        {step.local_samples[0]?.why ? (
          <span className="w-full truncate text-[10px] text-muted-foreground italic">
            {step.local_samples[0].why}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              "block h-full",
              hesitant ? "bg-gate-escalate" : "bg-gate-local"
            )}
            style={{ width: `${Math.round(agreement * 100)}%` }}
          />
        </span>
        <span className="tabular font-mono">
          {step.agreement_score === null ? "–" : agreement.toFixed(2)}
        </span>
      </span>
      <span>
        <GateBadge decision={step.gate_decision} />
      </span>
      <span>
        <ExecutorBadge executor={step.executor} />
      </span>
      <span className="truncate font-mono">
        {describeAction(step.action_taken, false)}
      </span>
      <span>
        <LabelBadge label={step.step_label} />
      </span>
      <span className="tabular text-right font-mono">
        {fmtMs(step.local_ms + step.cloud_ms)}
      </span>
      <span className="tabular text-right font-mono">
        {step.cloud_usd ? fmtUsd(step.cloud_usd) : "–"}
      </span>
    </div>
  );
};
