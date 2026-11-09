import { NextResponse } from "next/server";
import { READ_ONLY_MESSAGE, readOnly } from "@/lib/backend";
import { JobError, listJobs, type StartJobRequest, startJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** GET /api/jobs → every job this server process has launched, newest first. */
export const GET = () => NextResponse.json({ jobs: listJobs() });

/** POST /api/jobs {kind, ...} → launch an allow-listed Python entry point. */
export const POST = async (req: Request) => {
  if (readOnly()) {
    return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  }
  let body: StartJobRequest;
  try {
    body = (await req.json()) as StartJobRequest;
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  if (!(body && typeof body === "object" && "kind" in body)) {
    return NextResponse.json({ error: "kind is required" }, { status: 400 });
  }
  try {
    const job = await startJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (e) {
    if (e instanceof JobError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
};
