import { Badge } from "@repo/design-system/components/ui/badge";
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
import { FlaskConicalIcon } from "lucide-react";
import type { Metadata } from "next";
import { BackendStatus } from "@/components/backend-status";
import { Differentiator } from "@/components/differentiator";
import { JobConsole, type Launcher } from "@/components/job-console";
import { PageHeader } from "@/components/page-header";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { getBackendStatus } from "@/lib/backend";
import type { BenchSummary, CallsSummary, SubgoalSummary } from "@/lib/bench";
import {
  listArtifacts,
  loadBenches,
  loadCallsOnly,
  loadSubgoalResults,
  type RunArtifacts,
} from "@/lib/data/source";
import { fmtInt, fmtMs, fmtPct, fmtUsd } from "@/lib/format";
import { BENCH_MODELS, listJobs } from "@/lib/jobs";
import { LOCAL_BRAINS } from "@/lib/models";
import { METHOD } from "@/lib/schema";

export const metadata: Metadata = { title: "Benchmarks" };

const brainName = (tag: string) =>
  LOCAL_BRAINS.find((b) => b.bench_tag === tag)?.name ?? tag;
const ms = (x: number | null) => (x === null ? "–" : fmtMs(x));
const int = (x: number | null) => (x === null ? "–" : fmtInt(x));

