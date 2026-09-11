"use client";

import { useEffect } from "react";
import {
  Home,
  Flame,
  ListVideo,
  Clock,
  ThumbsUp,
  Library,
  Search as SearchIcon,
  Sparkles,
  ListVideo as ChaptersIcon,
  Languages,
  Activity,
  Sun,
  Moon,
  CornerDownLeft,
  MessageSquarePlus,
  Compass,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useCommandPalette } from "@/store/command-palette-store";
import { useAppStore, View } from "@/store/app-store";
import { useTheme } from "next-themes";
import { toast } from "sonner";

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Navigate" | "Quick Actions" | "AI Features";
  run: () => void;
  keywords?: string;
};

/**
 * CommandPalette — ⌘K launcher (adapted from CIRKLE's command-palette.tsx).
 *
 * Lets the user jump to any view, toggle theme, or trigger AI features
 * (summarize, chapters, translate, pulse) all from one keyboard-driven
 * overlay. Tracks recent commands in localStorage.
 */
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const close = useCommandPalette((s) => s.close);
  const { navigate, setSearchDraft } = useAppStore();
  const { theme, setTheme } = useTheme();

  // Global ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useCommandPalette.getState().toggle();
      }
      if (e.key === "Escape" && useCommandPalette.getState().open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const go = (v: View) => {
    navigate(v);
    close();
  };

  const items: Item[] = [
    // Navigate
    { id: "nav-home", label: "Home", icon: Home, group: "Navigate", run: () => go({ kind: "home" }), keywords: "feed browse" },
    { id: "nav-trending", label: "Trending", icon: Flame, group: "Navigate", run: () => go({ kind: "trending" }), keywords: "popular hot" },
    { id: "nav-subs", label: "Subscriptions", icon: ListVideo, group: "Navigate", run: () => go({ kind: "subscriptions" }), keywords: "following" },
    { id: "nav-history", label: "History", icon: Clock, group: "Navigate", run: () => go({ kind: "history" }) },
    { id: "nav-liked", label: "Liked videos", icon: ThumbsUp, group: "Navigate", run: () => go({ kind: "liked" }) },
    { id: "nav-library", label: "Library", icon: Library, group: "Navigate", run: () => go({ kind: "library" }) },

    // Quick actions
    {
      id: "qa-search",
      label: "Search videos…",
      hint: "then type",
      icon: SearchIcon,
      group: "Quick Actions",
      run: () => {
        close();
        // focus the header search input
        setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>(
            'input[aria-label="Search"]'
          );
          el?.focus();
        }, 60);
      },
      keywords: "find",
    },
    {
      id: "qa-theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? Sun : Moon,
      group: "Quick Actions",
      run: () => {
        setTheme(theme === "dark" ? "light" : "dark");
        close();
      },
      keywords: "appearance toggle",
    },
    {
      id: "qa-seed",
      label: "Reload demo data",
      hint: "re-seed DB",
      icon: Activity,
      group: "Quick Actions",
      run: async () => {
        close();
        toast.promise(
          fetch("/api/seed", { method: "POST" }).then((r) => r.json()),
          { loading: "Re-seeding…", success: "Demo data reloaded", error: "Seed failed" }
        );
        setTimeout(() => window.location.reload(), 900);
      },
      keywords: "reset seed demo",
    },

    // AI features (deep-link to current watch video if any)
    {
      id: "ai-summarize",
      label: "Summarize current video",
      hint: "AI Recap",
      icon: Sparkles,
      group: "AI Features",
      run: () => triggerAi("summarize", close),
      keywords: "recap tldr summary",
    },
    {
      id: "ai-chapters",
      label: "Generate smart chapters",
      icon: ChaptersIcon,
      group: "AI Features",
      run: () => triggerAi("chapters", close),
      keywords: "segments timeline",
    },
    {
      id: "ai-translate",
      label: "Translate comments",
      hint: "Live Translate",
      icon: Languages,
      group: "AI Features",
      run: () => triggerAi("translate", close),
      keywords: "language arabic english",
    },
    {
      id: "ai-starters",
      label: "Comment starters",
      hint: "AI Starters",
      icon: MessageSquarePlus,
      group: "AI Features",
      run: () => triggerWatch(close, "starters"),
      keywords: "suggest comment conversation",
    },
    {
      id: "ai-oracle",
      label: "Ask the Oracle about this video",
      hint: "Oracle",
      icon: Compass,
      group: "AI Features",
      run: () => triggerWatch(close, "oracle"),
      keywords: "question ask answer",
    },
    {
      id: "ai-tone",
      label: "Rewrite my comment in a different tone",
      hint: "Tone",
      icon: Wand2,
      group: "AI Features",
      run: () => triggerWatch(close, "tone"),
      keywords: "rewrite friendly witty formal",
    },
  ];

  const grouped: Record<Item["group"], Item[]> = {
    Navigate: [],
    "Quick Actions": [],
    "AI Features": [],
  };
  for (const it of items) grouped[it.group].push(it);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) useCommandPalette.getState().close();
      }}
    >
      <DialogContent className="overflow-hidden p-0 max-w-2xl">
        {/* Visually-hidden title/description for screen readers (Radix
            requires a DialogTitle inside DialogContent). */}
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search views, actions and AI features.
        </DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12">
          <CommandInput placeholder="Search views, actions, AI features…" />
          <CommandList className="custom-scroll max-h-[60vh]">
            <CommandEmpty>No results.</CommandEmpty>
            {(Object.keys(grouped) as Item["group"][]).map((g, idx) =>
              grouped[g].length === 0 ? null : (
                <div key={g}>
                  {idx > 0 && <CommandSeparator />}
                  <CommandGroup heading={g}>
                    {grouped[g].map((it) => {
                      const Icon = it.icon;
                      return (
                        <CommandItem
                          key={it.id}
                          value={`${it.label} ${it.keywords || ""}`}
                          onSelect={() => it.run()}
                          className="group"
                        >
                          <Icon className="mr-2 h-4 w-4 text-muted-foreground group-aria-selected:text-foreground" />
                          <span className="flex-1">{it.label}</span>
                          {it.hint && (
                            <span className="text-xs text-muted-foreground">{it.hint}</span>
                          )}
                          <CornerDownLeft className="ml-2 h-3 w-3 opacity-0 group-aria-selected:opacity-100 text-muted-foreground" />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </div>
              )
            )}
            <CommandSeparator />
            <CommandGroup heading="Tips">
              <div className="px-2 py-3 text-xs text-muted-foreground space-y-1">
                <p>Press <kbd className="rounded bg-muted px-1 py-0.5">⌘K</kbd> / <kbd className="rounded bg-muted px-1 py-0.5">Ctrl K</kbd> to open this palette anywhere.</p>
                <p>AI features act on the video you&apos;re currently watching.</p>
              </div>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** Fire a window CustomEvent the watch page listens for. */
function triggerAi(feature: "summarize" | "chapters" | "translate", close: () => void) {
  const view = useAppStore.getState().view;
  if (view.kind !== "watch") {
    toast.error("Open a video first", {
      description: `${feature === "summarize" ? "AI Recap" : feature === "chapters" ? "Smart Chapters" : "Live Translate"} needs an active video.`,
    });
    return;
  }
  window.dispatchEvent(new CustomEvent(`mashahd:ai-${feature}`, { detail: { videoId: view.videoId } }));
  close();
}

/** Open the AI Watch panel on a specific tab (starters / oracle / tone). */
function triggerWatch(close: () => void, tab: "starters" | "oracle" | "tone") {
  const view = useAppStore.getState().view;
  if (view.kind !== "watch") {
    toast.error("Open a video first", {
      description: "AI Starters, Oracle, and Tone need an active video.",
    });
    return;
  }
  window.dispatchEvent(new CustomEvent("mashahd:ai-watch", { detail: { tab } }));
  close();
}
