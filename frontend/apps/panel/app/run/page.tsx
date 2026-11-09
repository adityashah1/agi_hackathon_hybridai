import { RouteIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { LivePanel } from "@/components/run/live-panel";
import { RunBar } from "@/components/run-bar";
import { SAMPLE_GATE_THRESHOLD } from "@/lib/data/sample-run";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";

export const metadata: Metadata = { title: "Live run" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const ctx = await loadRunContext(searchParams);
  const isSample = ctx.run.source === "sample";
  return (
    <>
      <PageHeader
        description="One row per step as it lands in steps.jsonl: what the local model proposed and why, how sure it was, what the gate decided, who ran it, and what it cost."
        step={3}
        title="Live run"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Where did it run and why, every step."
          detail="Most agent demos show the result. This shows the proposal with the brain's own reason, the confidence, the gate's decision, who executed, the real screenshot, and what that one step cost. On a real run it tails the log while the runner writes it."
          icon={RouteIcon}
        />
      </div>
      <LivePanel
        defaultMode={ctx.hybridMode}
        fallbackThreshold={SAMPLE_GATE_THRESHOLD}
        key={ctx.run.run_id}
        live={!isSample}
        replayByDefault={isSample}
        runId={ctx.run.run_id}
        screensBase={ctx.screensBase}
        steps={ctx.run.steps}
      />
    </>
  );
};

export default Page;
