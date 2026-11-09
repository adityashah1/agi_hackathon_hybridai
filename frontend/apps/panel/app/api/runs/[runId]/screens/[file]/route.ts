import { readScreen } from "@/lib/data/source";

export const dynamic = "force-dynamic";

/** GET /api/runs/<runId>/screens/<file>.png → the PNG the env saved for that step. */
export const GET = async (
  _req: Request,
  ctx: { params: Promise<{ runId: string; file: string }> }
) => {
  const { runId, file } = await ctx.params;
  const buf = await readScreen(runId, file);
  if (!buf) {
    return new Response("not found", { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=60",
    },
  });
};
