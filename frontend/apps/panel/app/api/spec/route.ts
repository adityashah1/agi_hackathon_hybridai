import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { READ_ONLY_MESSAGE, readOnly, repoRoot } from "@/lib/backend";
import { isSafeRunId } from "@/lib/run-cookie";

export const dynamic = "force-dynamic";

/** The intake's spec card, as the runner reads it from tasks/<spec_id>.json. */
const TaskSpecSchema = z.object({
  spec_id: z.string().refine(isSafeRunId, "spec_id must be a plain identifier"),
  created_at: z.string(),
  workflow: z.string(),
  app: z.string(),
  success_criteria: z.string(),
  sensitivity: z.enum(["none", "low_pii", "high_pii", "injection_prone"]),
  daily_volume: z.number().int().nonnegative(),
  preference: z.enum(["cheapest", "balanced", "fastest"]),
  escalation_targets: z.array(z.enum(["sai", "deskside_open_model", "none"])),
  task_ids: z.array(z.string().min(1)).min(1),
  modes: z.array(z.string().min(1)).min(1),
  seeds: z.number().int().min(1).max(5),
});

const tasksDir = () => path.join(repoRoot(), "tasks");
const JSON_FILE = /\.json$/;

/** GET /api/spec → spec ids saved under tasks/. */
export const GET = async () => {
  try {
    const files = await readdir(tasksDir());
    const specs = files
      .filter((f) => JSON_FILE.test(f))
      .map((f) => f.replace(JSON_FILE, ""));
    return NextResponse.json({ specs, dir: tasksDir() });
  } catch {
    return NextResponse.json({ specs: [], dir: tasksDir() });
  }
};

/** POST /api/spec {spec} → writes tasks/<spec_id>.json for the Python runner. */
export const POST = async (req: Request) => {
  if (readOnly()) {
    return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const parsed = TaskSpecSchema.safeParse(body);
  if (!parsed.success) {
    const why = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      { error: `invalid spec: ${why}` },
      { status: 400 }
    );
  }
  const spec = parsed.data;
  await mkdir(tasksDir(), { recursive: true });
  const file = path.join(tasksDir(), `${spec.spec_id}.json`);
  await writeFile(file, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  const saved = await readFile(file, "utf8");
  return NextResponse.json({
    spec_id: spec.spec_id,
    path: file,
    bytes: saved.length,
  });
};
