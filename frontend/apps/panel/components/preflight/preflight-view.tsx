"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/design-system/components/ui/alert";
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
import { CheckIcon, ShieldAlertIcon, TerminalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BackendStatus } from "@/components/backend-status";
import { MetricTile } from "@/components/metric-tile";
import { SpecCard } from "@/components/spec-card";
import type { BackendStatus as Status } from "@/lib/backend";
import { SUITE } from "@/lib/data/task-suite";
import { fmtInt, fmtRange, fmtUsd, fmtWh } from "@/lib/format";
import type { JobRecord } from "@/lib/jobs";
import { type ModeSummary, preflight } from "@/lib/metrics";
import { METHOD, modeLabel } from "@/lib/schema";
import type { TaskSpec } from "@/lib/spec";
import { useSpec } from "@/lib/use-spec";

const CHECKS = [
  "One local model loaded: Qwen3-VL 2B through Ollama, which unloads any other model first and refuses to load under 35% free memory.",
  "One Sai lease reused from data/lease.json. Nothing calls close; on the free plan that would wipe the computer.",
  "Fake personal data only. Approval links are printed and waited on.",
  "Every number below is labeled measured or modeled.",
];

const ID_CHARS = /[-:.TZ]/g;
const SPEC_PREFIX = /^spec_/;

const runnerCommand = (spec: TaskSpec, runId: string) =>
  `python -m runner.run --spec tasks/${spec.spec_id}.json --run-id ${runId} --modes ${spec.modes.join(",")} --seeds ${spec.seeds}`;

const newRunId = (specId: string) =>
  `run_${new Date().toISOString().replace(ID_CHARS, "").slice(0, 14)}_${specId.replace(SPEC_PREFIX, "")}`.slice(
    0,
    100
  );

export const PreflightView = ({
  summaries,
  backend,
}: {
  summaries: ModeSummary[];
  backend: Status;
}) => {
  const router = useRouter();
  const { spec, ready, source } = useSpec();
  const est = preflight(
    summaries,
    spec.task_ids.length,
    spec.modes,
    spec.seeds
  );
  const [busy, setBusy] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  const saveSpec = async (): Promise<string> => {
    const res = await fetch("/api/spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    });
    const data = (await res.json()) as { path?: string; error?: string };
    if (!(res.ok && data.path)) {
      throw new Error(data.error ?? `saving the spec failed (${res.status})`);
    }
    return data.path;
  };

  const start = async () => {
    setBusy(true);
    setManual(null);
    try {
      window.localStorage.setItem(
        "hybrid-gate.preflight_confirmed_at",
        new Date().toISOString()
      );
    } catch {
      // ignore
    }
    try {
      const path = await saveSpec();
      setSavedTo(path);
      const runId = newRunId(spec.spec_id);
      if (!backend.runner) {
        setManual(runnerCommand(spec, runId));
        toast.message("Spec saved. runner/run.py is not in the repo yet.", {
          description:
            "The exact command the panel will launch is shown below.",
        });
        return;
      }
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "run",
          spec_id: spec.spec_id,
          run_id: runId,
          modes: spec.modes,
          seeds: spec.seeds,
          confirm: true,
        }),
      });
      const job = (await res.json()) as JobRecord & { error?: string };
      if (!res.ok) {
        throw new Error(job.error ?? `launch failed (${res.status})`);
      }
      await fetch("/api/select-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      toast.success(`Runner started as ${job.id}. Tailing ${runId}.`);
      router.push("/run");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-4">
        <BackendStatus initial={backend} />

        <section className="grid gap-3 sm:grid-cols-2">
          <MetricTile
            how="Tasks × modes × seeds from the spec card."
            label="Episodes to run"
            provenance="measured"
            value={fmtInt(est.episodes)}
          />
          <MetricTile
            how={`${METHOD.forecast ?? ""} Before the run this is a prediction from the previous run's per-task mean.`}
            label="Sai spend, estimated"
            provenance="modeled"
            sub="becomes measured when the run finishes"
            value={fmtUsd(est.usd)}
          />
          <MetricTile
            how="Per-task wall time from the previous run, scaled to this plan. Sequential episodes, one model at a time."
            label="Wall time, estimated"
            provenance="modeled"
            unit="min"
            value={est.wallMinutes.toFixed(0)}
          />
          <MetricTile
            how={`${METHOD.local_joules ?? ""} Scaled to this plan.`}
            label="Energy, estimated"
            provenance="modeled"
            sub={`cloud share ${fmtRange(est.cloudWh, fmtWh)}`}
            value={fmtWh(est.localWh)}
          />
        </section>

        {est.needsConfirmation ? (
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>
              Rule 4: this run spends Sai credits on more than 3 tasks
            </AlertTitle>
            <AlertDescription>
              The estimate above is printed. Nothing runs until you confirm. The
              confirmation is logged as a permission event on the live panel and
              passed to the runner as an explicit flag.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckIcon />
            <AlertTitle>Below the Rule 4 threshold</AlertTitle>
            <AlertDescription>
              Three tasks or fewer, so the run can start without a bulk-spend
              confirmation.
            </AlertDescription>
          </Alert>
        )}

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">Episode plan</CardTitle>
            <CardDescription>
              Episodes run sequentially. The local model proposes in every mode
              so the gate can be replayed offline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>App</TableHead>
                  {spec.modes.map((m) => (
                    <TableHead className="text-right" key={m}>
                      {modeLabel(m)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {spec.task_ids.map((id) => {
                  const t = SUITE.find((x) => x.id === id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="text-xs">
                        <span className="font-mono">{id}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {t?.title ?? "not in tasks/tasks.yaml"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{t?.app ?? "–"}</TableCell>
                      {spec.modes.map((m) => (
                        <TableCell
                          className="tabular text-right font-mono text-xs"
                          key={m}
                        >
                          {spec.seeds} × ≤{t?.max_steps ?? "?"} steps
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">Rule check</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {CHECKS.map((c) => (
                <li className="flex items-start gap-2" key={c}>
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={start} size="lg">
            {est.needsConfirmation
              ? "Confirm estimate and start run"
              : "Start run"}
          </Button>
          <Button onClick={() => router.push("/intake")} variant="outline">
            Back to intake
          </Button>
          {ready ? (
            <Badge className="text-[10px]" variant="outline">
              spec source: {source}
            </Badge>
          ) : null}
          {savedTo ? (
            <Badge className="font-mono text-[10px]" variant="outline">
              saved {savedTo.split("/").slice(-2).join("/")}
            </Badge>
          ) : null}
        </div>

        {manual ? (
          <Alert>
            <TerminalIcon />
            <AlertTitle>
              Spec saved. The runner is not in the repo yet.
            </AlertTitle>
            <AlertDescription>
              <p>
                When runner/run.py lands, the Start run button launches exactly
                this from the repo root. Until then:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
                {manual}
              </pre>
              <p className="mt-2">
                It should append one StepRecord per line to
                data/runs/&lt;run_id&gt;/steps.jsonl. The live run screen tails
                that file.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      <SpecCard spec={spec} />
    </div>
  );
};
