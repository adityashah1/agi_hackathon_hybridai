"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
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
import {
  AlertTriangleIcon,
  CopyIcon,
  DownloadIcon,
  FileJsonIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MetricTile } from "@/components/metric-tile";
import { ScreenThumb } from "@/components/screen-thumb";
import { SCENARIO } from "@/lib/data/task-suite";
import {
  fmtInt,
  fmtPct,
  fmtRange,
  fmtUsd,
  fmtWh,
  shortHash,
} from "@/lib/format";
import { toJsonl } from "@/lib/jsonl";
import {
  type BoundaryRow,
  forecast,
  type ModeSummary,
  type RoutingMatrix,
} from "@/lib/metrics";
import { METHOD, type Mode, modeLabel, type StepRecord } from "@/lib/schema";
import { useSpec } from "@/lib/use-spec";

interface Props {
  hybridMode: string;
  matrix: RoutingMatrix;
  rows: BoundaryRow[];
  runId: string;
  screensBase: string | null;
  steps: StepRecord[];
  summaries: ModeSummary[];
}

const buildReport = (p: Props, dailyVolume: number) => {
  const lines: string[] = [];
  lines.push(`# hybrid-gate report · ${p.runId}`);
  lines.push("");
  lines.push(`Scenario: ${SCENARIO.sentence}`);
  lines.push("");
  lines.push(
    "Legend: **measured** = read from this machine or Sai's response. **modeled** = price sheet, spec sheet or stated assumption. Cloud energy is always a low–high range."
  );
  lines.push("");
  lines.push("## Did the job get done (measured)");
  lines.push("");
  lines.push(
    "| Mode | Phases | Done | Scenario | Success | Steps | Local share |"
  );
  lines.push("|---|---:|---:|---|---:|---:|---:|");
  for (const s of p.summaries) {
    lines.push(
      `| ${modeLabel(s.mode)} | ${s.tasks} | ${s.successes} | ${s.scenarioDone ? "done" : "not done"} | ${fmtPct(s.successRate)} | ${s.steps} | ${fmtPct(s.localShare)} |`
    );
  }
  lines.push("");
  lines.push("## What did it cost");
  lines.push("");
  lines.push(
    "| Mode | Agent time (measured) | Cloud USD (measured) | Local Wh (measured) | Cloud Wh (modeled) | Tasks per Wh (modeled) |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const s of p.summaries) {
    lines.push(
      `| ${modeLabel(s.mode)} | ${(s.wallMs / 1000).toFixed(0)} s | ${fmtUsd(s.cloudUsd)} | ${fmtWh(s.localWh)} | ${s.cloudWh.high > 0 ? fmtRange(s.cloudWh, fmtWh) : "–"} | ${fmtRange(s.ipw, (x) => x.toFixed(1))} |`
    );
  }
  lines.push("");
  lines.push("## Was each routing decision right (hybrid, measured)");
  lines.push("");
  lines.push(`- kept local, worked: ${p.matrix.localOk}`);
  lines.push(`- missed escalation (local failed): ${p.matrix.localFail}`);
  lines.push(`- escalated, Sai finished it: ${p.matrix.escalateOk}`);
  lines.push(`- escalated, Sai also failed: ${p.matrix.escalateFail}`);
  lines.push(
    `- escalations where Sai took the local majority's action: ${p.matrix.escalationsLocalWouldMatch} of ${p.matrix.escalations} (candidates for wasted escalations)`
  );
  lines.push("");
  lines.push("## What crossed the boundary (measured)");
  lines.push("");
  for (const s of p.summaries.filter((x) => x.screensCrossed > 0)) {
    lines.push(
      `- ${modeLabel(s.mode)}: ${s.screensCrossed} screens, ${fmtInt(s.handoffTokens)} handoff tokens, ${s.piiExposures} fake PII strings visible, ${s.injectionExposures} injection screens seen by the cloud`
    );
  }
  lines.push("");
  lines.push(`## Forecast at ${dailyVolume} tasks per day (modeled)`);
  lines.push("");
  lines.push(
    "| Mode | Cloud USD / month | Energy / month | Agent hours / month |"
  );
  lines.push("|---|---:|---:|---:|");
  for (const s of p.summaries) {
    const f = forecast(s, dailyVolume);
    lines.push(
      `| ${modeLabel(s.mode)} | ${fmtUsd(f.usdPerMonth)} | ${fmtRange(f.whPerMonth, fmtWh)} | ${f.hoursPerMonth.toFixed(1)} |`
    );
  }
  lines.push("");
  lines.push("Methodology:");
  for (const [k, v] of Object.entries(METHOD)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");
  return lines.join("\n");
};

export const BoundaryView = (props: Props) => {
  const { spec } = useSpec();
  const [mode, setMode] = useState<Mode | "all">("hybrid");
  const rows = useMemo(
    () => props.rows.filter((r) => mode === "all" || r.step.mode === mode),
    [props.rows, mode]
  );
  const hybrid = props.summaries.find((s) => s.mode === props.hybridMode);
  const sai = props.summaries.find((s) => s.mode === "sai_only");

  const download = () => {
    const md = buildReport(props, spec.daily_volume);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.runId}-report.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  const downloadTraces = () => {
    const blob = new Blob([toJsonl(props.steps)], {
      type: "application/jsonl;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.runId}-steps.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${props.steps.length} step traces downloaded`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildReport(props, spec.daily_volume)
      );
      toast.success("Report copied as Markdown");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          how="Count of hybrid steps whose executor was Sai. Each one sent a screenshot across the boundary."
          label="Screens that crossed · hybrid"
          provenance="measured"
          sub={`Sai only sent ${sai?.screensCrossed ?? 0}`}
          value={String(hybrid?.screensCrossed ?? 0)}
        />
        <MetricTile
          how={METHOD.handoff_tokens ?? ""}
          label="Handoff tokens · hybrid"
          provenance="measured"
          sub={`Sai only ${fmtInt(sai?.handoffTokens ?? 0)}`}
          value={fmtInt(hybrid?.handoffTokens ?? 0)}
        />
        <MetricTile
          how="Fake PII strings present on screens that were sent to Sai, counted per step from the leak detector."
          label="PII strings exposed · hybrid"
          provenance="measured"
          sub={`Sai only ${sai?.piiExposures ?? 0}`}
          value={String(hybrid?.piiExposures ?? 0)}
        />
        <MetricTile
          how="Steps where a planted prompt-injection string was visible on a screen that reached the cloud."
          label="Injection screens seen by cloud"
          provenance="measured"
          sub={`Sai only ${sai?.injectionExposures ?? 0}`}
          value={String(hybrid?.injectionExposures ?? 0)}
        />
      </section>

      <Card className="gap-2">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Exactly what crossed</CardTitle>
            <CardDescription>
              Every step whose executor was Sai. The goal text and screenshot
              are what left this Mac.
            </CardDescription>
          </div>
          <ToggleGroup
            onValueChange={(v) => v && setMode(v as Mode | "all")}
            size="sm"
            type="single"
            value={mode}
            variant="outline"
          >
            <ToggleGroupItem value="hybrid">Hybrid</ToggleGroupItem>
            <ToggleGroupItem value="sai_only">Sai only</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mode</TableHead>
                <TableHead>Task</TableHead>
                <TableHead className="text-right">#</TableHead>
                <TableHead>Screenshot</TableHead>
                <TableHead className="text-right">Handoff tokens</TableHead>
                <TableHead>PII visible</TableHead>
                <TableHead>Injection</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ step, piiCount }) => (
                <TableRow key={`${step.mode}-${step.task_id}-${step.step_idx}`}>
                  <TableCell className="text-xs">
                    {modeLabel(step.mode)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {step.task_id}
                  </TableCell>
                  <TableCell className="tabular text-right font-mono text-xs">
                    {step.step_idx}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScreenThumb
                        base={props.screensBase}
                        screenshotPath={step.screenshot_path}
                        taskId={step.task_id}
                      />
                      <span
                        className="font-mono text-[11px] text-muted-foreground"
                        title={step.screenshot_path}
                      >
                        {shortHash(step.screenshot_hash || "–")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right font-mono text-xs">
                    {fmtInt(step.handoff_tokens)}
                  </TableCell>
                  <TableCell>
                    {piiCount === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        none
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {step.pii_strings_visible.map((p) => (
                          <Badge
                            className="font-mono text-[10px]"
                            key={p}
                            variant="destructive"
                          >
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {step.injection_visible ? (
                      <span className="flex items-center gap-1 text-gate-flush text-xs">
                        <AlertTriangleIcon className="size-3" /> seen
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">–</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right font-mono text-xs">
                    {fmtUsd(step.cloud_usd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              Nothing crossed in this mode.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-base">Report</CardTitle>
          <CardDescription>
            Markdown with the three evaluation tables, the boundary totals, the
            forecast at the intake volume, and the measured/modeled legend at
            the top.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={download}>
            <DownloadIcon /> Download report (.md)
          </Button>
          <Button onClick={copy} variant="outline">
            <CopyIcon /> Copy as Markdown
          </Button>
          <Button onClick={downloadTraces} variant="outline">
            <FileJsonIcon /> Download step traces (.jsonl)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
