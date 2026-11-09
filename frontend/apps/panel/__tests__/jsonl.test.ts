import { describe, expect, it } from "vitest";
import { SAMPLE_RUN } from "../lib/data/sample-run";
import { parseStepsJsonl, toJsonl } from "../lib/jsonl";

const NOT_JSON = /not JSON/;
const MISSING_FIELD = /task_id|step_idx|gate_decision|executor/;
const NOT_OBJECT = /not a JSON object/;
const UNKNOWN_FIELDS = /not in runner\/schema.py/;

describe("steps.jsonl parser", () => {
  it("round-trips the sample run", () => {
    const text = toJsonl(SAMPLE_RUN.steps);
    const { steps, report } = parseStepsJsonl(text);
    expect(steps).toHaveLength(SAMPLE_RUN.steps.length);
    expect(report.rejectedCount).toBe(0);
    expect(report.warnings).toHaveLength(0);
    expect(steps[0]).toEqual(SAMPLE_RUN.steps[0]);
  });

  it("rejects bad lines with a reason and keeps the good ones", () => {
    const good = JSON.stringify(SAMPLE_RUN.steps[0]);
    const text = [
      "not json at all",
      good,
      '{"run_id":"r","mode":"hybrid"}',
      "",
      "[1,2]",
      good,
    ].join("\n");
    const { steps, report } = parseStepsJsonl(text);
    expect(steps).toHaveLength(2);
    expect(report.parsedLines).toBe(5);
    expect(report.rejectedCount).toBe(3);
    expect(report.rejected[0]?.line).toBe(1);
    expect(report.rejected[0]?.reason).toMatch(NOT_JSON);
    expect(report.rejected[1]?.reason).toMatch(MISSING_FIELD);
    expect(report.rejected[2]?.reason).toMatch(NOT_OBJECT);
  });

  it("fills schema defaults for missing optional fields", () => {
    const minimal = {
      run_id: "r1",
      mode: "hybrid_t07",
      task_id: "T1",
      step_idx: 0,
      gate_decision: "local",
      executor: "local",
    };
    const { steps, report } = parseStepsJsonl(JSON.stringify(minimal));
    expect(report.accepted).toBe(1);
    const s = steps[0];
    expect(s?.local_samples).toEqual([]);
    expect(s?.step_label).toBe("unknown");
    expect(s?.cloud_usd).toBe(0);
    expect(s?.cloud_energy_wh_low).toBeNull();
    expect(s?.pii_strings_visible).toEqual([]);
  });

  it("ignores unknown fields but says so", () => {
    const withExtra = {
      ...SAMPLE_RUN.steps[0],
      model_name: "qwen2.5-vl-3b",
      extra_debug: 1,
    };
    const { steps, report } = parseStepsJsonl(JSON.stringify(withExtra));
    expect(steps).toHaveLength(1);
    expect(report.unknownFields).toEqual({ model_name: 1, extra_debug: 1 });
    expect(report.warnings[0]).toMatch(UNKNOWN_FIELDS);
    expect("model_name" in (steps[0] as object)).toBe(false);
  });

  it("warns when cloud energy is a point instead of a range", () => {
    const half = {
      ...SAMPLE_RUN.steps[0],
      cloud_energy_wh_low: 0.5,
      cloud_energy_wh_high: null,
    };
    const { report } = parseStepsJsonl(JSON.stringify(half));
    expect(report.accepted).toBe(1);
    expect(report.warnings.some((w) => w.includes("low-high range"))).toBe(
      true
    );
  });
});
