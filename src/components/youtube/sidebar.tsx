"use client";

import { Home, Flame, ListVideo, Clock, ThumbsUp, Library, Radio, Music2, Gamepad2, Newspaper, Trophy, GraduationCap, Shirt, Settings, Flag, HelpCircle, MessageSquare, ThumbsDown } from "lucide-react";
import { useAppStore, View } from "@/store/app-store";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view?: View;
  sub?: boolean;
};

const mainNav: NavItem[] = [
  { label: "Home", icon: Home, view: { kind: "home" } },
  { label: "Trending", icon: Flame, view: { kind: "trending" } },
  { label: "Subscriptions", icon: ListVideo, view: { kind: "subscriptions" } },
];

const youNav: NavItem[] = [
  { label: "Library", icon: Library, view: { kind: "library" } },
  { label: "History", icon: Clock, view: { kind: "history" } },
  { label: "Liked videos", icon: ThumbsUp, view: { kind: "liked" } },
];

const exploreNav: NavItem[] = [
  { label: "Live", icon: Radio },
  { label: "Music", icon: Music2 },
  { label: "Gaming", icon: Gamepad2 },
  { label: "News", icon: Newspaper },
  { label: "Sports", icon: Trophy },
  { label: "Learning", icon: GraduationCap },
  { label: "Fashion & beauty", icon: Shirt },
];

const settingsNav: NavItem[] = [
  { label: "Settings", icon: Settings },
  { label: "Report history", icon: Flag },
  { label: "Help", icon: HelpCircle },
  { label: "Send feedback", icon: MessageSquare },
];

function NavSection({
  items,
  title,
  onItemClick,
}: {
  items: NavItem[];
  title?: string;
  onItemClick?: () => void;
}) {
  const { view, navigate } = useAppStore();
  return (
    <div className="px-2 py-2">
      {title && (
        <h3 className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.view && view.kind === item.view.kind;
        return (
          <button
            key={item.label}
            onClick={() => {
              if (item.view) {
                navigate(item.view);
                onItemClick?.();
              }
            }}
            className={cn(
              "flex items-center gap-5 w-full px-3 py-2.5 rounded-lg text-sm text-left transition-colors",
              active
                ? "bg-accent font-medium"
                : "hover:bg-accent/60"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="h-full overflow-y-auto py-2 custom-scroll">
      <NavSection items={mainNav} onItemClick={onNavigate} />
      <div className="border-t border-border my-1 mx-3" />
      <NavSection title="You" items={youNav} onItemClick={onNavigate} />
      <div className="border-t border-border my-1 mx-3" />
      <NavSection title="Explore" items={exploreNav} onItemClick={onNavigate} />
      <div className="border-t border-border my-1 mx-3" />
      <NavSection items={settingsNav} onItemClick={onNavigate} />

      <div className="px-5 py-4 text-xs text-muted-foreground space-y-2">
        <p>© 2025 Mashahd — مشاهِد</p>
        <p>
          Brand mark &amp; AI concepts adapted from CIRKLE (دواير). All videos,
          channels and comments shown here are demo content.
        </p>
      </div>
    </nav>
  );
}
