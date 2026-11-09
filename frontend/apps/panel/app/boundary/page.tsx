import { ScanEyeIcon } from "lucide-react";
import type { Metadata } from "next";
import { BoundaryView } from "@/components/boundary/boundary-view";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { RunBar } from "@/components/run-bar";
import { boundaryRows, routingMatrix, summarizeAll } from "@/lib/metrics";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";

export const metadata: Metadata = { title: "Boundary & report" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const ctx = await loadRunContext(searchParams);
  const hybridMode = ctx.hybridMode ?? "hybrid";
  return (
    <>
      <PageHeader
        description="What reached the cloud, screen by screen, with the fake PII it carried. Then export the whole run."
        step={6}
        title="Boundary & report"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Exactly what left your machine."
          detail="The actual screenshots that crossed, the tokens and the fake personal data they carried, plus a report and the raw step traces you can hand to anyone."
          icon={ScanEyeIcon}
        />
      </div>
      <BoundaryView
        hybridMode={hybridMode}
        matrix={routingMatrix(ctx.run.steps, hybridMode)}
        rows={boundaryRows(ctx.run.steps)}
        runId={ctx.run.run_id}
        screensBase={ctx.screensBase}
        steps={ctx.run.steps}
        summaries={summarizeAll(ctx.run.steps)}
      />
    </>
  );
};

export default Page;
