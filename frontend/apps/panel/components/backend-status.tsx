// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one strip, one chip per prerequisite
"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/design-system/components/ui/popover";
import { cn } from "@repo/design-system/lib/utils";
import { CheckIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { BackendStatus as Status } from "@/lib/backend";

const Chip = ({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]",
          ok
            ? "border-measured/60 text-measured"
            : "border-destructive/50 text-destructive"
        )}
        type="button"
      >
        {ok ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
        {label}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 text-xs">
      {detail}
    </PopoverContent>
  </Popover>
);

const mockAppsDetail = (status: Status): string => {
  if (status.mockApps.running) {
    return `The mock apps (Inbox, Vendor Portal, Settings) answer at ${status.mockApps.base}/. Jobs receive that address as MOCK_BASE.`;
  }
  if (status.mockApps.present) {
    return `mock_apps/ is in the repo but nothing serves it. From the repo root: python -m http.server ${status.mockApps.port} -d mock_apps, or press Serve mock apps on the Benchmarks screen.`;
  }
  return "mock_apps/ is missing from this checkout. Pull the latest main.";
};

/**
 * What the Python side can do on this machine, probed live. Every chip opens
 * the exact command that fixes it, so a red chip is a to-do, not a mystery.
 */
export const BackendStatus = ({ initial }: { initial: Status }) => {
  const [status, setStatus] = useState<Status>(initial);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/backend?fresh=1", { cache: "no-store" });
      if (res.ok) {
        setStatus((await res.json()) as Status);
      }
    } finally {
      setBusy(false);
    }
  };

  const missingDeps = (Object.entries(status.deps) as [string, boolean][])
    .filter(([, ok]) => !ok)
    .map(([d]) => d);
  const coreDeps = ["requests", "PIL", "dotenv", "numpy"].every(
    (d) => status.deps[d as keyof Status["deps"]]
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <span className="mr-1 font-medium text-xs">Backend on this machine</span>
      <Chip
        detail={
          status.python.ok
            ? `${status.python.bin} is Python ${status.python.version}. Set PYTHON_BIN in apps/panel/.env.local to use another interpreter.`
            : `${status.python.bin} did not run. Install Python 3.11+ or set PYTHON_BIN.`
        }
        label={status.python.ok ? `Python ${status.python.version}` : "Python"}
        ok={status.python.ok}
      />
      <Chip
        detail={
          coreDeps
            ? `Core imports work.${missingDeps.length ? ` Optional missing: ${missingDeps.join(", ")}.` : ""}`
            : `Missing: ${missingDeps.join(", ")}. From the repo root: python3 -m venv .venv && .venv/bin/pip install -e ".[dev,local-env]" && .venv/bin/python -m playwright install chromium`
        }
        label="Python deps"
        ok={coreDeps}
      />
      <Chip
        detail={
          status.runner
            ? "runner/run.py is present. Start run on the preflight screen launches it."
            : "runner/run.py is not in the repo yet. The panel expects: python -m runner.run --spec tasks/<spec_id>.json --run-id <run_id> --modes a,b --seeds n, writing data/runs/<run_id>/steps.jsonl one StepRecord per line."
        }
        label="runner.run"
        ok={status.runner}
      />
      <Chip
        detail={
          status.ollama.running
            ? `Ollama ${status.ollama.version ?? ""} is serving on :11434.`
            : "Ollama is not running. In another terminal: OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve"
        }
        label={
          status.ollama.running
            ? `Ollama ${status.ollama.version ?? ""}`.trim()
            : "Ollama"
        }
        ok={status.ollama.running}
      />
      <Chip
        detail={
          status.saiKey
            ? "SAI_API_KEY is set in .env."
            : "No SAI_API_KEY in .env at the repo root. Copy .env.example to .env and fill it in. Local-only runs and the local smoke test work without it."
        }
        label="Sai key"
        ok={status.saiKey}
      />
      <Chip
        detail={
          status.lease.present
            ? `data/lease.json present${status.lease.status ? `, status ${status.lease.status}` : ""}${status.lease.machineId ? `, machine ${status.lease.machineId}` : ""}. The panel never closes it.`
            : "No data/lease.json yet. The first Sai smoke test opens a lease and saves it there; it is reused afterwards."
        }
        label="Sai lease"
        ok={status.lease.present}
      />
      <Chip
        detail={mockAppsDetail(status)}
        label={`Mock apps :${status.mockApps.port}`}
        ok={status.mockApps.running}
      />
      <Badge className="font-mono text-[10px]" variant="outline">
        {status.runDirs} run dir{status.runDirs === 1 ? "" : "s"}
      </Badge>
      <Button
        className="ml-auto"
        disabled={busy}
        onClick={refresh}
        size="icon-sm"
        title="Probe again"
        variant="ghost"
      >
        <RefreshCwIcon className={cn(busy && "animate-spin")} />
      </Button>
    </div>
  );
};