const BenchTable = ({ benches }: { benches: BenchSummary[] }) => (
  <Card className="gap-2">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        Local brain benchmark{" "}
        <ProvenanceBadge how={METHOD.bench ?? ""} kind="measured" />
      </CardTitle>
      <CardDescription>
        data/runs/bench_*/bench.jsonl. Five saved screenshots, two calls each,
        one sample, temperature 0, through Ollama on this Mac.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {benches.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No bench run on disk yet. Start Ollama, then press a bench button
          above or run{" "}
          <code className="font-mono text-xs">
            python -m brain.bench --model qwen3-vl:2b
          </code>{" "}
          from the repo root.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Run</TableHead>
              <TableHead className="text-right">Image width</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Valid schema</TableHead>
              <TableHead className="text-right">Median latency</TableHead>
              <TableHead className="text-right">Warm median</TableHead>
              <TableHead className="text-right">First call</TableHead>
              <TableHead className="text-right">Tokens in / out</TableHead>
              <TableHead className="text-right">Decision log-prob</TableHead>
              <TableHead className="text-right">Click hits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {benches.map((b) => (
              <TableRow key={b.run_id}>
                <TableCell className="text-xs">
                  {brainName(b.model_tag)}
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {b.run_id}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {b.image_width ?? "–"}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {b.calls}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {fmtPct(b.validRate)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {ms(b.medianLatencyMs)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {ms(b.warmMedianLatencyMs)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {ms(b.firstCallMs)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {int(b.medianTokensIn)} / {int(b.medianTokensOut)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {b.medianLogprob === null ? "–" : b.medianLogprob.toFixed(3)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {b.judged ? `${b.hits} / ${b.judged}` : "–"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
);

const SubgoalCard = ({ subgoals }: { subgoals: SubgoalSummary[] }) => (
  <Card className="gap-2">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        Sai subgoal containment{" "}
        <ProvenanceBadge
          how="Verdicts come from Sai's own recorded trajectory: did any step go past the handed-off 'done when' condition."
          kind="measured"
        />
      </CardTitle>
      <CardDescription>
        data/runs/subgoal_*/subgoal_results.jsonl. When the gate hands one step
        to Sai, does Sai stop where it was told to? Three runs per test, the
        Rule 4 cap.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {subgoals.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No subgoal test on disk yet. It spends Sai credits on exactly three
          tasks, so it sits behind a confirm above.
        </p>
      ) : (
        subgoals.map((s) => (
          <div className="rounded-md border p-3" key={s.run_id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{s.run_id}</span>
              <Badge
                className="border-measured/60 text-[10px] text-measured"
                variant="outline"
              >
                stopped at done {s.counts.stopped_at_done}
              </Badge>
              <Badge
                className="border-gate-flush/60 text-[10px] text-gate-flush"
                variant="outline"
              >
                kept going {s.counts.kept_going}
              </Badge>
              <Badge
                className="border-destructive/60 text-[10px] text-destructive"
                variant="outline"
              >
                did not reach {s.counts.did_not_reach}
              </Badge>
              <span className="ml-auto text-muted-foreground text-xs">
                cost estimate {fmtUsd(s.totalCostEstimate)}
                {s.totalCreditsDelta === null
                  ? ""
                  : ` · credits delta ${fmtUsd(s.totalCreditsDelta)}`}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Steps</TableHead>
                  <TableHead className="text-right">Model calls</TableHead>
                  <TableHead className="text-right">Seconds</TableHead>
                  <TableHead className="text-right">Cost est.</TableHead>
                  <TableHead className="text-right">Credits Δ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.rows.map((r) => (
                  <TableRow key={`${s.run_id}-${r.run}`}>
                    <TableCell className="tabular font-mono text-xs">
                      {r.run}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.verdict}
                    </TableCell>
                    <TableCell className="text-xs">{r.status ?? "–"}</TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {r.steps ?? "–"}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {r.model_calls ?? "–"}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {r.elapsed_s ?? "–"}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {typeof r.cost_usd_estimate === "number"
                        ? fmtUsd(r.cost_usd_estimate)
                        : "–"}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">
                      {typeof r.credits_delta_usd === "number"
                        ? fmtUsd(r.credits_delta_usd)
                        : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const CallsTable = ({
  callsOnly,
}: {
  callsOnly: { run_id: string; calls: CallsSummary }[];
}) => (
  <Card className="gap-2">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        Environment calls{" "}
        <ProvenanceBadge how={METHOD.cloud_ms ?? ""} kind="measured" />
      </CardTitle>
      <CardDescription>
        calls.jsonl from smoke and probe runs that have no steps.jsonl. Every
        Sai or Playwright call, timed.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {callsOnly.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No call logs yet. The local smoke test above writes one without
          spending Sai time.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Total time</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Slowest ops</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {callsOnly.map(({ run_id, calls }) => (
              <TableRow key={run_id}>
                <TableCell className="font-mono text-xs">{run_id}</TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {calls.count}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {fmtMs(calls.totalMs)}
                </TableCell>
                <TableCell className="tabular text-right font-mono text-xs">
                  {calls.failed}
                </TableCell>
                <TableCell className="text-xs">
                  {calls.localCalls === calls.count
                    ? "local Chromium"
                    : "Sai cloud"}
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {calls.byOp
                    .slice(0, 3)
                    .map((o) => `${o.op} ${fmtMs(o.ms)}`)
                    .join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
);

const ArtifactsTable = ({ artifacts }: { artifacts: RunArtifacts[] }) => (
  <Card className="gap-2">
    <CardHeader>
      <CardTitle className="text-base">Run directories</CardTitle>
      <CardDescription>
        What each folder under data/runs contains.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {artifacts.length === 0 ? (
        <p className="text-muted-foreground text-sm">data/runs is empty.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Directory</TableHead>
              <TableHead>Modified</TableHead>
              <TableHead>Contains</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artifacts.map((a) => (
              <TableRow key={a.run_id}>
                <TableCell className="font-mono text-xs">{a.run_id}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {a.modified_at.replace("T", " ").slice(0, 19)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.steps ? (
                      <Badge className="text-[10px]">steps.jsonl</Badge>
                    ) : null}
                    {a.calls ? (
                      <Badge className="text-[10px]" variant="secondary">
                        calls.jsonl
                      </Badge>
                    ) : null}
                    {a.bench ? (
                      <Badge className="text-[10px]" variant="secondary">
                        bench.jsonl
                      </Badge>
                    ) : null}
                    {a.subgoal ? (
                      <Badge className="text-[10px]" variant="secondary">
                        subgoal_results.jsonl
                      </Badge>
                    ) : null}
                    {a.screens ? (
                      <Badge className="text-[10px]" variant="outline">
                        {a.screens} screenshots
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
);

const Page = async () => {
  const [backend, benches, subgoals, callsOnly, artifacts] = await Promise.all([
    getBackendStatus(),
    loadBenches(),
    loadSubgoalResults(),
    loadCallsOnly(),
    listArtifacts(),
  ]);
  const jobs = listJobs();

  const needsOllama = backend.ollama.running
    ? undefined
    : "Ollama is not running";
  const needsDeps =
    backend.deps.requests && backend.deps.PIL
      ? undefined
      : "Python deps are missing";
  const needsSai = backend.saiKey ? undefined : "No SAI_API_KEY in .env";
  const needsPlaywright = backend.deps.playwright
    ? undefined
    : "playwright is not installed";

  const mockRunning = backend.mockApps.running;
  const launchers: Launcher[] = [
    {
      label: `Serve mock apps on :${backend.mockApps.port}`,
      request: { kind: "mockapps" },
      disabled: mockRunning || !backend.mockApps.present,
      disabledReason: mockRunning
        ? "already serving"
        : "mock_apps/ not in this checkout",
    },
    {
      label: "Mock apps self-test · 27 checks",
      request: { kind: "selftest" },
      disabled: !(mockRunning && backend.deps.playwright),
      disabledReason: mockRunning
        ? "playwright is not installed"
        : "serve the mock apps first",
    },
    ...BENCH_MODELS.map((model) => ({
      label: `Bench ${LOCAL_BRAINS.find((b) => b.id === model)?.name ?? model}`,
      request: { kind: "bench" as const, model },
      disabled: !!(needsDeps ?? needsOllama),
      disabledReason: needsDeps ?? needsOllama,
    })),
    {
      label: "Smoke test · local Chromium",
      request: { kind: "smoke", env: "local" },
      disabled: !!(needsDeps ?? needsPlaywright),
      disabledReason: needsDeps ?? needsPlaywright,
    },
    {
      label: "Smoke test · Sai",
      request: { kind: "smoke", env: "sai" },
      disabled: !!(needsDeps ?? needsSai),
      disabledReason: needsDeps ?? needsSai,
    },
    {
      label: "Subgoal test · 3 Sai tasks",
      request: { kind: "subgoal", confirm: true },
      confirmText:
        "This runs exactly three Sai tasks and spends credits. The lease stays open. Continue?",
      disabled: !!(needsDeps ?? needsSai),
      disabledReason: needsDeps ?? needsSai,
    },
  ];
  const launchable: Launcher[] = backend.readOnly
    ? launchers.map((l) => ({
        ...l,
        disabled: true,
        disabledReason: "read-only hosted copy",
      }))
    : launchers;

  return (
    <>
      <PageHeader
        description="Everything the Python side has measured on this Mac and against Sai, read straight from data/runs, and the buttons that produce more of it."
        title="Benchmarks"
      />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <Differentiator
          claim="Measured before the demo, not during it."
          detail="brain/bench.py times the local brain on saved screenshots. env/subgoal_test.py checks whether Sai stops at a handed-off subgoal. The smoke tests time every environment call. Launch them here; their files land here automatically."
          icon={FlaskConicalIcon}
        />
        <BackendStatus initial={backend} />
        <JobConsole
          description="Each button runs a Python entry point from the repo root and tails its output. The mock apps server may run beside one model job; everything else runs one at a time. Buttons are disabled until the backend status above says the prerequisite is there."
          initialJobs={jobs}
          launchers={launchable}
        />
        <BenchTable benches={benches} />
        <SubgoalCard subgoals={subgoals} />
        <CallsTable callsOnly={callsOnly} />
        <ArtifactsTable artifacts={artifacts} />
      </div>
    </>
  );
};

export default Page;
