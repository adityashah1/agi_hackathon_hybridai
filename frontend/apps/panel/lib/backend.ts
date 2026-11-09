import "server-only";

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/env";
import { MOCK_APPS_DEFAULT_PORT } from "./mock-apps";

/**
 * What the Python side of the monorepo can do right now, read from the
 * machine rather than assumed. The preflight and benchmarks screens show this
 * so nobody presses "Start run" against a runner that does not exist yet.
 */

const run = promisify(execFile);

export const repoRoot = (): string =>
  env.REPO_ROOT ?? path.resolve(process.cwd(), "../../..");

export const mockAppsPort = (): number =>
  env.MOCK_APPS_PORT ?? MOCK_APPS_DEFAULT_PORT;

const TRAILING_SLASH = /\/$/;

/**
 * Where the agent reaches the mock apps: MOCK_BASE if set (it fills
 * {MOCK_BASE} in tasks/tasks.yaml; the Sai cloud computer cannot reach
 * localhost), else this port on localhost. Passed to every job.
 */
/** PANEL_READ_ONLY=1: the hosted demo. POST routes that launch, upload or write refuse. */
export const readOnly = (): boolean => env.PANEL_READ_ONLY === "1";
export const READ_ONLY_MESSAGE =
  "This hosted copy is read-only: it has no Python backend, so job launches, uploads and spec writes are disabled. Run the panel locally for those.";

/** MOCK_BASE when it is set explicitly, for links that leave this host; else null. */
export const configuredMockBase = (): string | null =>
  env.MOCK_BASE ? env.MOCK_BASE.replace(TRAILING_SLASH, "") : null;

export const mockBase = (): string =>
  (env.MOCK_BASE ?? `http://localhost:${mockAppsPort()}`).replace(
    TRAILING_SLASH,
    ""
  );

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

export const pythonBin = async (): Promise<string> => {
  if (env.PYTHON_BIN) {
    return env.PYTHON_BIN;
  }
  const venv = path.join(repoRoot(), ".venv", "bin", "python");
  return (await exists(venv)) ? venv : "python3";
};

/** Modules the Python entry points import. Checked in one interpreter call. */
const DEPS = [
  "requests",
  "PIL",
  "dotenv",
  "numpy",
  "playwright",
  "pytest",
  "ruff",
] as const;
type Dep = (typeof DEPS)[number];

export interface BackendStatus {
  checkedAt: string;
  deps: Record<Dep, boolean>;
  lease: { present: boolean; status: string | null; machineId: string | null };
  /** The static mock apps the agent acts on, served by python -m http.server. */
  mockApps: { base: string; present: boolean; running: boolean; port: number };
  ollama: { running: boolean; version: string | null };
  python: { bin: string; version: string | null; ok: boolean };
  /** PANEL_READ_ONLY=1: launches, uploads and spec writes are refused. */
  readOnly: boolean;
  repoRoot: string;
  runDirs: number;
  /** runner/run.py exists, so "Start run" can launch it. */
  runner: boolean;
  saiKey: boolean;
}

const PROBE = `
import json, sys
mods = ${JSON.stringify([...DEPS])}
out = {"version": sys.version.split()[0], "deps": {}}
for m in mods:
    try:
        __import__(m)
        out["deps"][m] = True
    except Exception:
        out["deps"][m] = False
print(json.dumps(out))
`;

const probePython = async (
  bin: string
): Promise<{ version: string | null; deps: Record<Dep, boolean> }> => {
  const empty = Object.fromEntries(DEPS.map((d) => [d, false])) as Record<
    Dep,
    boolean
  >;
  try {
    const { stdout } = await run(bin, ["-I", "-c", PROBE], {
      cwd: repoRoot(),
      timeout: 15_000,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      version: string;
      deps: Record<string, boolean>;
    };
    return { version: parsed.version, deps: { ...empty, ...parsed.deps } };
  } catch {
    return { version: null, deps: empty };
  }
};

const fetchWithTimeout = async (
  url: string,
  ms: number
): Promise<Response | null> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
};

const probeOllama = async (): Promise<BackendStatus["ollama"]> => {
  const res = await fetchWithTimeout(
    "http://localhost:11434/api/version",
    1500
  );
  if (!res?.ok) {
    return { running: false, version: null };
  }
  try {
    const j = (await res.json()) as { version?: string };
    return { running: true, version: j.version ?? null };
  } catch {
    return { running: true, version: null };
  }
};

const probeMockApps = async (): Promise<BackendStatus["mockApps"]> => {
  const port = mockAppsPort();
  const base = mockBase();
  const [present, res] = await Promise.all([
    exists(path.join(repoRoot(), "mock_apps", "index.html")),
    fetchWithTimeout(`${base}/`, 1500),
  ]);
  return { present, running: !!res?.ok, port, base };
};

const SAI_KEY_LINE = /^\s*SAI_API_KEY\s*=\s*["']?[^"'\s#]+/m;

const probeSaiKey = async (): Promise<boolean> => {
  if (process.env.SAI_API_KEY) {
    return true;
  }
  try {
    const text = await readFile(path.join(repoRoot(), ".env"), "utf8");
    return SAI_KEY_LINE.test(text);
  } catch {
    return false;
  }
};

const probeLease = async (): Promise<BackendStatus["lease"]> => {
  try {
    const text = await readFile(
      path.join(repoRoot(), "data", "lease.json"),
      "utf8"
    );
    const j = JSON.parse(text) as { status?: string; machineId?: string };
    const mid = typeof j.machineId === "string" ? j.machineId : null;
    return {
      present: true,
      status: j.status ?? null,
      machineId: mid ? `${mid.slice(0, 8)}…` : null,
    };
  } catch {
    return { present: false, status: null, machineId: null };
  }
};

const countRunDirs = async (): Promise<number> => {
  try {
    const entries = await readdir(path.join(repoRoot(), "data", "runs"));
    return entries.filter((e) => !e.startsWith(".")).length;
  } catch {
    return 0;
  }
};

let cached: { at: number; status: BackendStatus } | null = null;
const CACHE_MS = 5000;

export const getBackendStatus = async (
  fresh = false
): Promise<BackendStatus> => {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.status;
  }
  const bin = await pythonBin();
  const [py, runner, ollama, saiKey, lease, mockApps, runDirs] =
    await Promise.all([
      probePython(bin),
      exists(path.join(repoRoot(), "runner", "run.py")),
      probeOllama(),
      probeSaiKey(),
      probeLease(),
      probeMockApps(),
      countRunDirs(),
    ]);
  const status: BackendStatus = {
    checkedAt: new Date().toISOString(),
    readOnly: readOnly(),
    repoRoot: repoRoot(),
    python: { bin, version: py.version, ok: py.version !== null },
    deps: py.deps,
    runner,
    ollama,
    saiKey,
    lease,
    mockApps,
    runDirs,
  };
  cached = { at: Date.now(), status };
  return status;
};
