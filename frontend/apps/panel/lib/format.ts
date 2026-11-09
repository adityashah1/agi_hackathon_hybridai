import type { Range } from "./metrics";

export const fmtUsd = (x: number, digits = 2) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const fmtPct = (x: number, digits = 0) =>
  `${(x * 100).toFixed(digits)}%`;

export const fmtMs = (ms: number) => {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${(ms / 60_000).toFixed(1)} min`;
};

export const fmtWh = (wh: number) => {
  if (wh < 0.01) {
    return `${(wh * 1000).toFixed(1)} mWh`;
  }
  if (wh < 1000) {
    return `${wh.toFixed(2)} Wh`;
  }
  return `${(wh / 1000).toFixed(2)} kWh`;
};

export const fmtRange = (r: Range, f: (x: number) => string) =>
  Math.abs(r.low - r.high) < 1e-9 ? f(r.low) : `${f(r.low)} to ${f(r.high)}`;

export const fmtInt = (x: number) => Math.round(x).toLocaleString("en-US");

export const fmtNum = (x: number, digits = 2) =>
  x.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

export const shortHash = (h: string) => `${h.slice(0, 8)}…`;
