import { MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import { Differentiator } from "@/components/differentiator";
import { IntakeChat } from "@/components/intake/intake-chat";
import { PageHeader } from "@/components/page-header";
import { RunBar } from "@/components/run-bar";
import {
  loadRunContext,
  runBarProps,
  type SearchParams,
} from "@/lib/run-context";

export const metadata: Metadata = { title: "Intake" };

const Page = async ({ searchParams }: { searchParams: SearchParams }) => {
  const ctx = await loadRunContext(searchParams);
  return (
    <>
      <PageHeader
        description="Five questions. The answers become a spec card the runner can read. Nothing else is kept."
        step={1}
        title="Intake"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <RunBar {...runBarProps(ctx)} />
        <Differentiator
          claim="Five questions, no model in the loop."
          detail="Your answers become a spec card the runner reads. Nothing else from the chat is stored, so the local vision model keeps the only model slot this Mac has."
          icon={MessageSquareIcon}
        />
      </div>
      <IntakeChat />
    </>
  );
};

export default Page;
