"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/app-store";
import { useCommandPalette } from "@/store/command-palette-store";
import { useTheme } from "next-themes";
import { toast } from "sonner";

/**
 * KeyboardShortcuts — global hotkeys + a Shift+? help overlay.
 *
 * Hotkeys (YouTube-familiar, adapted for Mashahd):
 *   /           focus the search box
 *   s           toggle the sidebar
 *   t           toggle light/dark theme
 *   k  (⌘K)     open the command palette
 *   g h         go home
 *   g t         go trending
 *   g s         go subscriptions
 *   g l         go library
 *   ?  (Shift+/)  open this shortcuts overlay
 *   Esc         close any overlay / palette
 */
const SHORTCUTS: {
  group: string;
  items: { keys: string[]; label: string }[];
}[] = [
  {
    group: "Navigation",
    items: [
      { keys: ["g", "h"], label: "Go home" },
      { keys: ["g", "t"], label: "Go trending" },
      { keys: ["g", "s"], label: "Go subscriptions" },
      { keys: ["g", "l"], label: "Go library" },
      { keys: ["g", "i"], label: "Go history" },
      { keys: ["g", "k"], label: "Go liked videos" },
    ],
  },
  {
    group: "Search & palette",
    items: [
      { keys: ["/"], label: "Focus search box" },
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Open this shortcuts overlay" },
    ],
  },
  {
    group: "View",
    items: [
      { keys: ["s"], label: "Toggle sidebar" },
      { keys: ["t"], label: "Toggle light/dark theme" },
      { keys: ["Esc"], label: "Close any overlay" },
    ],
  },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const { navigate, toggleSidebar } = useAppStore();
  const openPalette = useCommandPalette((s) => s.openPalette);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // Two-key sequences (g + h/t/s/l/i/k) use a 600ms window.
    let lastKey = "";
    let lastKeyAt = 0;
    const SEQ_WINDOW = 600;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Esc always works
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }

      // While typing, only allow Escape (handled above) — don't hijack keys.
      if (isTyping) return;

      // ⌘K / Ctrl+K — command palette (the palette component also handles
      // this, but we guard here so we don't double-toggle).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return;
      }

      // Shift+/ → ?
      if (e.shiftKey && e.key === "/") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      const key = e.key.toLowerCase();
      const now = Date.now();

      // Sequence: g + [htislk]
      if (lastKey === "g" && now - lastKeyAt < SEQ_WINDOW) {
        const map: Record<string, () => void> = {
          h: () => navigate({ kind: "home" }),
          t: () => navigate({ kind: "trending" }),
          s: () => navigate({ kind: "subscriptions" }),
          l: () => navigate({ kind: "library" }),
          i: () => navigate({ kind: "history" }),
          k: () => navigate({ kind: "liked" }),
        };
        if (map[key]) {
          e.preventDefault();
          map[key]();
          lastKey = "";
          return;
        }
      }

      // Single-key shortcuts
      if (key === "/") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(
          'input[aria-label="Search"]'
        );
        el?.focus();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (key === "t") {
        e.preventDefault();
        setTheme(theme === "dark" ? "light" : "dark");
        return;
      }

      lastKey = key;
      lastKeyAt = now;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleSidebar, setTheme, theme]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Navigate Mashahd without leaving the keyboard. Two-key sequences
          (like{" "}
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">g</kbd>{" "}
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">h</kbd>)
          fire within a 600ms window.
        </DialogDescription>

        <div className="space-y-5 pt-2">
          {SHORTCUTS.map((group) => (
            <div key={group.group}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {group.group}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="min-w-6 text-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Tip: the command palette (
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">⌘K</kbd>)
          also exposes every navigation target.
        </p>
      </DialogContent>
    </Dialog>
  );
}
