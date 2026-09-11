"use client";

import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CategoryChips({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (c: string) => void;
}) {
  return (
    <div className="sticky top-14 z-30 glass border-b border-border/60">
      <div className="flex gap-2.5 overflow-x-auto py-3 px-4 sm:px-6 custom-scroll-x">
        {CATEGORIES.map((c) => {
          const isActive = c === active;
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                isActive
                  ? "bg-gradient-gold text-charcoal shadow-soft"
                  : "brand-chip"
              )}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
