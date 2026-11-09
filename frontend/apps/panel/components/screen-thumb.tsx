"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { cn } from "@repo/design-system/lib/utils";
import { useState } from "react";
import { MiniScreen } from "./mini-screen";

interface ScreenThumbProps {
  /** `/api/runs/<id>/screens` when the run has real screenshots, else null. */
  base: string | null;
  className?: string;
  screenshotPath: string;
  taskId: string;
}

const basename = (p: string) => p.split("/").at(-1) ?? p;

/**
 * The step's real screenshot when the run has one on disk, otherwise the
 * per-app placeholder. Click to see it full size. This is the "screen that
 * crossed the boundary", so judges can see exactly what the cloud saw.
 */
export const ScreenThumb = ({
  base,
  screenshotPath,
  taskId,
  className,
}: ScreenThumbProps) => {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const file = basename(screenshotPath);
  if (!base || failed || !file) {
    return <MiniScreen taskId={taskId} title={screenshotPath} />;
  }
  const src = `${base}/${encodeURIComponent(file)}`;
  return (
    <>
      <button
        className={cn(
          "h-7 w-10 shrink-0 overflow-hidden rounded-[3px] border bg-muted transition-shadow hover:ring-2 hover:ring-primary/50",
          className
        )}
        onClick={() => setOpen(true)}
        title={`${screenshotPath} · click to enlarge`}
        type="button"
      >
        {/* biome-ignore lint/performance/noImgElement: served by our own route, sizes vary per env */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError only swaps in the placeholder */}
        <img
          alt=""
          className="h-full w-full object-cover object-top"
          height={28}
          onError={() => setFailed(true)}
          src={src}
          width={40}
        />
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="font-mono text-sm">{file}</DialogTitle>
          <DialogDescription className="text-xs">
            {screenshotPath}
          </DialogDescription>
          {/* biome-ignore lint/performance/noImgElement: served by our own route, sizes vary per env */}
          <img
            alt={`Screenshot ${file}`}
            className="max-h-[75vh] w-full rounded-md border object-contain"
            height={768}
            src={src}
            width={1024}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
