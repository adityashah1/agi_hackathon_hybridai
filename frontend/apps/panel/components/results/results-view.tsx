"use client";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/design-system/components/ui/tabs";
import { cn } from "@repo/design-system/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { GateBadge } from "@/components/gate-badge";
import { MetricTile } from "@/components/metric-tile";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { RangeBar } from "@/components/range-bar";
import {
  fmtInt,
  fmtMs,
  fmtNum,
  fmtPct,
  fmtRange,
  fmtUsd,
  fmtWh,
} from "@/lib/format";
import type { FailureCluster, ModeSummary, RoutingMatrix } from "@/lib/metrics";
import { METHOD, modeLabel } from "@/lib/schema";

interface Props {
  clusters: FailureCluster[];
  hybridMode: string;
  matrix: RoutingMatrix;
  summaries: ModeSummary[];
}

const successConfig = {
  successRate: { label: "Task success", color: "var(--chart-2)" },
} satisfies ChartConfig;

const costConfig = {
  cloudUsd: { label: "Cloud USD", color: "var(--chart-1)" },
} satisfies ChartConfig;

export const ResultsView = ({
  summaries,
  matrix,
  clusters,
  hybridMode,
}: Props) => {
  const hybrid = summaries.find((s) => s.mode === hybridMode);
  const chartData = summaries.map((s) => ({
    label: modeLabel(s.mode),
    successRate: Number((s.successRate * 100).toFixed(0)),
    cloudUsd: Number(s.cloudUsd.toFixed(2)),
  }));
  const maxWh = Math.max(...summaries.map((s) => s.totalWh.high), 0.001);
  const total =
    matrix.localOk + matrix.localFail + matrix.escalateOk + matrix.escalateFail;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          emphasis
          how={METHOD.ipw ?? ""}
          label="Intelligence per watt-hour · hybrid"
          provenance="modeled"
          sub="finished tasks per Wh, low to high"
          value={hybrid ? fmtRange(hybrid.ipw, (x) => fmtNum(x, 1)) : "–"}
        />
        <MetricTile
          emphasis
          how={METHOD.ipw ?? ""}
          label="Energy per finished task · hybrid"
          provenance="modeled"
          sub="Wh, low to high"
          value={
            hybrid ? fmtRange(hybrid.whPerSuccess, (x) => fmtNum(x, 2)) : "–"
          }
        />
        <MetricTile
          emphasis
          how="Steps whose executor was the local model, over all hybrid steps."
          label="Local step share · hybrid"
          provenance="measured"
          sub={`${hybrid?.saiSteps ?? 0} escalations, ${hybrid?.flushSteps ?? 0} flush checks`}
          value={fmtPct(hybrid?.localShare ?? 0)}
        />
        <MetricTile
          emphasis
          how={METHOD.success ?? ""}
          label="Tasks completed · hybrid"
          provenance="measured"
          sub={`all tasks done: ${hybrid?.scenarioDone ? "yes" : "no"} · ${summaries
            .filter((s) => s.mode !== hybridMode)
            .map((s) => `${modeLabel(s.mode)} ${fmtPct(s.successRate)}`)
            .join(" · ")}`}
          value={fmtPct(hybrid?.successRate ?? 0)}
        />
      </section>

      <Tabs defaultValue="done">
        <TabsList>
          <TabsTrigger value="done">Did the job get done</TabsTrigger>
          <TabsTrigger value="cost">What did it cost</TabsTrigger>
          <TabsTrigger value="routing">
            Was each routing decision right
          </TabsTrigger>
        </TabsList>

        <TabsContent className="grid gap-4 lg:grid-cols-2" value="done">
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Tasks completed per mode{" "}
                <ProvenanceBadge how={METHOD.success ?? ""} kind="measured" />
              </CardTitle>
              <CardDescription>
                Final state after the last step: the CONFIRM code or the answer
                regex from tasks/tasks.yaml.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer className="h-56 w-full" config={successConfig}>
                <BarChart data={chartData} margin={{ left: -16, top: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tickLine={false} />
                  <YAxis
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tickLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="successRate"
                    fill="var(--color-successRate)"
                    isAnimationActive={false}
                    radius={4}
                  >
                    <LabelList
                      className="fill-foreground text-xs"
                      dataKey="successRate"
                      formatter={(v: unknown) => `${String(v)}%`}
                      position="top"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">Per mode</CardTitle>
              <CardDescription>
                All tasks done:{" "}
                {summaries
                  .map(
                    (s) =>
                      `${modeLabel(s.mode)} ${s.scenarioDone ? "yes" : "no"}`
                  )
                  .join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                    <TableHead className="text-right">Done</TableHead>
                    <TableHead className="text-right">Steps</TableHead>
                    <TableHead className="text-right">Local share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((s) => (
                    <TableRow key={s.mode}>
                      <TableCell>{modeLabel(s.mode)}</TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {s.tasks}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {s.successes}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {s.steps}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtPct(s.localShare)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="grid gap-4 lg:grid-cols-2" value="cost">
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Cloud spend per mode{" "}
                <ProvenanceBadge how={METHOD.cloud_usd ?? ""} kind="measured" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer className="h-56 w-full" config={costConfig}>
                <BarChart data={chartData} margin={{ left: -8, top: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis axisLine={false} dataKey="label" tickLine={false} />
                  <YAxis
                    axisLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                    tickLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="cloudUsd"
                    fill="var(--color-cloudUsd)"
                    isAnimationActive={false}
                    radius={4}
                  >
                    <LabelList
                      className="fill-foreground text-xs"
                      dataKey="cloudUsd"
                      formatter={(v: unknown) => `$${String(v)}`}
                      position="top"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Energy per mode{" "}
                <ProvenanceBadge
                  how={METHOD.cloud_energy ?? ""}
                  kind="modeled"
                />
              </CardTitle>
              <CardDescription>
                Solid is measured local energy. Hatched is the modeled cloud
                band.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {summaries.map((s) => (
                <div className="flex flex-col gap-1" key={s.mode}>
                  <div className="flex items-center justify-between text-xs">
                    <span>{modeLabel(s.mode)}</span>
                    <span className="tabular font-mono">
                      {fmtRange(s.totalWh, fmtWh)}
                    </span>
                  </div>
                  <RangeBar
                    high={s.totalWh.high}
                    low={s.totalWh.low}
                    max={maxWh}
                    tone={s.cloudWh.high > 0 ? "modeled" : "measured"}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="gap-2 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Cost table</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Agent time</TableHead>
                    <TableHead className="text-right">
                      Local tokens in / out
                    </TableHead>
                    <TableHead className="text-right">Handoff tokens</TableHead>
                    <TableHead className="text-right">Cloud calls</TableHead>
                    <TableHead className="text-right">Cloud USD</TableHead>
                    <TableHead className="text-right">Local Wh</TableHead>
                    <TableHead className="text-right">Cloud Wh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((s) => (
                    <TableRow key={s.mode}>
                      <TableCell>{modeLabel(s.mode)}</TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtMs(s.wallMs)}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtInt(s.localTokensIn)} / {fmtInt(s.localTokensOut)}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtInt(s.handoffTokens)}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {s.cloudCalls}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtUsd(s.cloudUsd)}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {fmtWh(s.localWh)}
                      </TableCell>
                      <TableCell className="tabular text-right font-mono">
                        {s.cloudWh.high > 0 ? fmtRange(s.cloudWh, fmtWh) : "–"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-2 flex gap-2 text-muted-foreground text-xs">
                <ProvenanceBadge
                  how={`${METHOD.local_ms ?? ""} ${METHOD.local_tokens ?? ""} ${METHOD.cloud_usd ?? ""}`}
                  kind="measured"
                />
                time, tokens, dollars, local Wh
                <ProvenanceBadge
                  how={METHOD.cloud_energy ?? ""}
                  kind="modeled"
                />
                cloud Wh
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="grid gap-4 lg:grid-cols-2" value="routing">
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Routing matrix · hybrid{" "}
                <ProvenanceBadge
                  how="Counts of gate decision against step outcome, read from the log."
                  kind="measured"
                />
              </CardTitle>
              <CardDescription>
                {total} steps. Rows are what the gate did. Columns are how the
                step turned out.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[6rem_1fr_1fr] gap-2 text-sm">
                <div />
                <div className="text-center text-muted-foreground text-xs">
                  step ok
                </div>
                <div className="text-center text-muted-foreground text-xs">
                  step failed
                </div>
                <div className="flex items-center text-xs">
                  <GateBadge decision="local" />
                </div>
                <Cell
                  label="kept local, worked"
                  n={matrix.localOk}
                  tone="good"
                />
                <Cell
                  label="missed escalation"
                  n={matrix.localFail}
                  tone="bad"
                />
                <div className="flex items-center text-xs">
                  <GateBadge decision="escalate" />
                </div>
                <Cell
                  label="escalated, Sai finished it"
                  n={matrix.escalateOk}
                  tone="neutral"
                />
                <Cell
                  label="escalated, Sai also failed"
                  n={matrix.escalateFail}
                  tone="bad"
                />
              </div>
              <div className="mt-4 rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span>
                    Escalations where Sai took the action the local majority
                    proposed
                  </span>
                  <span className="tabular font-mono font-semibold">
                    {matrix.escalationsLocalWouldMatch} / {matrix.escalations}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Measured after the fact. These are candidates for wasted
                  escalations, not proof: the local action might still have
                  landed differently. Flush checks resolved locally:{" "}
                  {matrix.flushResolvedLocal}.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">
                Failure clusters · local steps
              </CardTitle>
              <CardDescription>
                Failed local steps grouped by task and proposed action. The
                OpenJarvis loop would hand these to a frontier model to propose
                edits to the local setup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {clusters.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No local failures in this run.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Proposed</TableHead>
                      <TableHead>Gate</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">
                        Mean agreement
                      </TableHead>
                      <TableHead>Modes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusters.map((c) => (
                      <TableRow key={`${c.task_id}-${c.action}-${c.decision}`}>
                        <TableCell className="font-mono text-xs">
                          {c.task_id}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.action}
                        </TableCell>
                        <TableCell>
                          <GateBadge decision={c.decision} />
                        </TableCell>
                        <TableCell className="tabular text-right font-mono">
                          {c.count}
                        </TableCell>
                        <TableCell className="tabular text-right font-mono">
                          {c.meanAgreement.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {c.modes.map((m) => modeLabel(m)).join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Cell = ({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "good" | "bad" | "neutral";
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center rounded-md border p-3",
      tone === "good" && "border-measured/60 bg-measured/5",
      tone === "bad" && "border-destructive/50 bg-destructive/5",
      tone === "neutral" && "border-gate-escalate/50 bg-gate-escalate/5"
    )}
  >
    <span className="tabular font-mono font-semibold text-2xl">{n}</span>
    <span className="text-center text-[11px] text-muted-foreground">
      {label}
    </span>
  </div>
);
