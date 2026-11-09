import { describe, expect, it } from "vitest";
import { SAMPLE_RUN } from "../lib/data/sample-run";
import {
  episodes,
  gateSweep,
  routingMatrix,
  runHealth,
  summarizeAll,
} from "../lib/metrics";
import {
  gateThresholdFromName,
  modeLabel,
  orderModes,
  pickHybridMode,
} from "../lib/schema";

describe("metrics on partial or odd runs", () => {
  it("handles an empty run without throwing", () => {
    expect(summarizeAll([])).toEqual([]);
    expect(gateSweep([])).toHaveLength(21);
    expect(routingMatrix([], "hybrid").escalations).toBe(0);
    const h = runHealth([]);
    expect(h.modes).toEqual([]);
    expect(h.incompleteEpisodes).toEqual([]);
  });

  it("summarizes a run that only has one mode", () => {
    const localOnly = SAMPLE_RUN.steps.filter((s) => s.mode === "local_only");
    const sums = summarizeAll(localOnly);
    expect(sums.map((s) => s.mode)).toEqual(["local_only"]);
    expect(sums[0]?.cloudUsd).toBe(0);
    expect(sums[0]?.ipw.low).toBe(sums[0]?.ipw.high);
  });

  it("flags an episode that has not reached its done step", () => {
    const truncated = SAMPLE_RUN.steps.filter(
      (s) => !(s.mode === "hybrid" && s.task_id === "T5" && s.step_idx >= 3)
    );
    const h = runHealth(truncated);
    expect(h.incompleteEpisodes).toContain("hybrid · T5");
    const eps = episodes(truncated);
    const ep = eps.find((e) => e.mode === "hybrid" && e.task_id === "T5");
    expect(ep?.complete).toBe(false);
    expect(ep?.success).toBe(false);
  });

  it("orders known modes first and labels unknown modes as written", () => {
    expect(orderModes(["zeta_mode", "hybrid", "local_only"])).toEqual([
      "local_only",
      "hybrid",
      "zeta_mode",
    ]);
    expect(modeLabel("hybrid")).toBe("Hybrid gate");
    expect(modeLabel("hybrid_t07")).toBe("hybrid t07");
  });

  it("finds the gate mode even under another name", () => {
    expect(pickHybridMode(["local_only", "sai_only", "hybrid"])).toBe("hybrid");
    expect(
      pickHybridMode(["local_only", "agreement_gate_070", "sai_only"])
    ).toBe("agreement_gate_070");
    expect(pickHybridMode(["local_only"])).toBe("local_only");
    expect(pickHybridMode([])).toBeUndefined();
  });

  it("reads the threshold out of a gate name", () => {
    expect(gateThresholdFromName("agreement_gate@0.6")).toBe(0.6);
    expect(gateThresholdFromName("always_local")).toBeUndefined();
    expect(gateThresholdFromName(undefined)).toBeUndefined();
  });
});
