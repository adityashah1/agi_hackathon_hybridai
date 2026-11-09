// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one bar composes source, health, env calls and the picker
"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/design-system/components/ui/alert";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/design-system/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { cn } from "@repo/design-system/lib/utils";
import {
  AlertTriangleIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CallsSummary } from "@/lib/bench";
import type { RunSummary } from "@/lib/data/source";
import { fmtMs } from "@/lib/format";
import type { ParseReport } from "@/lib/jsonl";
import type { RunHealth } from "@/lib/metrics";

interface RunBarProps {
  calls: CallsSummary | null;
  current: {
    run_id: string;
    source: "sample" | "disk";
    step_count: number;
    path: string | null;
  };
  health: RunHealth;
  loadError: string | null;
  parse: ParseReport | null;
  runs: RunSummary[];
  screens: { available: boolean; count: number };
}

const selectRun = async (runId: string) => {
  const res = await fetch("/api/select-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!res.ok) {
    throw new Error(`select failed (${res.status})`);
  }
};

/**
 * Says, on every screen, whether the numbers come from the seeded sample or from a
 * real steps.jsonl, and lets you switch or load one. The honesty of every badge
 * below depends on this bar being visible.
 */
export const RunBar = ({
  runs,
  current,
  health,
  parse,
  calls,
  screens,
  loadError,
}: RunBarProps) => {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isSample = current.source === "sample";
  const problems =
    (parse?.rejectedCount ?? 0) +
    health.incompleteEpisodes.length +
    (parse?.warnings.length ?? 0) +
    (calls ? 1 : 0);

  const onSelect = async (id: string) => {
    if (id === current.run_id) {
      return;
    }
    setBusy(true);
    try {
      await selectRun(id);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/runs", { method: "POST", body: form });
      const data = (await res.json()) as {
        run_id?: string;
        error?: string;
        report?: ParseReport;
      };
      if (!(res.ok && data.run_id)) {
        throw new Error(data.error ?? `upload failed (${res.status})`);
      }
      await selectRun(data.run_id);
      const rejected = data.report?.rejectedCount ?? 0;
      toast.success(
        `Loaded ${data.run_id}: ${data.report?.accepted ?? 0} steps${rejected ? `, ${rejected} lines rejected` : ""}`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs",
          isSample
            ? "border-modeled/50 bg-modeled/5"
            : "border-measured/50 bg-measured/5"
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isSample ? (
            <FlaskConicalIcon className="size-4 shrink-0 text-modeled" />
          ) : (
            <DatabaseIcon className="size-4 shrink-0 text-measured" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {isSample ? "Seeded sample run" : "Real run"}
              </span>
              <Badge className="font-mono text-[10px]" variant="outline">
                {current.run_id}
              </Badge>
              <span className="text-muted-foreground">
                {current.step_count} steps · {health.modes.length} mode
                {health.modes.length === 1 ? "" : "s"} · {health.tasks.length}{" "}
                phase{health.tasks.length === 1 ? "" : "s"}
                {calls
                  ? ` · ${calls.count} env calls · ${fmtMs(calls.totalMs)}`
                  : ""}
                {screens.available ? ` · ${screens.count} screenshots` : ""}
              </span>
              {problems > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1 text-gate-flush"
                      type="button"
                    >
                      <AlertTriangleIcon className="size-3" />
                      details
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-96 text-xs">
                    <p className="mb-1 font-medium">Run health</p>
                    <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                      {health.incompleteEpisodes.map((e) => (
                        <li key={e}>episode {e} has no final done step yet</li>
                      ))}
                      {parse?.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                      {parse?.rejected.map((r) => (
                        <li key={`${r.line}-${r.reason}`}>
                          line {r.line} rejected: {r.reason}
                        </li>
                      ))}
                      {calls?.byOp.slice(0, 6).map((o) => (
                        <li key={o.op}>
                          {o.op}: {o.count} call{o.count === 1 ? "" : "s"},{" "}
                          {fmtMs(o.ms)}
                        </li>
                      ))}
                      {calls?.failed ? (
                        <li>
                          {calls.failed} env calls returned an error or no
                          status
                        </li>
                      ) : null}
                      {parse && parse.rejectedCount > parse.rejected.length ? (
                        <li>
                          and {parse.rejectedCount - parse.rejected.length} more
                          rejected lines
                        </li>
                      ) : null}
                    </ul>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            <p className="truncate text-muted-foreground">
              {isSample
                ? "Numbers show what will be measured. Load a real steps.jsonl from the runner to replace them."
                : (current.path ?? "steps.jsonl")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            disabled={busy}
            onValueChange={onSelect}
            value={current.run_id}
          >
            <SelectTrigger className="h-8 w-64 text-xs" size="sm">
              <SelectValue placeholder="Choose a run">
                <span className="font-mono">{current.run_id}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {isSample ? "sample" : `${current.step_count} steps`}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem className="text-xs" key={r.run_id} value={r.run_id}>
                  <span className="font-mono">{r.run_id}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {r.source === "sample" ? "sample" : `${r.step_count} steps`}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            accept=".jsonl,.json,.txt,application/jsonl,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onUpload(f).catch(() => undefined);
              }
            }}
            ref={fileRef}
            type="file"
          />
          <Button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            size="sm"
            variant="outline"
          >
            <UploadIcon /> Load steps.jsonl
          </Button>
          <Button
            disabled={busy}
            onClick={() => router.refresh()}
            size="icon-sm"
            title="Rescan data/runs"
            variant="ghost"
          >
            <RefreshCwIcon className={cn(busy && "animate-spin")} />
          </Button>
        </div>
      </div>
      {loadError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Run could not be loaded</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};
