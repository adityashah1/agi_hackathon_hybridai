import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StepRecordSchema } from "../lib/jsonl";

/**
 * The panel's zod schema must track runner/schema.py. This reads the Python
 * dataclass and compares field names, so a backend change fails the frontend
 * tests instead of silently dropping or inventing fields.
 */
const schemaPy = path.resolve(
  import.meta.dirname,
  "../../../../runner/schema.py"
);
const FIELD_LINE = /^ {4}([a-z_][a-z0-9_]*):/;
const ENERGY_RANGE_DOC = /cloud_energy_wh_low \/ cloud_energy_wh_high/;

const pythonFields = (): string[] => {
  const text = readFileSync(schemaPy, "utf8");
  const start = text.indexOf("class StepRecord:");
  const end = text.indexOf("    def ", start);
  const body = text.slice(start, end === -1 ? undefined : end);
  const fields: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(FIELD_LINE);
    if (m?.[1]) {
      fields.push(m[1]);
    }
  }
  return fields;
};

describe("runner/schema.py ↔ lib/jsonl.ts", () => {
  it("has the same StepRecord fields", () => {
    const py = pythonFields();
    const ts = Object.keys(StepRecordSchema.shape);
    expect(py.length).toBeGreaterThan(20);
    expect(new Set(ts)).toEqual(new Set(py));
  });

  it("keeps the measured/modeled split documented in the Python docstring", () => {
    const text = readFileSync(schemaPy, "utf8");
    for (const f of [
      "local_ms",
      "local_tokens_in",
      "cloud_ms",
      "handoff_tokens",
    ]) {
      expect(text.includes(f)).toBe(true);
    }
    expect(text).toMatch(ENERGY_RANGE_DOC);
  });
});
