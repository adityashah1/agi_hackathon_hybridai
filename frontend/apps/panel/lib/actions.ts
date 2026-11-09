import type { ActionJson } from "./schema";

/**
 * Two action shapes appear in the logs. env/sai_env.py and env/local_env.py use
 * `{type, x, y, text, name, dx, dy}`. brain/local_brain.py proposes
 * `{action, x, y, text, key, why, valid}`. The panel reads both.
 */
export const actionKind = (a: ActionJson | null | undefined): string =>
  a?.type ?? a?.action ?? "?";

const trunc = (s: string, n = 42) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

const scrollDirection = (a: ActionJson): string => {
  if (a.key) {
    return a.key;
  }
  if (a.dy !== undefined && a.dy !== 0) {
    return a.dy > 0 ? "down" : "up";
  }
  if (a.dx !== undefined && a.dx !== 0) {
    return a.dx > 0 ? "right" : "left";
  }
  return "";
};

const clickTarget = (a: ActionJson): string => {
  const at = a.x !== undefined && a.y !== undefined ? ` (${a.x}, ${a.y})` : "";
  if (a.target) {
    return `click ${a.target}${at}`;
  }
  return at ? `click${at}` : "click";
};

/** One-line, human-readable action. `withWhy` appends the brain's stated reason. */
export const describeAction = (
  a: ActionJson | null | undefined,
  withWhy = true
): string => {
  if (!a) {
    return "–";
  }
  const kind = actionKind(a);
  let text: string;
  if (kind === "done") {
    text = "done";
  } else if (kind === "type") {
    text = `type "${trunc(a.text ?? "", 32)}"`;
  } else if (kind === "key") {
    text = `key ${a.key ?? a.name ?? ""}`.trim();
  } else if (kind === "scroll") {
    text = `scroll ${scrollDirection(a)}`.trim();
  } else if (kind === "click") {
    text = clickTarget(a);
  } else {
    text = `${kind} ${a.target ?? a.text ?? ""}`.trim();
  }
  if (a.valid === false) {
    text = `invalid · ${text}`;
  }
  if (withWhy && a.why) {
    text = `${text} · ${trunc(a.why)}`;
  }
  return text;
};

/** Same decision? Clicks within `tol` pixels of each other count as the same click. */
export const sameAction = (
  a: ActionJson | null | undefined,
  b: ActionJson | null | undefined,
  tol = 12
): boolean => {
  if (!(a && b)) {
    return false;
  }
  if (actionKind(a) !== actionKind(b)) {
    return false;
  }
  if ((a.text ?? "") !== (b.text ?? "")) {
    return false;
  }
  if ((a.key ?? a.name ?? "") !== (b.key ?? b.name ?? "")) {
    return false;
  }
  if ((a.target ?? "") !== (b.target ?? "")) {
    return false;
  }
  if (a.x !== undefined && b.x !== undefined && Math.abs(a.x - b.x) > tol) {
    return false;
  }
  if (a.y !== undefined && b.y !== undefined && Math.abs(a.y - b.y) > tol) {
    return false;
  }
  return true;
};
