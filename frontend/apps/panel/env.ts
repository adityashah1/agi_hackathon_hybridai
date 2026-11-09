import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * The panel reads runs from data/runs/<run_id>/steps.jsonl at the repo root by
 * default and launches the Python entry points from that root. Every override
 * is optional; the defaults are right for a checkout of this repository.
 */
export const env = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    /** Folder holding run directories. Default: <repo>/data/runs. */
    RUNS_DIR: z.string().min(1).optional(),
    /** Repository root with brain/, env/, runner/, tasks/ and mock_apps/. Default: three levels up from apps/panel. */
    REPO_ROOT: z.string().min(1).optional(),
    /** Python interpreter for jobs. Default: <repo>/.venv/bin/python if present, else python3. */
    PYTHON_BIN: z.string().min(1).optional(),
    /** Port the static mock apps are served on. Default 8765, as in mock_apps/README.md. */
    MOCK_APPS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    /**
     * Where the agent reaches the mock apps; replaces {MOCK_BASE} in
     * tasks/tasks.yaml and is passed to every job. Default
     * http://localhost:<MOCK_APPS_PORT>. Set it to the GitHub Pages URL once
     * the apps are deployed: the Sai cloud computer cannot reach localhost.
     */
    MOCK_BASE: z.url().optional(),
  },
  client: {},
  runtimeEnv: {
    RUNS_DIR: process.env.RUNS_DIR,
    REPO_ROOT: process.env.REPO_ROOT,
    PYTHON_BIN: process.env.PYTHON_BIN,
    MOCK_APPS_PORT: process.env.MOCK_APPS_PORT,
    MOCK_BASE: process.env.MOCK_BASE,
  },
});
