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
    <div className="sticky top-14 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex gap-3 overflow-x-auto py-3 px-4 sm:px-6 custom-scroll-x">
        {CATEGORIES.map((c) => {
          const isActive = c === active;
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "bg-foreground text-background"
                  : "bg-muted/70 text-foreground hover:bg-muted"
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
