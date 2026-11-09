// biome-ignore-all lint/suspicious/noConsole: command-line wrapper
// biome-ignore-all lint/style/noProcessEnv: command-line configuration
/**
 * Runs the Python side from the repo root with the project's interpreter, so
 * Turborepo can orchestrate it next to the Next.js app:
 *
 *   pnpm turbo test              vitest (panel) + pytest (backend)
 *   pnpm --filter backend bench -- --model qwen3-vl:2b
 *   pnpm --filter backend setup  create .venv and install the project
 *
 * Interpreter: PYTHON_BIN, else <repo>/.venv/bin/python, else python3.
 * When --needs <module> cannot be imported the script skips with exit 0 and a
 * hint, unless BACKEND_STRICT=1, so frontend-only checkouts keep passing.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const venvPython = path.join(repoRoot, ".venv", "bin", "python");
const python =
  process.env.PYTHON_BIN ?? (existsSync(venvPython) ? venvPython : "python3");

const argv = process.argv.slice(2);

if (argv[0] === "--setup") {
  const steps = [
    ["python3", ["-m", "venv", ".venv"]],
    [venvPython, ["-m", "pip", "install", "--upgrade", "pip"]],
    [
      venvPython,
      [
        "-m",
        "pip",
        "install",
        "-e",
        process.platform === "darwin"
          ? ".[dev,local-env,ocr]"
          : ".[dev,local-env]",
      ],
    ],
    [venvPython, ["-m", "playwright", "install", "chromium"]],
  ];
  for (const [bin, args] of steps) {
    console.log(`$ ${bin} ${args.join(" ")}`);
    const r = spawnSync(bin, args, { cwd: repoRoot, stdio: "inherit" });
    if (r.status !== 0) {
      process.exit(r.status ?? 1);
    }
  }
  console.log(
    "backend ready: .venv created, project (with the ocr extra on macOS) and Chromium installed"
  );
  process.exit(0);
}

let needs = null;
let rest = argv;
if (argv[0] === "--needs") {
  needs = argv[1];
  rest = argv.slice(2);
}
if (rest[0] === "--") {
  rest = rest.slice(1);
}

if (needs) {
  const probe = spawnSync(python, ["-c", `import ${needs}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (probe.status !== 0) {
    const msg = `backend: '${needs}' is not importable with ${python}; run \`pnpm --filter backend setup\` (or pip install -e ".[dev,local-env]" at the repo root)`;
    if (process.env.BACKEND_STRICT === "1") {
      console.error(msg);
      process.exit(1);
    }
    console.log(`${msg}. Skipping.`);
    process.exit(0);
  }
}

const r = spawnSync(python, rest, {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
});
process.exit(r.status ?? 1);
