import { NextResponse } from "next/server";
import { readStepsAfter } from "@/lib/data/source";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/<runId>/steps?after=<n> → steps appended after position n.
 * The live panel polls this to tail a steps.jsonl the runner is still writing.
 */
export const GET = async (
  req: Request,
  ctx: { params: Promise<{ runId: string }> }
) => {
  const { runId } = await ctx.params;
  const afterRaw = new URL(req.url).searchParams.get("after");
  const after = Number.parseInt(afterRaw ?? "0", 10);
  try {
    const result = await readStepsAfter(
      runId,
      Number.isFinite(after) ? after : 0
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 }
    );
  }
};
