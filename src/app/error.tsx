"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * error.tsx — Next.js route-level error boundary.
 *
 * Catches errors thrown DURING render of the `/` route subtree and shows a
 * recovery UI instead of a white screen. The user can attempt to recover
 * without a full reload.
 *
 * Note: this boundary does NOT catch errors in `layout.tsx` itself —
 * `global-error.tsx` handles those.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console (and any future telemetry) for diagnosis.
    console.error("[mashahd] route error boundary caught:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
          <AlertTriangle className="h-8 w-8" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          We hit an unexpected error while rendering this page. You can try
          again — your data is safe.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            error digest: {error.digest}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button onClick={reset} variant="default">
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
            Try again
          </Button>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
          >
            Reload page
          </Button>
        </div>
      </div>
    </main>
  );
}
