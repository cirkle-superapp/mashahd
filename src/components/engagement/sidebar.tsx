"use client";

/**
 * @deprecated — Dead code (UI audit 2026-09). The app uses `Dock` (bottom
 * floating glass navigation) instead of this left sidebar. Kept here per the
 * "nothing deleted or removed" directive — do NOT mount in production.
 * If reviving, update the `MORE_LINKS` arrays to match `dock.tsx`.
 */

import { Home, Flame, ListVideo, Clock, ThumbsUp, Library, Radio, Music2, Gamepad2, Newspaper, Trophy, GraduationCap, Plane, UtensilsCrossed, Dumbbell, Cpu, FlaskConical, Palette, Car, Leaf, Settings, Flag, HelpCircle, MessageSquare } from "lucide-react";
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
  { label: "Live", icon: Radio, view: { kind: "category", category: "Live" } },
  { label: "Music", icon: Music2, view: { kind: "category", category: "Music" } },
  { label: "Gaming", icon: Gamepad2, view: { kind: "category", category: "Gaming" } },
  { label: "News", icon: Newspaper, view: { kind: "category", category: "News" } },
  { label: "Sports", icon: Trophy, view: { kind: "category", category: "Sports" } },
  { label: "Learning", icon: GraduationCap, view: { kind: "category", category: "Learning" } },
  { label: "Travel", icon: Plane, view: { kind: "category", category: "Travel" } },
  { label: "Cooking", icon: UtensilsCrossed, view: { kind: "category", category: "Cooking" } },
  { label: "Fitness", icon: Dumbbell, view: { kind: "category", category: "Fitness" } },
  { label: "Tech", icon: Cpu, view: { kind: "category", category: "Tech" } },
  { label: "Science", icon: FlaskConical, view: { kind: "category", category: "Science" } },
  { label: "Nature", icon: Leaf, view: { kind: "category", category: "Nature" } },
  { label: "Art", icon: Palette, view: { kind: "category", category: "Art" } },
  { label: "Cars", icon: Car, view: { kind: "category", category: "Cars" } },
];

const settingsNav: NavItem[] = [
  { label: "Settings", icon: Settings, view: { kind: "settings", tab: "general" } },
  { label: "Report history", icon: Flag, view: { kind: "settings", tab: "report" } },
  { label: "Help", icon: HelpCircle, view: { kind: "settings", tab: "help" } },
  { label: "Send feedback", icon: MessageSquare, view: { kind: "settings", tab: "feedback" } },
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
        const active =
          item.view &&
          (item.view.kind === "category" && view.kind === "category"
            ? (view as { kind: "category"; category: string }).category === item.view.category
            : item.view.kind === "settings" && view.kind === "settings"
            ? (view as { kind: "settings"; tab?: string }).tab === (item.view as { kind: "settings"; tab?: string }).tab
            : view.kind === item.view.kind);
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
