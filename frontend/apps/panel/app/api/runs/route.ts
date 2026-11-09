import { NextResponse } from "next/server";
import { READ_ONLY_MESSAGE, readOnly } from "@/lib/backend";
import { listRuns, saveUploadedRun } from "@/lib/data/source";
import { isSafeRunId } from "@/lib/run-cookie";

export const dynamic = "force-dynamic";

const LINE_BREAK = /\r?\n/;
const UNSAFE_CHARS = /[^A-Za-z0-9_.-]/g;
const LEADING_JUNK = /^[^A-Za-z0-9]+/;
const JSONL_EXT = /\.jsonl?$/i;

/** GET /api/runs → every run the panel can show. */
export const GET = async () => NextResponse.json({ runs: await listRuns() });

const idFromFirstLine = (text: string): string | undefined => {
  const first = text.split(LINE_BREAK).find((l) => l.trim());
  if (!first) {
    return undefined;
  }
  try {
    const obj = JSON.parse(first) as { run_id?: unknown };
    return typeof obj.run_id === "string" ? obj.run_id : undefined;
  } catch {
    return undefined;
  }
};

const sanitize = (raw: string) =>
  raw.replace(UNSAFE_CHARS, "-").replace(LEADING_JUNK, "").slice(0, 100);

/**
 * POST /api/runs with multipart form data: `file` = steps.jsonl, optional `run_id`.
 * Saves to data/runs/<run_id>/steps.jsonl after checking at least one line parses.
 */
export const POST = async (req: Request) => {
  if (readOnly()) {
    return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "form field `file` must be a file" },
      { status: 400 }
    );
  }
  const text = await file.text();
  const requested = form.get("run_id");
  let id =
    typeof requested === "string" && requested.trim() ? requested.trim() : "";
  if (!id) {
    id = idFromFirstLine(text) ?? file.name.replace(JSONL_EXT, "");
  }
  id = sanitize(id);
  if (!(id && isSafeRunId(id))) {
    id = `run_${Date.now()}`;
  }
  try {
    const saved = await saveUploadedRun(id, text);
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
};
