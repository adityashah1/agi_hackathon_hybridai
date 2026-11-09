import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import type { Executor, GateDecision, StepLabel } from "@/lib/schema";

export const GateBadge = ({ decision }: { decision: GateDecision }) => (
  <Badge
    className={cn(
      "font-mono text-[11px]",
      decision === "local" && "border-gate-local text-gate-local",
      decision === "flush" && "border-gate-flush text-gate-flush",
      decision === "escalate" && "border-gate-escalate text-gate-escalate"
    )}
    variant="outline"
  >
    {decision}
  </Badge>
);

export const ExecutorBadge = ({ executor }: { executor: Executor }) =>
  executor === "sai" ? (
    <Badge className="bg-gate-escalate font-mono text-[11px] text-white">
      Sai
    </Badge>
  ) : (
    <Badge className="font-mono text-[11px]" variant="secondary">
      local
    </Badge>
  );

export const LabelBadge = ({ label }: { label: StepLabel }) => (
  <Badge
    className={cn(
      "font-mono text-[11px]",
      label === "ok" && "border-success text-success",
      label === "fail" && "border-destructive text-destructive"
    )}
    variant="outline"
  >
    {label}
  </Badge>
);
