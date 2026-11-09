// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one screen, four cards sharing selectors
"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { Slider } from "@repo/design-system/components/ui/slider";
import { Switch } from "@repo/design-system/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/design-system/components/ui/toggle-group";
import { cn } from "@repo/design-system/lib/utils";
import { CheckIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { MetricTile } from "@/components/metric-tile";
import { ProvenanceBadge } from "@/components/provenance-badge";
import type { BenchSummary } from "@/lib/bench";
import {
  fmtInt,
  fmtMs,
  fmtNum,
  fmtPct,
  fmtRange,
  fmtUsd,
  fmtWh,
} from "@/lib/format";
import {
  type Forecast,
  forecast,
  type GateSignal,
  type ModeSummary,
  type Range,
  type SweepPoint,
} from "@/lib/metrics";
import {
  DEFAULT_BRAIN_ID,
  DEPLOYMENT_TIERS,
  type DeploymentTier,
  ESCALATION_TARGETS,
  fits,
  HARDWARE,
  LOCAL_BRAINS,
  tokensPerSecCeiling,
  USABLE_FRACTION,
} from "@/lib/models";
import { METHOD, type Provenance } from "@/lib/schema";
import type { TaskSpec } from "@/lib/spec";
import { useSpec } from "@/lib/use-spec";

interface Props {
  benches: BenchSummary[];
  currentThreshold: number;
  hybridMode: string;
  summaries: ModeSummary[];
  sweep: SweepPoint[];
  sweepLogprob: SweepPoint[];
}

const sweepConfig = {
  cloudShare: { label: "Cloud-call share", color: "var(--chart-1)" },
  successEst: { label: "Est. step success", color: "var(--chart-2)" },
} satisfies ChartConfig;

interface PlanRow {
  note: string;
  provenance: Provenance;
  success: number;
  tier: DeploymentTier;
  usd: number;
  wh: Range;
}

const ZERO: Range = { low: 0, high: 0 };

const buildPlan = (
  local: ModeSummary | undefined,
  hybrid: ModeSummary | undefined,
  localFc: Forecast | null,
  hybridFc: Forecast | null
): PlanRow[] =>
  DEPLOYMENT_TIERS.map((tier) => {
    if (tier.id === "laptop") {
      return {
        tier,
        usd: 0,
        wh: localFc?.whPerMonth ?? ZERO,
        success: local?.successRate ?? 0,
        provenance: "measured",
        note: "Local-only mode as measured in this run, scaled to volume.",
      };
    }
    if (tier.id === "laptop_cloud") {
      return {
        tier,
        usd: hybridFc?.usdPerMonth ?? 0,
        wh: hybridFc?.whPerMonth ?? ZERO,
        success: hybrid?.successRate ?? 0,
        provenance: "measured",
        note: "Hybrid mode as measured in this run, scaled to volume.",
      };
    }
    const wh = hybridFc?.whPerMonth ?? ZERO;
    return {
      tier,
      usd: (hybridFc?.usdPerMonth ?? 0) * 0.5,
      wh: { low: wh.low * 0.8 + 0.1, high: wh.high * 0.9 + 1 },
      success: hybrid?.successRate ?? 0,
      provenance: "modeled",
      note: "Assumes a 7B-class brain on the PGX halves escalations. Unmeasured until an episode runs there.",
    };
  });

const recommendTier = (spec: TaskSpec): DeploymentTier["id"] => {
  const sensitive =
    spec.sensitivity === "high_pii" || spec.sensitivity === "injection_prone";
  if (sensitive && spec.daily_volume >= 100) {
    return "deskside_cloud";
  }
  if (spec.escalation_targets.includes("none")) {
    return "laptop";
  }
  return "laptop_cloud";
};

const nearest = (points: SweepPoint[], t: number): SweepPoint =>
  points.reduce(
    (best, p) =>
      Math.abs(p.threshold - t) < Math.abs(best.threshold - t) ? p : best,
    points[0] ?? { threshold: 0, cloudShare: 0, successEst: 0 }
  );

export const WhatIfView = ({
  sweep,
  sweepLogprob,
  summaries,
  currentThreshold,
  hybridMode,
  benches,
}: Props) => {
  const { spec } = useSpec();
  const [signal, setSignal] = useState<GateSignal>("agreement");
  const [agreementThreshold, setAgreementThreshold] =
    useState(currentThreshold);
  const [logprobThreshold, setLogprobThreshold] = useState(-1);
  const [brainId, setBrainId] = useState(DEFAULT_BRAIN_ID);
  const [targetId, setTargetId] = useState<string>("sai");
  const [moe, setMoe] = useState(false);

  const hybrid = summaries.find((s) => s.mode === hybridMode);
  const local = summaries.find((s) => s.mode === "local_only");
  const sai = summaries.find((s) => s.mode === "sai_only");

  const activeSweep = signal === "agreement" ? sweep : sweepLogprob;
  const threshold =
    signal === "agreement" ? agreementThreshold : logprobThreshold;
  const setThreshold =
    signal === "agreement" ? setAgreementThreshold : setLogprobThreshold;
  const sweepMin = activeSweep[0]?.threshold ?? 0;
  const sweepMax = activeSweep.at(-1)?.threshold ?? 1;
  const sweepStep =
    activeSweep.length > 1
      ? Number(((sweepMax - sweepMin) / (activeSweep.length - 1)).toFixed(3))
      : 0.05;
  const point = useMemo(
    () => nearest(activeSweep, threshold),
    [activeSweep, threshold]
  );

  const brain = LOCAL_BRAINS.find((b) => b.id === brainId) ?? LOCAL_BRAINS[0];
  const current =
    LOCAL_BRAINS.find((b) => b.id === DEFAULT_BRAIN_ID) ?? LOCAL_BRAINS[0];
  const target =
    ESCALATION_TARGETS.find((t) => t.id === targetId) ?? ESCALATION_TARGETS[0];
  const m2 = HARDWARE[0];
  const bench = brain?.bench_tag
    ? benches.find((b) => b.model_tag === brain.bench_tag)
    : undefined;

  // Bring your own model: scale the measured local latency by active params (bandwidth-bound decode).
  const latencyScale =
    brain && current ? brain.active_params_b / current.active_params_b : 1;
  const measuredStepSec = hybrid
    ? hybrid.localMs / Math.max(1, hybrid.steps) / 1000
    : null;
  const hybridFc = hybrid ? forecast(hybrid, spec.daily_volume) : null;
  const saiPerMonth = hybridFc?.usdPerMonth ?? 0;
  const altPerMonth = target?.id === "sai" ? saiPerMonth : 0;

  const archBrain = moe
    ? LOCAL_BRAINS.find((b) => b.arch === "moe")
    : LOCAL_BRAINS.find((b) => b.id === DEFAULT_BRAIN_ID);

  const localFc = local ? forecast(local, spec.daily_volume) : null;
  const plan = buildPlan(local, hybrid, localFc, hybridFc);
  const recommended = recommendTier(spec);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Gate sweep
              <ProvenanceBadge
                how="Cloud-call share: replayed from the logged signal, so it is measured for this run's steps."
                kind="measured"
              />
              <ProvenanceBadge how={METHOD.gate_sweep ?? ""} kind="modeled" />
            </CardTitle>
            <CardDescription>
              Move the threshold. Below it the gate escalates. No Sai credits
              are spent replaying. Two signals the brain measures: sample
              agreement, and the decision-token log-prob Ollama reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <ToggleGroup
                onValueChange={(v) => {
                  if (v) {
                    setSignal(v as GateSignal);
                  }
                }}
                size="sm"
                type="single"
                value={signal}
                variant="outline"
              >
                <ToggleGroupItem className="text-xs" value="agreement">
                  agreement score
                </ToggleGroupItem>
                <ToggleGroupItem className="text-xs" value="logprob">
                  decision log-prob
                </ToggleGroupItem>
              </ToggleGroup>
              <span className="text-muted-foreground text-xs">
                {signal === "agreement"
                  ? "share of the step's samples that agree with the majority"
                  : "mean log-prob of the action, coordinates, text and key tokens"}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-24 text-xs">threshold</Label>
              <Slider
                max={sweepMax}
                min={sweepMin}
                onValueChange={(v) => setThreshold(v[0] ?? sweepMin)}
                step={sweepStep}
                value={[threshold]}
              />
              <span className="tabular w-14 text-right font-mono text-sm">
                {threshold.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricTile
                how="Share of logged steps whose signal is below the threshold."
                label="Cloud-call share"
                provenance="measured"
                value={fmtPct(point.cloudShare)}
              />
              <MetricTile
                how={METHOD.gate_sweep ?? ""}
                label="Est. step success"
                provenance="modeled"
                value={fmtPct(point.successEst)}
              />
            </div>
            <ChartContainer className="h-52 w-full" config={sweepConfig}>
              <LineChart data={activeSweep} margin={{ left: -16, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="threshold"
                  domain={[sweepMin, sweepMax]}
                  tickFormatter={(v: number) =>
                    v.toFixed(signal === "agreement" ? 1 : 1)
                  }
                  type="number"
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="cloudShare"
                  dot={false}
                  isAnimationActive={false}
                  stroke="var(--color-cloudShare)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="successEst"
                  dot={false}
                  isAnimationActive={false}
                  stroke="var(--color-successEst)"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  type="monotone"
                />
                <ReferenceLine
                  stroke="var(--foreground)"
                  strokeDasharray="2 4"
                  x={threshold}
                />
              </LineChart>
            </ChartContainer>
            <p className="text-muted-foreground text-xs">
              Current gate ran on agreement at {currentThreshold.toFixed(2)}.
              The curve is what the brief's idea 2 asks for: accuracy against
              cloud calls as the dial moves, with token probability as the
              second signal.
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Bring your own model
              <ProvenanceBadge
                how="Model sizes and the latency scaling are modeled from parameter counts. Bench rows below are measured when a bench.jsonl exists."
                kind="modeled"
              />
            </CardTitle>
            <CardDescription>
              Swap the local brain or the escalation target. Measured baselines
              stay visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Local brain</Label>
                <Select onValueChange={setBrainId} value={brainId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCAL_BRAINS.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} · {b.vendor}
                        {b.installed ? "" : " · not pulled"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Escalation target</Label>
                <Select onValueChange={setTargetId} value={targetId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCALATION_TARGETS.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {brain && m2 ? (
              <div className="grid grid-cols-2 gap-3">
                <MetricTile
                  how="Approximate Q4 weights plus vision tower."
                  label="Resident in memory"
                  provenance="modeled"
                  unit="GB"
                  value={fmtNum(brain.resident_gb, 1)}
                />
                <MetricTile
                  how={`Resident size against ${Math.round(USABLE_FRACTION * 100)}% of ${m2.memory_gb} GB, the free-memory floor brain/local_brain.py enforces.`}
                  label="Fits this Mac"
                  provenance="modeled"
                  sub={
                    fits(brain, m2)
                      ? ""
                      : "brain/local_brain.py would refuse to load it"
                  }
                  value={fits(brain, m2) ? "yes" : "no"}
                />
                <MetricTile
                  how="Memory bandwidth divided by active weights at 4-bit. A ceiling, not a measurement."
                  label="Decode ceiling"
                  provenance="modeled"
                  unit="tok/s"
                  value={fmtInt(tokensPerSecCeiling(brain, m2))}
                />
                <MetricTile
                  how="Measured local step time in this run scaled by the ratio of active parameters."
                  label="Local step time"
                  provenance="modeled"
                  sub={
                    measuredStepSec !== null
                      ? `measured now: ${fmtNum(measuredStepSec, 2)} s`
                      : ""
                  }
                  unit="s"
                  value={
                    measuredStepSec !== null
                      ? fmtNum(measuredStepSec * latencyScale, 2)
                      : "–"
                  }
                />
              </div>
            ) : null}
            <div className="rounded-md border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Measured on this Mac</span>
                {bench ? (
                  <ProvenanceBadge how={METHOD.bench ?? ""} kind="measured" />
                ) : (
                  <Badge className="text-[10px]" variant="outline">
                    no bench run yet
                  </Badge>
                )}
              </div>
              {bench ? (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground">median latency</div>
                    <div className="tabular font-mono">
                      {bench.medianLatencyMs !== null
                        ? fmtMs(bench.medianLatencyMs)
                        : "–"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">valid schema</div>
                    <div className="tabular font-mono">
                      {fmtPct(bench.validRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">click hits</div>
                    <div className="tabular font-mono">
                      {bench.hits} / {bench.judged}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">tokens in / out</div>
                    <div className="tabular font-mono">
                      {bench.medianTokensIn !== null
                        ? fmtInt(bench.medianTokensIn)
                        : "–"}{" "}
                      /{" "}
                      {bench.medianTokensOut !== null
                        ? fmtInt(bench.medianTokensOut)
                        : "–"}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  {brain?.installed
                    ? `Run python -m brain.bench --model ${brain.id} and this card fills itself from data/runs/bench_*/bench.jsonl.`
                    : "This model is not in brain/local_brain.py yet, so there is nothing to measure."}
                </p>
              )}
            </div>
            <div className="rounded-md border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  Escalation spend per month at {spec.daily_volume} tasks per
                  day
                </span>
                <span className="tabular font-mono">
                  {fmtUsd(saiPerMonth)}{" "}
                  <span className="text-muted-foreground">Sai, measured</span> →{" "}
                  {fmtUsd(altPerMonth)}{" "}
                  <span className="text-muted-foreground">
                    {target?.name.split(" (")[0]}, {target?.provenance}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {target?.note} {brain?.note}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Infrastructure{" "}
              <ProvenanceBadge how={METHOD.spec_sheet ?? ""} kind="modeled" />
            </CardTitle>
            <CardDescription>
              Compared by memory capacity and bandwidth, not TOPS. One measured
              episode on the PGX flips its row.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border p-3 text-xs">
              <div>
                <div className="font-medium">Dense or mixture of experts</div>
                <div className="text-muted-foreground">
                  {archBrain
                    ? `${archBrain.name}: ${archBrain.total_params_b}B total, ${archBrain.active_params_b}B active, ${archBrain.resident_gb} GB resident.`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(!moe && "font-medium")}>dense</span>
                <Switch checked={moe} onCheckedChange={setMoe} />
                <span className={cn(moe && "font-medium")}>MoE</span>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Memory</TableHead>
                  <TableHead className="text-right">Bandwidth</TableHead>
                  <TableHead className="text-right">Power</TableHead>
                  <TableHead className="text-center">Fits</TableHead>
                  <TableHead className="text-right">Ceiling</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {HARDWARE.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">{h.name}</TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {h.memory_gb} GB
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {fmtInt(h.bandwidth_gbs)} GB/s
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {h.power_w} W
                    </TableCell>
                    <TableCell className="text-center">
                      {archBrain && fits(archBrain, h) ? (
                        <CheckIcon className="mx-auto size-4 text-success" />
                      ) : (
                        <XIcon className="mx-auto size-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {archBrain
                        ? `${fmtInt(tokensPerSecCeiling(archBrain, h))} tok/s`
                        : "–"}
                    </TableCell>
                    <TableCell>
                      <ProvenanceBadge how={h.note} kind={h.provenance} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-muted-foreground text-xs">
              The MoE model is fast per token but all experts must sit in
              memory, so it does not fit this Mac and does fit the PGX. That is
              the disagreement between the speakers, in one row.
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">Deployment plan</CardTitle>
            <CardDescription>
              Monthly figures at {spec.daily_volume} tasks per day from the
              intake. Recommendation follows the spec's privacy class and
              volume.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {plan.map((p) => (
              <div
                className={cn(
                  "rounded-md border p-3",
                  recommended === p.tier.id && "border-primary bg-primary/5"
                )}
                key={p.tier.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.tier.name}</span>
                    {recommended === p.tier.id ? (
                      <Badge className="text-[10px]">recommended</Badge>
                    ) : null}
                  </div>
                  <ProvenanceBadge
                    how={`${p.note} ${METHOD.forecast ?? ""}`}
                    kind={p.provenance}
                  />
                </div>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {p.tier.summary}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">cloud spend</div>
                    <div className="tabular font-mono">{fmtUsd(p.usd)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">energy</div>
                    <div className="tabular font-mono">
                      {fmtRange(p.wh, fmtWh)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">task success</div>
                    <div className="tabular font-mono">{fmtPct(p.success)}</div>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              Sai-only at this volume would cost{" "}
              {fmtUsd(sai ? forecast(sai, spec.daily_volume).usdPerMonth : 0)}{" "}
              per month, measured per task in this run.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
