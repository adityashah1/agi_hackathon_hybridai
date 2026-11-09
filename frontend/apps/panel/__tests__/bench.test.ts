import { describe, expect, it } from "vitest";
import {
  benchDirInfo,
  benchTagForModel,
  parseBenchJsonl,
  parseCallsJsonl,
  parseSubgoalJsonl,
  summarizeBench,
} from "../lib/bench";

const benchRow = (over: Record<string, unknown>) =>
  JSON.stringify({
    case: 0,
    rep: 0,
    screenshot: "data/runs/x/screens/0000.png",
    goal: "Click the link.",
    original_size: [1280, 960],
    model_image_size: [756, 560],
    action: { action: "click", x: 480, y: 915, valid: true },
    valid: true,
    error: "",
    retried: false,
    latency_ms: 4200,
    tokens_in: 740,
    tokens_in_cached: 0,
    tokens_out: 31,
    mean_logprob: -0.21,
    mean_logprob_all: -0.4,
    ollama_ms: {},
    target: "hit",
    raw: "{}",
    ...over,
  });

describe("bench.jsonl from brain/bench.py", () => {
  it("maps model keys to the directory tag the bench uses", () => {
    expect(benchTagForModel("qwen3-vl:2b")).toBe("qwen3-vl-2b");
    expect(benchTagForModel("qwen2.5vl:3b")).toBe("qwen25vl-3b");
    expect(benchTagForModel("ui-tars-2b")).toBe("ui-tars-2b");
  });

  it("reads the tag and image width from the directory name", () => {
    expect(benchDirInfo("bench_qwen3-vl-2b_w756_20261108_143000")).toEqual({
      tag: "qwen3-vl-2b",
      width: 756,
    });
    expect(benchDirInfo("bench_ui-tars-2b_20261108_143000")).toEqual({
      tag: "ui-tars-2b",
      width: null,
    });
    expect(benchDirInfo("smoke_local_20261108_134500")).toBeNull();
  });

  it("summarizes latency, validity, tokens and hits", () => {
    const text = [
      benchRow({ latency_ms: 9000 }),
      benchRow({ latency_ms: 4000, rep: 1 }),
      benchRow({
        case: 1,
        latency_ms: 5000,
        valid: false,
        target: "-",
        retried: true,
        mean_logprob: null,
      }),
      benchRow({ case: 1, rep: 1, latency_ms: 4400, target: "miss" }),
      "not json",
    ].join("\n");
    const rows = parseBenchJsonl(text);
    expect(rows).toHaveLength(4);
    const s = summarizeBench("bench_qwen3-vl-2b_w756_20261108_143000", rows);
    expect(s.model_tag).toBe("qwen3-vl-2b");
    expect(s.image_width).toBe(756);
    expect(s.calls).toBe(4);
    expect(s.validRate).toBe(0.75);
    expect(s.retries).toBe(1);
    expect(s.medianLatencyMs).toBe(4700);
    expect(s.warmMedianLatencyMs).toBe(4400);
    expect(s.firstCallMs).toBe(9000);
    expect(s.hits).toBe(2);
    expect(s.judged).toBe(3);
    expect(s.medianLogprob).toBe(-0.21);
  });
});

describe("calls.jsonl from env/sai_env.py", () => {
  it("totals by op and counts failures and local calls", () => {
    const text = [
      JSON.stringify({
        op: "open_lease",
        method: "POST",
        path: "/v1/machines/m/control",
        status: 201,
        ms: 1800.5,
        t_start: 1,
      }),
      JSON.stringify({
        op: "screenshot",
        method: "POST",
        path: "/exec",
        status: 200,
        ms: 900,
        t_start: 2,
      }),
      JSON.stringify({
        op: "screenshot",
        method: "POST",
        path: "/exec",
        status: 200,
        ms: 1100,
        t_start: 3,
      }),
      JSON.stringify({
        op: "act_click",
        method: "POST",
        path: "/exec",
        status: 410,
        ms: 50,
        t_start: 4,
      }),
      JSON.stringify({
        op: "act_click",
        method: "LOCAL",
        path: "act_click",
        status: 200,
        ms: 320,
        t_start: 5,
      }),
    ].join("\n");
    const s = parseCallsJsonl(text);
    expect(s.count).toBe(5);
    expect(s.failed).toBe(1);
    expect(s.localCalls).toBe(1);
    expect(s.totalMs).toBeCloseTo(4170.5);
    expect(s.byOp[0]).toEqual({ op: "screenshot", count: 2, ms: 2000 });
  });
});

describe("subgoal_results.jsonl from env/subgoal_test.py", () => {
  it("counts verdicts and sums cost", () => {
    const text = [
      JSON.stringify({
        run: 1,
        verdict: "stopped_at_done",
        status: "succeeded",
        steps: 4,
        cost_usd_estimate: 0.9,
        credits_delta_usd: 1.0,
      }),
      JSON.stringify({
        run: 2,
        verdict: "kept_going",
        status: "succeeded",
        steps: 9,
        cost_usd_estimate: 2.1,
        credits_delta_usd: 2.0,
      }),
      JSON.stringify({
        run: 3,
        verdict: "did_not_reach",
        status: "failed",
        steps: 2,
        cost_usd_estimate: 0.5,
        credits_delta_usd: null,
      }),
    ].join("\n");
    const s = parseSubgoalJsonl("subgoal_20261108_132010", text);
    expect(s.counts).toEqual({
      kept_going: 1,
      stopped_at_done: 1,
      did_not_reach: 1,
      unknown: 0,
    });
    expect(s.totalCostEstimate).toBeCloseTo(3.5);
    expect(s.totalCreditsDelta).toBeCloseTo(3.0);
  });
});
