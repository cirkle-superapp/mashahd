"use client";
import { useEffect } from "react";
import { Focus, X } from "lucide-react";
export function FocusMode({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); onToggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
  if (!enabled) {
    return (
      <button onClick={onToggle} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border border-border hover:bg-accent/50 transition-colors min-h-[40px]" aria-label="Enter Focus Mode" title="Focus Mode (F)">
        <Focus className="h-3.5 w-3.5" /> Focus
      </button>
    );
  }
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm transition-opacity duration-500" />
      <button onClick={onToggle} className="fixed top-4 right-4 z-50 flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full glass text-white hover:bg-white/15 transition-colors min-h-[40px]" aria-label="Exit Focus Mode" title="Exit Focus Mode (F)">
        <X className="h-3.5 w-3.5" /> Exit Focus
      </button>
    </>
  );
}
