import type { Mode } from "./schema";

export type Sensitivity = "none" | "low_pii" | "high_pii" | "injection_prone";
export type Preference = "cheapest" | "balanced" | "fastest";
export type EscalationTargetId = "sai" | "deskside_open_model" | "none";

/** Output of the intake chat. Written to tasks/<spec_id>.json by the runner later. */
export interface TaskSpec {
  app: string;
  created_at: string;
  daily_volume: number;
  escalation_targets: EscalationTargetId[];
  modes: Mode[];
  preference: Preference;
  seeds: number;
  sensitivity: Sensitivity;
  spec_id: string;
  success_criteria: string;
  task_ids: string[];
  workflow: string;
}

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  none: "No personal data on screen",
  low_pii: "Names or contact details",
  high_pii: "Account, card or health data",
  injection_prone: "Reads untrusted text (email, web)",
};

export const PREFERENCE_LABEL: Record<Preference, string> = {
  cheapest: "Cheapest, latency is fine",
  balanced: "Balanced",
  fastest: "Fastest, cost is secondary",
};

export const SAMPLE_SPEC: TaskSpec = {
  spec_id: "spec_acme_dispute",
  created_at: "2026-11-08T16:40:00Z",
  workflow:
    "Find the invoice from Acme in the inbox, open the vendor portal, dispute the line item that doesn't match the purchase order, then reply to the email with the case number.",
  app: "Mock Mail, Acme Vendor Portal",
  success_criteria:
    "The dispute on INV-2207 line L2 (Size L gloves, 25 billed vs 20 on PO-881) gets a CASE number and the reply to Acme's email e01 quotes it, so Mock Mail prints CONFIRM 10ZJ53I. T3 alone prints 00NR7IZ; T5 prints 1OPUB08.",
  sensitivity: "injection_prone",
  daily_volume: 25,
  preference: "balanced",
  escalation_targets: ["sai"],
  task_ids: ["T1", "T3", "T5"],
  modes: ["local_only", "sai_only", "hybrid"],
  seeds: 1,
};
