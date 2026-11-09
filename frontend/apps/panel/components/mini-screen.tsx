import { cn } from "@repo/design-system/lib/utils";
import { taskById } from "@/lib/data/task-suite";

/** Title-bar color per mock app, so a glance tells the inbox from the portal. */
const APP_BAR: Record<string, string> = {
  "Harbor Mail": "bg-amber-500/70",
  "Acme Vendor Portal": "bg-violet-500/70",
  "Account Settings": "bg-emerald-500/70",
};

/** A tiny stand-in for the step screenshot, colored per app. The real thumbnail replaces it when screens exist. */
export const MiniScreen = ({
  taskId,
  title,
}: {
  taskId: string;
  title?: string;
}) => {
  const app = taskById(taskId)?.app ?? "";
  return (
    <div
      className="flex h-7 w-10 shrink-0 flex-col overflow-hidden rounded-[3px] border bg-background"
      title={title}
    >
      <div
        className={cn("h-1.5 w-full", APP_BAR[app] ?? "bg-muted-foreground/50")}
      />
      <div className="flex flex-1 flex-col gap-[2px] p-[3px]">
        <div className="h-[2px] w-3/4 rounded bg-muted-foreground/40" />
        <div className="h-[2px] w-1/2 rounded bg-muted-foreground/30" />
        <div className="mt-auto h-[3px] w-1/3 rounded-sm bg-primary/60" />
      </div>
    </div>
  );
};
