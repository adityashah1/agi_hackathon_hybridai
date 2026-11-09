import "server-only";

import { cookies } from "next/headers";
import { SAMPLE_RUN } from "./data/sample-run";
import {
  getRun,
  type LoadedRun,
  listRuns,
  type RunSummary,
} from "./data/source";
import { RUN_COOKIE } from "./run-cookie";
import { orderModes, pickHybridMode } from "./schema";

export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export interface RunContext {
  /** The mode that plays the gate in this run, if any. */
  hybridMode: string | undefined;
  loadError: string | null;
  run: LoadedRun;
  runs: RunSummary[];
  /** Base URL for real screenshots, or null when the run has none on disk. */
  screensBase: string | null;
}

/**
 * Which run is the panel showing? `?run=<id>` wins, then the cookie, then the
 * sample. A run that fails to load falls back to the sample with the error kept,
 * so a bad file never blanks a screen.
 */
export const loadRunContext = async (
  searchParams?: SearchParams
): Promise<RunContext> => {
  const sp = searchParams ? await searchParams : {};
  const fromQuery = typeof sp.run === "string" ? sp.run : undefined;
  const jar = await cookies();
  const wanted = fromQuery ?? jar.get(RUN_COOKIE)?.value ?? SAMPLE_RUN.run_id;
  const runs = await listRuns();

  let run: LoadedRun;
  let loadError: string | null = null;
  try {
    run = await getRun(wanted);
  } catch (e) {
    run = await getRun(SAMPLE_RUN.run_id);
    loadError = `Could not load run "${wanted}": ${e instanceof Error ? e.message : String(e)}. Showing the sample run instead.`;
  }

  const hybridMode = pickHybridMode(orderModes(run.steps.map((s) => s.mode)));
  const screensBase = run.screens.available
    ? `/api/runs/${encodeURIComponent(run.run_id)}/screens`
    : null;
  return { run, runs, hybridMode, loadError, screensBase };
};

/** Serializable slice of the context for the client-side run bar. */
export const runBarProps = (ctx: RunContext) => ({
  runs: ctx.runs,
  current: {
    run_id: ctx.run.run_id,
    source: ctx.run.source,
    step_count: ctx.run.steps.length,
    path: ctx.run.path ?? null,
  },
  health: ctx.run.health,
  parse: ctx.run.parse,
  calls: ctx.run.calls,
  screens: ctx.run.screens,
  loadError: ctx.loadError,
});
