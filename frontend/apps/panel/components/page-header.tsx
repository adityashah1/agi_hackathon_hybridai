import { Separator } from "@repo/design-system/components/ui/separator";
import { SidebarTrigger } from "@repo/design-system/components/ui/sidebar";
import type { ReactNode } from "react";

interface PageHeaderProps {
  children?: ReactNode;
  description?: string;
  step?: number;
  title: string;
}

export const PageHeader = ({
  title,
  description,
  step,
  children,
}: PageHeaderProps) => (
  <header className="flex flex-col gap-2 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
    <div className="flex items-center gap-2">
      <SidebarTrigger className="-ml-1" />
      <Separator className="mr-1 h-4" orientation="vertical" />
      <div>
        <div className="flex items-center gap-2">
          {step ? (
            <span className="font-mono text-muted-foreground text-xs">
              {step}/6
            </span>
          ) : null}
          <h1 className="font-semibold text-base leading-tight">{title}</h1>
        </div>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
    </div>
    {children ? (
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    ) : null}
  </header>
);
