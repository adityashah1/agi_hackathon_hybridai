import { describe, expect, it } from "vitest";
import { SAMPLE_RUN } from "../lib/data/sample-run";
import {
  episodes,
  gateSweep,
  routingMatrix,
  summarizeAll,
} from "../lib/metrics";

describe("sample run", () => {
  it("has one episode per phase per mode", () => {
    const eps = episodes(SAMPLE_RUN.steps);
    expect(eps).toHaveLength(9);
  });

  it("keeps cloud energy as a range, never a point, per CLAUDE.md rule 5", () => {
    for (const s of SAMPLE_RUN.steps) {
      const lo = s.cloud_energy_wh_low;
      const hi = s.cloud_energy_wh_high;
      expect(lo === null).toBe(hi === null);
      if (lo !== null && hi !== null) {
        expect(lo).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("escalates only below the gate threshold in hybrid mode", () => {
    const hybrid = SAMPLE_RUN.steps.filter((s) => s.mode === "hybrid");
    for (const s of hybrid) {
      if (s.gate_decision === "local") {
        expect(s.agreement_score ?? 0).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});

describe("demo story", () => {
  it("hybrid finishes more tasks than local-only and spends less than Sai-only", () => {
    const sums = summarizeAll(SAMPLE_RUN.steps);
    const local = sums.find((s) => s.mode === "local_only");
    const sai = sums.find((s) => s.mode === "sai_only");
    const hybrid = sums.find((s) => s.mode === "hybrid");
    for (const s of sums) {
      console.log(
        s.mode +
          ": " +
          s.successes +
          "/" +
          s.tasks +
          " done, local share " +
          (s.localShare * 100).toFixed(0) +
          "%, $" +
          s.cloudUsd.toFixed(2) +
          ", " +
          s.saiSteps +
          " sai steps"
      );
    }
    expect(hybrid?.successes ?? 0).toBeGreaterThan(local?.successes ?? 0);
    expect(hybrid?.successes ?? 0).toBeGreaterThanOrEqual(2);
    expect(sai?.successes ?? 0).toBeGreaterThanOrEqual(2);
    expect(hybrid?.cloudUsd ?? 0).toBeLessThan(sai?.cloudUsd ?? 0);
    expect(hybrid?.scenarioDone).toBe(true);
    expect(local?.scenarioDone).toBe(false);
  });
});

describe("metrics", () => {
  it("summarizes all three modes", () => {
    const sums = summarizeAll(SAMPLE_RUN.steps);
    expect(sums.map((s) => s.mode)).toEqual([
      "local_only",
      "sai_only",
      "hybrid",
    ]);
    const sai = sums.find((s) => s.mode === "sai_only");
    expect(sai?.localShare).toBe(0);
    const local = sums.find((s) => s.mode === "local_only");
    expect(local?.cloudUsd).toBe(0);
  });

  it("routing matrix counts add up to hybrid step count", () => {
    const m = routingMatrix(SAMPLE_RUN.steps, "hybrid");
    const hybridSteps = SAMPLE_RUN.steps.filter(
      (s) => s.mode === "hybrid"
    ).length;
    expect(m.localOk + m.localFail + m.escalateOk + m.escalateFail).toBe(
      hybridSteps
    );
  });

  it("gate sweep cloud share is monotone in the threshold", () => {
    const pts = gateSweep(SAMPLE_RUN.steps);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]?.cloudShare ?? 0).toBeGreaterThanOrEqual(
        pts[i - 1]?.cloudShare ?? 0
      );
    }
  });
});
