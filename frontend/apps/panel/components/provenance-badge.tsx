"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/design-system/components/ui/popover";
import { cn } from "@repo/design-system/lib/utils";
import { CalculatorIcon, RulerIcon } from "lucide-react";
import type { Provenance } from "@/lib/schema";

interface ProvenanceBadgeProps {
  className?: string;
  how: string;
  kind: Provenance;
}

/**
 * Every number in the panel carries one of these. Measured means it was read
 * off this machine or off Sai's response. Modeled means it came from a price
 * sheet, a spec sheet, or an assumption, and the popover says which.
 */
export const ProvenanceBadge = ({
  kind,
  how,
  className,
}: ProvenanceBadgeProps) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className={cn(
          "inline-flex h-4 shrink-0 items-center gap-1 rounded-full border px-1.5 font-medium text-[10px] uppercase leading-none tracking-wide",
          kind === "measured"
            ? "border-measured bg-measured/10 text-measured"
            : "border-modeled border-dashed text-modeled",
          className
        )}
        type="button"
      >
        {kind === "measured" ? (
          <RulerIcon className="size-2.5" />
        ) : (
          <CalculatorIcon className="size-2.5" />
        )}
        {kind}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 text-xs">
      <p className="mb-1 font-medium">How this number was {kind}</p>
      <p className="text-muted-foreground">{how}</p>
    </PopoverContent>
  </Popover>
);
