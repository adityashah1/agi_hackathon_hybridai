import { RulerIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { ResultsView } from "@/components/results/results-view";
import { RunBar } from "@/components/run-bar";
import { failureClusters, routingMatrix, summarizeAll } from "@/lib/metrics";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";

export const metadata: Metadata = { title: "Results" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const ctx = await loadRunContext(searchParams);
  const hybridMode = ctx.hybridMode ?? "hybrid";
  return (
    <>
      <PageHeader
        description="Three questions, kept apart: did the job get done, what did it cost, and was each decision about where to run it the right one."
        step={4}
        title="Results"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Three questions, kept apart."
          detail="Did it work, what did it cost, were the routing calls right. Intelligence per watt-hour is extended from single questions to whole agent tasks. Every formula is on the methodology page."
          icon={RulerIcon}
        />
      </div>
      <ResultsView
        clusters={failureClusters(ctx.run.steps)}
        hybridMode={hybridMode}
        matrix={routingMatrix(ctx.run.steps, hybridMode)}
        summaries={summarizeAll(ctx.run.steps)}
      />
    </>
  );
};

export default Page;
