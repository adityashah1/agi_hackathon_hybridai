import { cn } from "@repo/design-system/lib/utils";
import {
  ChevronRightIcon,
  CloudIcon,
  CpuIcon,
  FileTextIcon,
  GaugeIcon,
  GitBranchIcon,
  LaptopIcon,
  type LucideIcon,
  MonitorIcon,
} from "lucide-react";

const Node = ({
  icon: Icon,
  title,
  sub,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  tone?: string;
}) => (
  <div
    className={cn(
      "flex min-w-[7.5rem] shrink-0 flex-col gap-0.5 rounded-lg border bg-card px-2.5 py-2",
      tone
    )}
  >
    <div className="flex items-center gap-2 font-medium text-xs">
      <Icon className="size-3.5 text-muted-foreground" />
      {title}
    </div>
    <div className="text-[11px] text-muted-foreground leading-4">{sub}</div>
  </div>
);

const Arrow = () => (
  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50" />
);

/** The per-step loop, drawn once so judges can point at the gate. */
export const StepLoop = () => (
  <div className="flex items-center gap-2 overflow-x-auto pb-1">
    <Node
      icon={MonitorIcon}
      sub="756 px for the model, stays on disk"
      title="Screenshot"
    />
    <Arrow />
    <Node
      icon={CpuIcon}
      sub="Qwen3-VL 2B via Ollama, 3 samples"
      title="Local VLM proposes"
    />
    <Arrow />
    <Node
      icon={GaugeIcon}
      sub="agreement + decision log-prob"
      title="Confidence"
    />
    <Arrow />
    <Node
      icon={GitBranchIcon}
      sub="local · flush · escalate"
      title="Gate decides"
      tone="border-primary/50 bg-primary/5"
    />
    <Arrow />
    <div className="flex shrink-0 flex-col gap-2">
      <Node
        icon={LaptopIcon}
        sub="nothing leaves"
        title="Local executes"
        tone="border-gate-local/40"
      />
      <Node
        icon={CloudIcon}
        sub="screen crosses boundary"
        title="Escalate to Sai"
        tone="border-gate-escalate/50 bg-gate-escalate/5"
      />
    </div>
    <Arrow />
    <Node icon={FileTextIcon} sub="one JSON line" title="Step logged" />
  </div>
);
