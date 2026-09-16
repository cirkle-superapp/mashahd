"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * global-error.tsx — Next.js top-level error boundary.
 *
 * Catches errors thrown in `layout.tsx` or during hydration of the root
 * layout itself. Must render its own <html> and <body> because the root
 * layout is replaced by this file when it triggers.
 *
 * This is the last line of defense — if it fails, the user sees the
 * browser's default error page. Keep it dependency-free.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[mashahd] global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#FDFCF9",
          color: "#0f172a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.5rem",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "4rem",
              height: "4rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "1rem",
              background: "rgba(244, 63, 94, 0.1)",
              color: "#f43f5e",
            }}
          >
            <AlertTriangle width={32} height={32} aria-hidden />
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            Mashahd hit a critical error
          </h1>
          <p style={{ maxWidth: "28rem", color: "#64748b", fontSize: "0.875rem", margin: 0 }}>
            The application shell failed to load. Your data is safe — try
            again, or reload the page if the problem persists.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#94a3b8",
                margin: 0,
              }}
            >
              digest: {error.digest}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => reset()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                background: "#0f172a",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontWeight: 500,
                fontSize: "0.875rem",
              }}
            >
              <RotateCcw width={16} height={16} aria-hidden />
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                background: "transparent",
                color: "#0f172a",
                border: "1px solid #e2e8f0",
                cursor: "pointer",
                fontWeight: 500,
                fontSize: "0.875rem",
              }}
            >
              Reload page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
