"use client";

/**
 * @deprecated — Dead code (UI audit 2026-09). Mashahd is a standalone video
 * module; the super-app sibling-module rail was never wired into `page.tsx`.
 * Kept here per the "nothing deleted or removed" directive. If reviving as
 * part of the CIRKLE super-app shell, mount in `page.tsx` alongside the Dock.
 */

import { useEffect, useState } from "react";
import {
  MessageCircle,
  Video,
  Camera,
  Megaphone,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * SuperAppRail — the slim left-edge rail that lets the user switch between
 * the super-app's sibling modules: Wasl (chat), Mashahd (video), Lamahat
 * (photos), Midan (public square).
 *
 * Mashahd is the active module (this app). Clicking a sibling dispatches a
 * `superapp:switch-module` CustomEvent (which the parent shell intercepts
 * to unmount Mashahd and mount the target module) and calls
 * `window.mashahd.exit()` so any in-Mashahd listeners can clean up.
 *
 * On first click of a sibling we show a toast explaining that the module
 * isn't mounted in this build — the parent shell is expected to handle the
 * actual handoff.
 */

export type ModuleId = "wasl" | "mashahd" | "lamahat" | "midan";

const MODULES: {
  id: ModuleId;
  label: string;
  arabic: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
}[] = [
  { id: "wasl", label: "Wasl", arabic: "وصل", icon: MessageCircle, tint: "text-steel" },
  { id: "mashahd", label: "Mashahd", arabic: "مشاهِد", icon: Video, tint: "text-gold" },
  { id: "lamahat", label: "Lamahat", arabic: "لمحات", icon: Camera, tint: "text-rose" },
  { id: "midan", label: "Midan", arabic: "ميدان", icon: Megaphone, tint: "text-teal-light" },
];

export function SuperAppRail() {
  const [active, setActive] = useState<ModuleId>("mashahd");
  const [hovered, setHovered] = useState<ModuleId | null>(null);

  useEffect(() => {
    // A parent shell can request a module switch via CustomEvent.
    const onSwitch = (e: Event) => {
      const detail = (e as CustomEvent<{ module: ModuleId }>).detail;
      if (detail?.module) setActive(detail.module);
    };
    window.addEventListener("superapp:switch-module", onSwitch as EventListener);
    return () =>
      window.removeEventListener("superapp:switch-module", onSwitch as EventListener);
  }, []);

  const switchTo = (mod: ModuleId) => {
    if (mod === "mashahd") {
      setActive("mashahd");
      return;
    }
    // Tell the parent shell to switch. The shell unmounts Mashahd and
    // mounts the target module.
    window.dispatchEvent(
      new CustomEvent("superapp:switch-module", { detail: { module: mod } })
    );
    // Ask Mashahd to exit (lets in-module listeners clean up).
    window.mashahd?.exit();
    const def = MODULES.find((m) => m.id === mod)!;
    toast.info(`Switching to ${def.label} (${def.arabic})`, {
      description:
        "In the super-app shell, this hands off to the sibling module. Running Mashahd standalone, so staying put.",
    });
    // Stay on Mashahd visually (no sibling mounted here).
    setActive("mashahd");
  };

  return (
    <div
      className="hidden lg:flex flex-col items-center gap-1 py-3 w-16 shrink-0 glass border-r border-gold/15 h-[calc(100vh-3.5rem)] sticky top-14 z-20"
      aria-label="Super-app modules"
    >
      {MODULES.map((m) => {
        const Icon = m.icon;
        const isActive = m.id === active;
        const isHovered = m.id === hovered;
        return (
          <button
            key={m.id}
            onClick={() => switchTo(m.id)}
            onMouseEnter={() => setHovered(m.id)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              "relative group flex flex-col items-center justify-center gap-1 w-12 h-14 rounded-xl transition-all",
              isActive
                ? "bg-gradient-gold text-charcoal shadow-soft"
                : "text-muted-foreground hover:bg-gold/10 hover:text-foreground"
            )}
            aria-label={`${m.label} (${m.arabic})`}
            aria-pressed={isActive}
          >
            <Icon className={cn("h-5 w-5", isActive ? "text-charcoal" : m.tint)} />
            <span className="text-[9px] font-semibold tracking-wide leading-none">
              {m.label}
            </span>
            {/* Tooltip on hover */}
            {isHovered && !isActive && (
              <span className="absolute left-full ml-2 px-2 py-1 rounded-md bg-popover text-popover-foreground text-xs whitespace-nowrap shadow-glass border border-border z-50 pointer-events-none">
                {m.label} <span className="font-arabic">{m.arabic}</span>
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto">
        <button
          className="flex flex-col items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:bg-gold/10 hover:text-foreground transition-all"
          aria-label="More modules"
          onClick={() => toast.info("More modules coming soon")}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
