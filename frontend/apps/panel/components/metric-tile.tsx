import { Card, CardContent } from "@repo/design-system/components/ui/card";
import { cn } from "@repo/design-system/lib/utils";
import type { Provenance } from "@/lib/schema";
import { ProvenanceBadge } from "./provenance-badge";

interface MetricTileProps {
  className?: string;
  emphasis?: boolean;
  how: string;
  label: string;
  provenance: Provenance;
  sub?: string;
  unit?: string;
  value: string;
}

export const MetricTile = ({
  label,
  value,
  unit,
  provenance,
  how,
  sub,
  emphasis,
  className,
}: MetricTileProps) => (
  <Card
    className={cn(
      "gap-0 py-3",
      emphasis && "border-t-2",
      emphasis &&
        (provenance === "measured"
          ? "border-t-measured/70"
          : "border-t-modeled/70"),
      className
    )}
  >
    <CardContent className="px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground text-xs">{label}</span>
        <ProvenanceBadge how={how} kind={provenance} />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            "tabular font-mono font-semibold",
            emphasis ? "text-3xl" : "text-2xl"
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-muted-foreground text-xs">{unit}</span>
        ) : null}
      </div>
      {sub ? <p className="mt-1 text-muted-foreground text-xs">{sub}</p> : null}
    </CardContent>
  </Card>
);
