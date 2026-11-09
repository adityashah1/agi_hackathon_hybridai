import type { Provenance } from "./schema";

/**
 * Catalog for the what-if cards. Sizes are approximate resident footprints; the
 * installed entries mirror brain/local_brain.py SPECS. Nothing here is measured
 * unless a bench.jsonl for that model exists on disk, and the UI says which.
 */

export type Arch = "dense" | "moe";

export interface LocalBrain {
  active_params_b: number;
  arch: Arch;
  /** Directory tag brain/bench.py uses: ':' → '-', '.' removed. */
  bench_tag: string | null;
  computer_use: boolean;
  /** Key as brain/local_brain.py names it, so bench runs can be matched. */
  id: string;
  /** Present in brain/local_brain.py SPECS and runnable via Ollama today. */
  installed: boolean;
  name: string;
  note: string;
  /** Approximate resident size at Q4 incl. vision tower, in GB. */
  resident_gb: number;
  total_params_b: number;
  vendor: string;
}

export const LOCAL_BRAINS: LocalBrain[] = [
  {
    id: "qwen3-vl:2b",
    name: "Qwen3-VL 2B Instruct",
    vendor: "Alibaba",
    arch: "dense",
    total_params_b: 2.1,
    active_params_b: 2.1,
    resident_gb: 1.8,
    computer_use: false,
    installed: true,
    bench_tag: "qwen3-vl-2b",
    note: "Default local brain. Q4_K_M via Ollama, JSON-schema output, 0-1000 relative coordinates, thinking off. Screenshots shrink to 756 px.",
  },
  {
    id: "ui-tars-2b",
    name: "UI-TARS-2B-SFT",
    vendor: "ByteDance",
    arch: "dense",
    total_params_b: 2.2,
    active_params_b: 2.2,
    resident_gb: 2.4,
    computer_use: true,
    installed: true,
    bench_tag: "ui-tars-2b",
    note: "Trained for GUI agents. Prompted in its native Thought/Action format, then parsed. Q4_K_M plus an f16 vision projector.",
  },
  {
    id: "qwen2.5vl:3b",
    name: "Qwen2.5-VL 3B",
    vendor: "Alibaba",
    arch: "dense",
    total_params_b: 3.8,
    active_params_b: 3.8,
    resident_gb: 3.2,
    computer_use: false,
    installed: true,
    bench_tag: "qwen25vl-3b",
    note: "Absolute-pixel coordinates. Froze this 8 GB Mac on 2026-11-08 when only half of it fit on the GPU.",
  },
  {
    id: "lfm3-vl-1.6b",
    name: "LFM3-VL 1.6B",
    vendor: "Liquid AI",
    arch: "dense",
    total_params_b: 1.6,
    active_params_b: 1.6,
    resident_gb: 1.1,
    computer_use: false,
    installed: false,
    bench_tag: null,
    note: "Not pulled yet. Device-native, about a gigabyte at 4-bit, trained inside agent harnesses.",
  },
  {
    id: "lfm2.5-24b-a2b",
    name: "LFM2.5-24B-A2B",
    vendor: "Liquid AI",
    arch: "moe",
    total_params_b: 24,
    active_params_b: 2,
    resident_gb: 12.6,
    computer_use: false,
    installed: false,
    bench_tag: null,
    note: "Mixture of experts. Fast per token, but all experts must sit in memory.",
  },
];

export const DEFAULT_BRAIN_ID = "qwen3-vl:2b";

export interface HardwareTier {
  bandwidth_gbs: number;
  id: string;
  memory_gb: number;
  name: string;
  note: string;
  power_w: number;
  provenance: Provenance;
}

export const HARDWARE: HardwareTier[] = [
  {
    id: "m2-8",
    name: "This Mac · M2",
    memory_gb: 8,
    bandwidth_gbs: 100,
    power_w: 14,
    provenance: "measured",
    note: "Power will be measured with powermetrics during local steps. Memory and bandwidth from the spec sheet.",
  },
  {
    id: "pgx-128",
    name: "ThinkStation PGX · GB10",
    memory_gb: 128,
    bandwidth_gbs: 273,
    power_w: 240,
    provenance: "modeled",
    note: "Spec sheet. On site today; one measured episode would flip this row.",
  },
  {
    id: "h100-80",
    name: "Cloud GPU · H100",
    memory_gb: 80,
    bandwidth_gbs: 3350,
    power_w: 700,
    provenance: "modeled",
    note: "Spec sheet. Shared across tenants, so per-agent power is a band, not a point.",
  },
];

export interface EscalationTargetDef {
  id: "sai" | "deskside_open_model" | "none";
  name: string;
  note: string;
  provenance: Provenance;
  usd_per_step: number | null;
}

export const ESCALATION_TARGETS: EscalationTargetDef[] = [
  {
    id: "sai",
    name: "Simular Sai (cloud computer-use agent)",
    usd_per_step: null,
    provenance: "measured",
    note: "Cost from Sai's usage.costUsd estimate or the account credits delta, whichever the runner logged.",
  },
  {
    id: "deskside_open_model",
    name: "Open VLM served from the desk-side box",
    usd_per_step: 0,
    provenance: "modeled",
    note: "No API cost. Energy modeled from the PGX power figure. Success rate assumed equal to Sai, which is optimistic.",
  },
  {
    id: "none",
    name: "No escalation (local only)",
    usd_per_step: 0,
    provenance: "measured",
    note: "Equivalent to the local-only mode in this run.",
  },
];

/**
 * brain/local_brain.py refuses to load a model unless at least 35% of system
 * memory is free, and a 3.2 GB model froze the 8 GB Mac. So "fits" means the
 * resident footprint stays within that 35% of memory.
 */
export const USABLE_FRACTION = 0.35;

export const fits = (brain: LocalBrain, tier: HardwareTier) =>
  brain.resident_gb <= tier.memory_gb * USABLE_FRACTION;

/** Bandwidth-bound decode ceiling: bytes moved per token are the active weights at 4-bit. */
export const tokensPerSecCeiling = (brain: LocalBrain, tier: HardwareTier) => {
  const bytesPerToken = brain.active_params_b * 1e9 * 0.5;
  return (tier.bandwidth_gbs * 1e9) / bytesPerToken;
};

export interface DeploymentTier {
  id: "laptop" | "laptop_cloud" | "deskside_cloud";
  name: string;
  summary: string;
}

export const DEPLOYMENT_TIERS: DeploymentTier[] = [
  {
    id: "laptop",
    name: "Laptop only",
    summary:
      "Everything local. No data leaves. Lowest success on hard screens.",
  },
  {
    id: "laptop_cloud",
    name: "Laptop + cloud escalation",
    summary:
      "The hybrid gate as run today. Screens cross the boundary only when the local model hesitates.",
  },
  {
    id: "deskside_cloud",
    name: "Desk-side box + cloud",
    summary:
      "Bigger local brain on a PGX handles most hesitations. Cloud only for the rest.",
  },
];
