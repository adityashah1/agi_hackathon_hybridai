/* hybrid-gate mock apps: shared event log + confirmation code.
 *
 * - A fixed bar at the bottom of every page shows "last_event: ..." and updates on every
 *   click, input/change, and navigation (page load, hash change, HG.nav()).
 * - HG.confirm(kind, parts) shows "CONFIRM: <code>" in a tiny low-contrast corner area
 *   (easy to miss for a person, visible in screenshots). The code is deterministic:
 *   code = base36(FNV-1a-32(kind + "|" + parts.join("|"))), so graders can recompute it
 *   (Python version in mock_apps/README.md).
 * - Everything is also kept in window.__events / window.__confirm for programmatic checks.
 * - Add ?reset to any URL to clear this tab's mock state (page-visit counters etc.).
 */
(function () {
  "use strict";
  if (new URLSearchParams(location.search).has("reset")) {
    try { sessionStorage.clear(); } catch (e) {}
  }

  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function code(kind, parts) {
    return fnv1a([kind].concat(parts || []).join("|")).toString(36).toUpperCase().padStart(7, "0");
  }

  function describe(el) {
    if (!el || el === document || el === document.body) return "body";
    const target = el.closest(
      "button,a,input,select,textarea,label,[data-ev],[role=button],li,tr,td,th,h1,h2,h3,p"
    ) || el;
    if (target.id) return "#" + target.id;
    const named = target.getAttribute("data-ev") || target.getAttribute("name");
    if (named) return target.tagName.toLowerCase() + "[" + named + "]";
    const text = (target.innerText || target.value || "").trim().replace(/\s+/g, " ").slice(0, 32);
    return target.tagName.toLowerCase() + (text ? ' "' + text + '"' : "");
  }

  window.__events = [];
  let bar, confirmEl;

  function log(text) {
    window.__events.push({ t: Date.now(), e: text });
    if (bar) bar.textContent = "last_event: " + text;
  }

  function confirmTask(kind, parts) {
    const c = code(kind, parts);
    window.__confirm = { kind: kind, parts: parts, code: c };
    if (confirmEl) confirmEl.textContent = "CONFIRM: " + c;
    log("complete " + kind);
    return c;
  }

  function nav(where) { log("navigate " + where); }

  function valueOf(el) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked ? "on" : "off";
    const v = (el.value || "").replace(/\s+/g, " ");
    return v.length > 40 ? v.slice(0, 40) + "…" : v;
  }

  document.addEventListener("click", function (e) { log("click " + describe(e.target)); }, true);
  document.addEventListener("input", function (e) {
    const el = e.target;
    if (el.matches("input[type=text],input[type=tel],input[type=email],input:not([type]),textarea")) {
      log("input " + describe(el) + ' = "' + valueOf(el) + '"');
    }
  }, true);
  document.addEventListener("change", function (e) {
    log("change " + describe(e.target) + ' = "' + valueOf(e.target) + '"');
  }, true);
  window.addEventListener("hashchange", function () { nav(location.pathname + location.hash); });

  document.addEventListener("DOMContentLoaded", function () {
    bar = document.createElement("div");
    bar.id = "event-log";
    bar.setAttribute("aria-live", "off");
    document.body.appendChild(bar);
    confirmEl = document.createElement("div");
    confirmEl.id = "confirm-code";
    document.body.appendChild(confirmEl);
    nav(location.pathname + location.hash);
  });

  window.HG = { log: log, confirm: confirmTask, code: code, nav: nav, describe: describe };
})();
