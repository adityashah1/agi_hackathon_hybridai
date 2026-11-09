// biome-ignore-all lint/suspicious/noConsole: command-line report
// biome-ignore-all lint/style/noProcessEnv: command-line configuration
// biome-ignore-all lint/performance/useTopLevelRegex: checks run once per element
// biome-ignore-all lint/suspicious/noBitwiseOperators: FNV-1a hash mirrors mock_apps/shared/hg.js
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one linear walk through five tasks
/**
 * Walks tasks T1 to T5 of tasks/tasks.yaml through the real mock apps at
 * 1024×768 and checks the CONFIRM codes the apps print against the codes in
 * the YAML. Prints the measured box of every element the panel's sample
 * scripts target, which is where lib/data/mock-app-geometry.ts comes from.
 *
 *   python -m http.server 8765 -d mock_apps      (or Serve mock apps on /benchmarks)
 *   pnpm --filter panel scenario                  # against http://localhost:8765
 *   MOCK_BASE=http://host:8765 pnpm --filter panel scenario
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.MOCK_BASE ?? "http://localhost:8765").replace(
  /\/$/,
  ""
);
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const fnv = (s) => {
  let h = 0x81_1c_9d_c5;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h >>> 0;
};
const code = (kind, parts) =>
  fnv([kind, ...parts].join("|"))
    .toString(36)
    .toUpperCase()
    .padStart(7, "0");
const normalizeReply = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!\s]+$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** tasks/tasks.yaml success rules for the mock-app tasks. */
const EXPECTED = {
  T1: code("reply", ["e01", "case", "INV-2207", "L2"]),
  T2: code("settings", [
    "+14155550199",
    "1",
    "1",
    "30",
    "0",
    "200 Example Street, Suite 4, Springfield",
  ]),
  T3: code("dispute", ["INV-2207", "L2", "2026-11-03"]),
  T4: code("settings", [
    "+14155550100",
    "1",
    "0",
    "30",
    "0",
    "88 Harbor Way, Suite 12, Springfield",
  ]),
  T5: code("reply", ["e08", normalizeReply("Thursday at 12:30 works for me.")]),
};

const results = [];
const centers = {};
const check = (name, ok, detail = "") =>
  results.push({ name, ok, detail: String(detail).slice(0, 100) });
const measure = async (page, selector, label = selector) => {
  centers[label] = await page
    .$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    })
    .catch(() => null);
};
const measureAll = async (page, selectors) => {
  for (const s of selectors) {
    await measure(page, s);
  }
};
const confirm = (page) =>
  page.$eval("#confirm-code", (el) => el.innerText).catch(() => "");
const expectConfirm = async (page, task) => {
  const got = await confirm(page);
  check(
    `${task}: CONFIRM ${EXPECTED[task]}`,
    got === `CONFIRM: ${EXPECTED[task]}`,
    got
  );
};

