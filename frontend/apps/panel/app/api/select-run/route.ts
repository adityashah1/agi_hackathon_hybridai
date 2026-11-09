import { NextResponse } from "next/server";
import { isSafeRunId, RUN_COOKIE } from "@/lib/run-cookie";

export const dynamic = "force-dynamic";

/** POST /api/select-run { run_id } → remembers the run in a cookie so every screen shows it. */
export const POST = async (req: Request) => {
  let body: { run_id?: unknown } = {};
  try {
    body = (await req.json()) as { run_id?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const id = body.run_id;
  if (typeof id !== "string" || !isSafeRunId(id)) {
    return NextResponse.json(
      { error: "run_id must be a plain identifier" },
      { status: 400 }
    );
  }
  const res = NextResponse.json({ ok: true, run_id: id });
  res.cookies.set(RUN_COOKIE, id, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
};
