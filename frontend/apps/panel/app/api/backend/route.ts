import { NextResponse } from "next/server";
import { getBackendStatus } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** GET /api/backend[?fresh=1] → what the Python side can do on this machine right now. */
export const GET = async (req: Request) => {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return NextResponse.json(await getBackendStatus(fresh));
};
