import { Card, CardContent } from "@repo/design-system/components/ui/card";
import { cn } from "@repo/design-system/lib/utils";
import Link from "next/link";
import { FLOW } from "@/lib/flow";

export const FlowStepper = ({ current }: { current?: string }) => (
  <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {FLOW.map((item) => (
      <li key={item.href}>
        <Link className="block h-full" href={item.href}>
          <Card
            className={cn(
              "h-full gap-0 py-3 transition-colors hover:bg-accent/50",
              current === item.href && "border-primary"
            )}
          >
            <CardContent className="flex items-start gap-3 px-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs">
                {item.step}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <item.icon className="size-4 text-muted-foreground" />
                  {item.title}
                </div>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {item.blurb}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </li>
    ))}
  </ol>
);