const walkDispute = async (page) => {
  await page.click("#nav-dispute");
  await page.waitForSelector("#invoice");
  await measure(page, "#invoice");
  await page.select("#invoice", "INV-2207");
  await measure(page, "#next-1");
  await page.click("#next-1");
  await page.waitForSelector("#step-2:not([hidden])");
  await measure(page, "#line-item");
  await page.select("#line-item", "L2");
  await measure(page, "#next-2");
  await page.click("#next-2");
  await page.waitForSelector("#step-3:not([hidden])");
  await measure(page, "#cal-next");
  await page.click("#cal-next");
  await measure(page, "#day-2026-11-03");
  await page.click("#day-2026-11-03");
  await measure(page, "#next-3");
  await page.click("#next-3");
  await page.waitForSelector("#step-4:not([hidden])");
  await measureAll(page, ["#reason", "#submit-dispute"]);
  await page.type(
    "#reason",
    "Invoiced 25 boxes of Size L gloves; PO-881 ordered 20."
  );
  await page.click("#submit-dispute");
  await page.waitForSelector("#step-done:not([hidden])");
  return page.$eval("#case-number", (el) => el.innerText);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Inbox geometry. The search box shifts every row down.
  await page.goto(`${BASE}/inbox/?reset`, { waitUntil: "load" });
  await measureAll(page, [
    "#search",
    "#msg-e01",
    "#msg-e04",
    "#msg-e07",
    "#msg-e08",
  ]);
  await page.click("#msg-e01");
  await page.waitForSelector("#link-portal");
  await measureAll(page, [
    "#btn-reply",
    "#btn-archive",
    "#link-portal",
    "#inv2207-L2",
  ]);
  check(
    "inbox: the Acme email links to the portal",
    (await page.$eval("#link-portal", (el) => el.getAttribute("href"))) ===
      "../vendor/"
  );
  await page.click("#btn-reply");
  await page.waitForSelector("#reply-body");
  await measureAll(page, ["#reply-body", "#btn-send"]);

  // T3: dispute with the modal; also the middle of T1.
  await page.goto(`${BASE}/vendor/?reset`, { waitUntil: "load" });
  await measureAll(page, [
    "#nav-pos",
    "#nav-invoices",
    "#nav-dispute",
    "#feedback",
    "#send-feedback",
  ]);
  await page.click("#nav-pos");
  await page.waitForSelector("#po-list");
  const modal = await page.$("#rating-modal");
  check("T3: rating modal on the 2nd portal page", Boolean(modal));
  if (modal) {
    await measure(page, "#rating-later");
    await page.click("#rating-later");
  }
  await measure(page, "#po-link-PO-881");
  await page.click("#po-link-PO-881");
  await page.waitForSelector("#po-PO-881-L2");
  await page.click("#nav-invoices");
  await page.waitForSelector("#inv-list");
  await measure(page, "#inv-link-INV-2207");
  await page.click("#inv-link-INV-2207");
  await page.waitForSelector("#inv-INV-2207-L2");
  check(
    "T3: INV-2207 line L2 bills 25",
    /\b25\b/.test(await page.$eval("#inv-INV-2207-L2", (el) => el.innerText))
  );
  const caseNo = await walkDispute(page);
  check("T3: case number assigned", /^CASE-\d{4}$/.test(caseNo), caseNo);
  await expectConfirm(page, "T3");

  // T1 ending: reply quoting the real case number.
  await page.goto(`${BASE}/inbox/#/m/e01/reply`, { waitUntil: "load" });
  await page.waitForSelector("#reply-body");
  await page.type(
    "#reply-body",
    `We opened dispute ${caseNo} for line L2 of INV-2207 (Size L gloves, 25 billed vs 20 ordered).`
  );
  await page.click("#btn-send");
  await sleep(150);
  await expectConfirm(page, "T1");

  // T5: search ramen, open e08, reply with the exact phrase.
  await page.goto(`${BASE}/inbox/?reset`, { waitUntil: "load" });
  await page.type("#search", "ramen");
  await sleep(100);
  const remaining = await page.$$eval("#list li", (els) => els.length);
  check(
    "T5: searching 'ramen' leaves one email",
    remaining === 1,
    String(remaining)
  );
  await measure(page, "#msg-e08", "#msg-e08:after-search");
  await page.click("#msg-e08");
  await page.waitForSelector("#btn-reply");
  await page.click("#btn-reply");
  await page.waitForSelector("#reply-body");
  await page.type("#reply-body", "Thursday at 12:30 works for me.");
  await page.click("#btn-send");
  await sleep(150);
  await expectConfirm(page, "T5");

  // T2: phone in international format plus SMS alerts.
  await page.goto(`${BASE}/settings/?reset`, { waitUntil: "load" });
  await measureAll(page, [
    "#tab-profile",
    "#tab-notifications",
    "#tab-billing",
    "#tab-security",
  ]);
  await page.click("#tab-billing");
  await page.waitForSelector("#sec-billing:not([hidden])");
  await measureAll(page, [
    "#billing-phone",
    "#clear-billing-phone",
    "#billing-address",
    "#clear-billing-address",
    "#save-settings",
  ]);
  check(
    "T2: default phone is +14155550100",
    (await page.$eval("#billing-phone", (el) => el.value)) === "+14155550100"
  );
  await page.click("#clear-billing-phone");
  await page.type("#billing-phone", "+14155550199");
  await page.click("#tab-notifications");
  await page.waitForSelector("#sec-notifications:not([hidden])");
  await measureAll(page, ["#notif-digest", "#notif-sms", "#notif-invoice"]);
  await page.click("#notif-sms");
  await page.click("#save-settings");
  await sleep(150);
  await expectConfirm(page, "T2");

  // T4: the new billing address from e07.
  await page.goto(`${BASE}/inbox/?reset`, { waitUntil: "load" });
  await page.click("#msg-e07");
  await page.waitForSelector("#new-billing-address");
  const address = await page.$eval(
    "#new-billing-address",
    (el) => el.innerText
  );
  check(
    "T4: the Finance Ops email carries the new address",
    address === "88 Harbor Way, Suite 12, Springfield",
    address
  );
  await page.goto(`${BASE}/settings/?reset`, { waitUntil: "load" });
  await page.click("#tab-billing");
  await page.waitForSelector("#sec-billing:not([hidden])");
  await page.click("#clear-billing-address");
  await page.type("#billing-address", address);
  await page.click("#save-settings");
  await sleep(150);
  await expectConfirm(page, "T4");

  // The phone error moves the save button.
  await page.goto(`${BASE}/settings/?reset`, { waitUntil: "load" });
  await page.click("#tab-billing");
  await page.waitForSelector("#sec-billing:not([hidden])");
  await page.click("#clear-billing-phone");
  await page.type("#billing-phone", "415-555-0123");
  await page.click("#save-settings");
  await sleep(100);
  check(
    "settings: the natural phone format is rejected",
    (await page.$eval("#phone-error", (el) => el.innerText)).includes(
      "Invalid phone"
    )
  );
  await measure(page, "#save-settings", "#save-settings:after-error");

  check("no JS errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(
    `${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? `  · ${r.detail}` : ""}`
  );
}
console.log(`GEOMETRY_JSON ${JSON.stringify(centers)}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} FAILED` : "ALL PASSED");
process.exit(failed.length ? 1 : 0);
