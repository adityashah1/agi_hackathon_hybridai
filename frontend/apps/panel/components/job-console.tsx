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
import { cn } from "@repo/design-system/lib/utils";
import { PlayIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { JobRecord, StartJobRequest } from "@/lib/jobs";

export interface Launcher {
  /** Shown before launching when the job spends money or needs the user's go-ahead. */
  confirmText?: string;
  disabled?: boolean;
  disabledReason?: string;
  label: string;
  request: StartJobRequest;
}

interface JobConsoleProps {
  description?: string;
  initialJobs: JobRecord[];
  launchers: Launcher[];
  title?: string;
}

const POLL_MS = 1500;

const statusTone: Record<JobRecord["status"], string> = {
  running: "border-primary/60 text-primary",
  succeeded: "border-measured/60 text-measured",
  failed: "border-destructive/60 text-destructive",
  stopped: "border-gate-flush/60 text-gate-flush",
};

/**
 * Starts the Python entry points through /api/jobs and tails their output.
 * When a job ends, the page refreshes so files it wrote (bench.jsonl, screens,
 * steps.jsonl) show up without a manual reload.
 */
export const JobConsole = ({
  launchers,
  initialJobs,
  title = "Run the backend",
  description,
}: JobConsoleProps) => {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs);
  const [activeId, setActiveId] = useState<string | null>(
    initialJobs.find((j) => j.status === "running")?.id ??
      initialJobs[0]?.id ??
      null
  );
  const [lines, setLines] = useState<string[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<Launcher | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const active = jobs.find((j) => j.id === activeId) ?? null;

  // Load the full log when the active job changes.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(activeId)}?after=0`,
        { cache: "no-store" }
      );
      if (!res.ok || cancelled) {
        return;
      }
      const data = (await res.json()) as {
        job: JobRecord;
        log: { lines: string[] } | null;
      };
      setLines(data.log?.lines ?? []);
      setJobs((prev) => prev.map((j) => (j.id === data.job.id ? data.job : j)));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Tail while running.
  useEffect(() => {
    if (!(active && active.status === "running")) {
      return;
    }
    const id = active.id;
    const t = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(id)}?after=${lines.length}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as {
          job: JobRecord;
          log: { lines: string[] } | null;
        };
        if (data.log?.lines.length) {
          setLines((prev) => [...prev, ...(data.log?.lines ?? [])]);
        }
        setJobs((prev) =>
          prev.map((j) => (j.id === data.job.id ? data.job : j))
        );
        if (data.job.status !== "running") {
          toast[data.job.status === "succeeded" ? "success" : "error"](
            `${data.job.kind} ${data.job.status}`
          );
          router.refresh();
        }
      } catch {
        // transient
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [active, lines.length, router]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the log as lines arrive
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const launch = async (l: Launcher) => {
    setBusy(true);
    setPendingConfirm(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(l.request),
      });
      const data = (await res.json()) as JobRecord & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `launch failed (${res.status})`);
      }
      setJobs((prev) => [data, ...prev]);
      setLines([]);
      setActiveId(data.id);
      toast.success(`${data.kind} started`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!active) {
      return;
    }
    await fetch(`/api/jobs/${encodeURIComponent(active.id)}`, {
      method: "DELETE",
    });
    router.refresh();
  };

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TerminalIcon className="size-4" /> {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {launchers.map((l) => (
            <Button
              disabled={busy || l.disabled || active?.status === "running"}
              key={l.label}
              onClick={() => (l.confirmText ? setPendingConfirm(l) : launch(l))}
              size="sm"
              title={l.disabled ? l.disabledReason : undefined}
              variant="outline"
            >
              <PlayIcon /> {l.label}
            </Button>
          ))}
        </div>
        {pendingConfirm ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-gate-flush/50 bg-gate-flush/5 p-3 text-xs">
            <span className="flex-1">{pendingConfirm.confirmText}</span>
            <Button onClick={() => launch(pendingConfirm)} size="sm">
              Yes, run it
            </Button>
            <Button
              onClick={() => setPendingConfirm(null)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {jobs.length ? (
          <div className="flex flex-wrap gap-1">
            {jobs.slice(0, 8).map((j) => (
              <button
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-mono text-[10px]",
                  statusTone[j.status],
                  j.id === activeId && "bg-muted"
                )}
                key={j.id}
                onClick={() => setActiveId(j.id)}
                type="button"
              >
                {j.kind} · {j.status}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            No jobs launched from this panel yet.
          </p>
        )}
        {active ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                className={cn(
                  "font-mono text-[10px]",
                  statusTone[active.status]
                )}
                variant="outline"
              >
                {active.status}
              </Badge>
              <span className="truncate font-mono text-muted-foreground">
                {active.command.join(" ")}
              </span>
              {active.status === "running" ? (
                <Button
                  className="ml-auto"
                  onClick={stop}
                  size="sm"
                  variant="outline"
                >
                  <SquareIcon /> Stop
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">{active.note}</p>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-4">
              {lines.length ? lines.join("\n") : "(no output yet)"}
              <div ref={endRef} />
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
