import { NextResponse } from "next/server";
import { getJob, readJobLog, stopJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

/** GET /api/jobs/<id>?after=<n> → job record plus log lines after position n. */
export const GET = async (req: Request, ctx: Ctx) => {
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  const after = Number.parseInt(
    new URL(req.url).searchParams.get("after") ?? "0",
    10
  );
  const log = readJobLog(jobId, Number.isFinite(after) ? after : 0);
  return NextResponse.json({ job, log });
};

/** DELETE /api/jobs/<id> → SIGTERM a running job. */
export const DELETE = async (_req: Request, ctx: Ctx) => {
  const { jobId } = await ctx.params;
  const job = stopJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  return NextResponse.json({ job });
};
