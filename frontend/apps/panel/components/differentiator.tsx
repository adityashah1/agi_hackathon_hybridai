import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import type { LucideIcon } from "lucide-react";

interface DifferentiatorProps {
  claim: string;
  className?: string;
  detail: string;
  icon: LucideIcon;
}

/** One line at the top of each screen saying what this screen does that a typical agent demo does not. */
export const Differentiator = ({
  icon: Icon,
  claim,
  detail,
  className,
}: DifferentiatorProps) => (
  <div
    className={cn(
      "flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3",
      className
    )}
  >
    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
      <Icon className="size-4" />
    </div>
    <p className="min-w-0 text-sm leading-6">
      <span className="font-semibold">{claim}</span>{" "}
      <span className="text-muted-foreground">{detail}</span>
    </p>
    <Badge
      className="ml-auto hidden shrink-0 border-primary/40 text-[10px] text-primary sm:inline-flex"
      variant="outline"
    >
      what is different
    </Badge>
  </div>
);
