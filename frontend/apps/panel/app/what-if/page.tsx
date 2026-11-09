import { SlidersHorizontalIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { RunBar } from "@/components/run-bar";
import { WhatIfView } from "@/components/what-if/what-if-view";
import { SAMPLE_GATE_THRESHOLD } from "@/lib/data/sample-run";
import { loadBenches } from "@/lib/data/source";
import { gateSweep, summarizeAll } from "@/lib/metrics";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";
import { gateThresholdFromName } from "@/lib/schema";

export const metadata: Metadata = { title: "What-if" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const [ctx, benches] = await Promise.all([
    loadRunContext(searchParams),
    loadBenches(),
  ]);
  const hybridMode = ctx.hybridMode ?? "hybrid";
  const gateName = ctx.run.steps.find(
    (s) => s.mode === hybridMode && s.gate_name
  )?.gate_name;
  const threshold = gateThresholdFromName(gateName) ?? SAMPLE_GATE_THRESHOLD;
  return (
    <>
      <PageHeader
        description="Replay the gate at other thresholds and on either confidence signal, swap the brain, compare hardware by memory, and read the deployment plan. Modeled numbers say so."
        step={5}
        title="What-if"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Tune before you spend."
          detail="The gate sweep replays your own logs for free, on sample agreement or on the decision-token log-prob the brain measures. Hardware is compared by memory capacity and bandwidth, not marketing TOPS."
          icon={SlidersHorizontalIcon}
        />
      </div>
      <WhatIfView
        benches={benches}
        currentThreshold={threshold}
        hybridMode={hybridMode}
        summaries={summarizeAll(ctx.run.steps)}
        sweep={gateSweep(ctx.run.steps, "agreement")}
        sweepLogprob={gateSweep(ctx.run.steps, "logprob")}
      />
    </>
  );
};

export default Page;
