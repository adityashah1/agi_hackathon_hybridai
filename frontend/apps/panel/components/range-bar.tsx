import { cn } from "@repo/design-system/lib/utils";

interface RangeBarProps {
  className?: string;
  high: number;
  low: number;
  max: number;
  tone?: "measured" | "modeled" | "neutral";
}

const TONE_CLASS = {
  measured: "bg-measured",
  modeled: "bg-modeled",
  neutral: "bg-foreground/70",
} as const;

/** A low–high band on a track. Solid up to low, hatched from low to high. */
export const RangeBar = ({
  low,
  high,
  max,
  className,
  tone = "neutral",
}: RangeBarProps) => {
  const pct = (x: number) =>
    max > 0 ? Math.min(100, Math.max(0, (x / max) * 100)) : 0;
  const color = TONE_CLASS[tone];
  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
    >
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", color)}
        style={{ width: `${pct(low)}%` }}
      />
      {high > low ? (
        <div
          className={cn("absolute inset-y-0 opacity-40", color)}
          style={{
            left: `${pct(low)}%`,
            width: `${pct(high) - pct(low)}%`,
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 2px, rgba(255,255,255,0.6) 2px 4px)",
          }}
        />
      ) : null}
    </div>
  );
};
