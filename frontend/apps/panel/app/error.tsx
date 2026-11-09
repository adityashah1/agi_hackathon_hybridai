"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SAMPLE_RUN } from "@/lib/data/sample-run";

/**
 * Route-level error boundary. A malformed run must never blank a screen during
 * a demo: show what happened and offer the sample run as a way back.
 */
const ErrorPage = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  const [busy, setBusy] = useState(false);

  const switchToSample = async () => {
    setBusy(true);
    try {
      await fetch("/api/select-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id: SAMPLE_RUN.run_id }),
      });
    } finally {
      window.location.href = "/";
    }
  };

  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <Card className="w-full max-w-xl gap-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangleIcon className="size-4 text-destructive" />
            This screen could not render
          </CardTitle>
          <CardDescription>
            Usually a run file the panel did not expect. The other screens still
            work.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {error.message}
            {error.digest ? `\n\ndigest ${error.digest}` : ""}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button disabled={busy} onClick={switchToSample} variant="outline">
              Switch to the sample run
            </Button>
            <Button asChild variant="ghost">
              <Link href="/">Back to overview</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ErrorPage;
