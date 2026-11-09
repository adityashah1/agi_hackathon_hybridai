import { HandCoinsIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { PageHeader } from "@/components/page-header";
import { PreflightView } from "@/components/preflight/preflight-view";
import { RunBar } from "@/components/run-bar";
import { getBackendStatus } from "@/lib/backend";
import { summarizeAll } from "@/lib/metrics";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";

export const metadata: Metadata = { title: "Preflight" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const [ctx, backend] = await Promise.all([
    loadRunContext(searchParams),
    getBackendStatus(),
  ]);
  return (
    <>
      <PageHeader
        description="The estimate and the result share one card. Badges flip from modeled to measured when the run lands."
        step={2}
        title="Preflight"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Nothing spends until you say so."
          detail="The estimate you confirm here is the card you get back after the run, with every badge flipped from modeled to measured. Start run saves the spec to tasks/ and launches the Python runner from this screen."
          icon={HandCoinsIcon}
        />
      </div>
      <PreflightView
        backend={backend}
        summaries={summarizeAll(ctx.run.steps)}
      />
    </>
  );
};

export default Page;
