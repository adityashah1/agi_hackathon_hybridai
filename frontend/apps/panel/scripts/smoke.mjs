// biome-ignore-all lint/suspicious/noConsole: command-line report
// biome-ignore-all lint/style/noProcessEnv: command-line configuration
// biome-ignore-all lint/performance/useTopLevelRegex: regexes run inside page.evaluate, which serializes the function
/**
 * Pre-demo smoke test. Drives the installed Chrome against a running panel and
 * checks what a screenshot cannot: that client code hydrated, the replay runs,
 * selects and charts render, and nothing logged an error.
 *
 *   pnpm --filter panel smoke            # against http://localhost:3000
 *   BASE=http://host:3000 pnpm --filter panel smoke
 *   CHROME_PATH=/path/to/chrome ...      # if Chrome is not in the default macOS location
 */
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? "http://localhost:3000";
const WAIT_MS = Number(process.env.WAIT_MS ?? 6000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (msg) => failures.push(msg);

const open = async (browser, path) => {
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      logs.push(`console.error: ${m.text().slice(0, 240)}`);
    }
  });
  page.on("pageerror", (e) =>
    logs.push(`pageerror: ${String(e).slice(0, 240)}`)
  );
  // Next cancels stale prefetches itself (net::ERR_ABORTED); only real failures count.
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "";
    if (reason !== "net::ERR_ABORTED") {
      logs.push(`requestfailed: ${reason} ${r.url()}`);
    }
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60_000 });
  await sleep(WAIT_MS);
  return { page, logs };
};

const report = (path, ok, detail) =>
  console.log(`${ok ? "ok  " : "FAIL"} ${path}  ${detail}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu"],
});

try {
  {
    const { page, logs } = await open(browser, "/run");
    const r = await page.evaluate(() => {
      const text = document.body.innerText;
      const progress = text.match(/(\d+) \/ (\d+)/);
      return {
        shown: progress ? Number(progress[1]) : -1,
        total: progress ? Number(progress[2]) : -1,
        selectValue:
          document
            .querySelector('[data-slot="select-value"]')
            ?.textContent?.trim() ?? "",
      };
    });
    const advanced = r.shown > 0 || r.total === 0;
    report(
      "/run",
      advanced && r.selectValue !== "",
      `replay ${r.shown}/${r.total}, run picker "${r.selectValue}"`
    );
    if (!advanced) {
      fail("/run: replay did not advance, client code may not have hydrated");
    }
    if (r.selectValue === "") {
      fail("/run: run picker shows no value");
    }
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Show all"
      );
      if (!btn) {
        return false;
      }
      btn.click();
      return true;
    });
    await sleep(800);
    const after = await page.evaluate(
      () => (document.body.innerText.match(/(\d+) \/ (\d+)/) ?? [])[0] ?? ""
    );
    report(
      "/run click",
      clicked && /^(\d+) \/ \1$/.test(after),
      `after "Show all": ${after}`
    );
    if (!(clicked && /^(\d+) \/ \1$/.test(after))) {
      fail("/run: Show all did not reveal every step");
    }
    for (const l of logs) {
      fail(`/run: ${l}`);
    }
    await page.close();
  }

  {
    const { page, logs } = await open(browser, "/what-if");
    const r = await page.evaluate(() => ({
      selects: [...document.querySelectorAll('[data-slot="select-value"]')].map(
        (n) => n.textContent?.trim() ?? ""
      ),
      charts: document.querySelectorAll("svg.recharts-surface").length,
      sliders: document.querySelectorAll('[role="slider"]').length,
    }));
    const ok =
      r.selects.length >= 3 &&
      r.selects.every(Boolean) &&
      r.charts >= 1 &&
      r.sliders >= 1;
    report(
      "/what-if",
      ok,
      `${r.selects.length} selects filled, ${r.charts} chart, ${r.sliders} slider`
    );
    if (!ok) {
      fail("/what-if: selects, chart or slider missing");
    }
    for (const l of logs) {
      fail(`/what-if: ${l}`);
    }
    await page.close();
  }

  {
    const { page, logs } = await open(browser, "/results");
    const r = await page.evaluate(() => ({
      bars: document.querySelectorAll(".recharts-bar-rectangle").length,
      tabs: document.querySelectorAll('[role="tab"]').length,
    }));
    const ok = r.bars >= 1 && r.tabs === 3;
    report("/results", ok, `${r.bars} bars, ${r.tabs} tabs`);
    if (!ok) {
      fail("/results: chart bars or tabs missing");
    }
    for (const l of logs) {
      fail(`/results: ${l}`);
    }
    await page.close();
  }

  for (const path of [
    "/",
    "/intake",
    "/preflight",
    "/boundary",
    "/methodology",
    "/benchmarks",
  ]) {
    const { page, logs } = await open(browser, path);
    const title = await page.title();
    report(path, logs.length === 0, `title "${title}"`);
    for (const l of logs) {
      fail(`${path}: ${l}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(
    `\n${failures.length} problem${failures.length === 1 ? "" : "s"}:`
  );
  for (const f of failures) {
    console.log(`- ${f}`);
  }
  process.exit(1);
}
console.log("\nall smoke checks passed");
