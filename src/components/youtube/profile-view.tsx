"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, ThumbsUp, ListVideo, Settings, Bell, Shield, LogOut, ChevronRight, Sparkles, Radio, UserPlus, Camera, LogIn, CheckCircle2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAvatar } from "@/hooks/use-avatar";
import { useAuth } from "@/hooks/use-auth";
import { MashahdMark } from "@/components/brand/mashahd-logo";
import { AvatarPicker } from "./avatar-picker";
import { AuthScreen } from "./auth-screen";
import { PastStreams } from "./past-streams";
import { toast } from "sonner";
import { useState } from "react";

async function fetchUserState(bid: string) {
  if (!bid) return { likedVideoIds: [], subscribedChannelIds: [], watchedVideoIds: [] };
  const res = await fetch(`/api/user-state?bid=${bid}`);
  if (!res.ok) throw new Error("failed");
  return res.json();
}

/**
 * ProfileView — the user's own profile. Shows their avatar, a "Your activity"
 * summary (watch history, liked, subscriptions counts), and quick links to
 * settings, notifications, and privacy.
 *
 * This is the screen the header avatar navigates to.
 */
export function ProfileView() {
  const bid = useBrowserId();
  const { navigate } = useAppStore();
  const { avatar, name } = useAvatar();
  const { user, logout } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });

  // If not authenticated, show a sign-in prompt + any past streams the
  // anonymous browserId has broadcast (going live doesn't require signup,
  // so a user can have past streams even without an account).
  if (!user) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <div className="relative rounded-2xl overflow-hidden border border-gold/20 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent p-8 text-center">
          <div className="absolute inset-0 aurora-bg opacity-30" aria-hidden />
          <div className="relative">
            <MashahdMark size={48} className="mx-auto mb-4" />
            <h1 className="text-2xl font-bold font-display mb-2">Welcome to Mashahd</h1>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Sign in or create an account to sync your favorites, history,
              and subscriptions across devices, and to start creating.
            </p>
            <Button
              onClick={() => setAuthOpen(true)}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-6"
            >
              <LogIn className="h-4 w-4 mr-1.5" />
              Sign in or create account
            </Button>
          </div>
        </div>
        {/* Past streams — visible even without auth, since going live
            only requires a signed browserId (anonymous identity). */}
        <PastStreams />
        <AuthScreen open={authOpen} onOpenChange={setAuthOpen} />
      </div>
    );
  }

  const displayName = user.displayName || name;
  const displayAvatar = user.avatarUrl || avatar;
  const liked = data?.likedVideoIds?.length || 0;
  const subs = data?.subscribedChannelIds?.length || 0;
  const history = data?.watchedVideoIds?.length || 0;

  const stats = [
    { label: "Watch history", value: history, icon: Clock, view: { kind: "history" as const } },
    { label: "Liked videos", value: liked, icon: ThumbsUp, view: { kind: "liked" as const } },
    { label: "Subscriptions", value: subs, icon: ListVideo, view: { kind: "subscriptions" as const } },
  ];

  const links = [
    { label: "Settings", icon: Settings, view: { kind: "settings" as const, tab: "general" } },
    { label: "Notifications", icon: Bell, view: { kind: "settings" as const, tab: "notifications" } },
    { label: "Privacy", icon: Shield, view: { kind: "settings" as const, tab: "privacy" } },
  ];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      {/* Profile header */}
      <div className="relative rounded-2xl overflow-hidden border border-gold/20 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent p-6 sm:p-8">
        <div className="absolute inset-0 aurora-bg opacity-30" aria-hidden />
        <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <button
            onClick={() => setPickerOpen(true)}
            className="relative group shrink-0"
            aria-label="Change profile picture"
            title="Change profile picture"
          >
            <img
              src={displayAvatar}
              alt={displayName}
              className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover border-4 border-background shadow-float"
            />
            <span className="absolute bottom-1 right-1 grid place-items-center h-8 w-8 rounded-full bg-gradient-gold text-charcoal shadow-glass border-2 border-background group-hover:scale-110 transition-transform">
              <Camera className="h-4 w-4" />
            </span>
          </button>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold font-display flex items-center gap-2 justify-center sm:justify-start">
              {displayName}
              {user.verified && <CheckCircle2 className="h-5 w-5 text-[hsl(var(--gold))]" />}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              @{user.username} · Mashahd member
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {user.email || user.phone}
            </p>
            <button
              onClick={() => setPickerOpen(true)}
              className="mt-2 text-xs text-[hsl(var(--gold))] hover:underline font-medium"
            >
              Change picture
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              Your history, likes, subscriptions, and favorites are synced to your account.
            </p>
          </div>
          <MashahdMark size={36} className="opacity-40 hidden sm:block" />
        </div>
      </div>

      {/* Avatar picker dialog */}
      <AvatarPicker open={pickerOpen} onOpenChange={setPickerOpen} />

      {/* Creator actions — Go Live + Create Channel */}
      <section className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("mashahd:go-live"))}
          className="flex items-center gap-3 p-4 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors text-left shadow-soft"
        >
          <span className="grid place-items-center h-10 w-10 rounded-full bg-white/20">
            <Radio className="h-5 w-5 fill-current" />
          </span>
          <div>
            <p className="text-sm font-semibold">Go Live</p>
            <p className="text-xs text-white/80">Start streaming in seconds</p>
          </div>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("mashahd:create-channel"))}
          className="flex items-center gap-3 p-4 rounded-xl border border-gold/30 bg-gradient-to-br from-[hsl(var(--gold)/0.1)] to-transparent hover:from-[hsl(var(--gold)/0.18)] transition-colors text-left"
        >
          <span className="grid place-items-center h-10 w-10 rounded-full bg-gradient-gold text-charcoal">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Create a channel</p>
            <p className="text-xs text-muted-foreground">Verify your ID to start publishing</p>
          </div>
        </button>
      </section>

      {/* Activity stats */}
      <section className="mt-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Your activity
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))
            : stats.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    onClick={() => navigate(s.view)}
                    className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
                  >
                    <span className="grid place-items-center h-10 w-10 rounded-full bg-[hsl(var(--gold)/0.1)] text-[hsl(var(--gold))]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-2xl font-bold tabular-nums leading-none">{s.value}</p>
                      <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                  </button>
                );
              })}
        </div>
      </section>

      {/* Quick links */}
      <section className="mt-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Account
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {links.map((l, i) => {
            const Icon = l.icon;
            return (
              <button
                key={l.label}
                onClick={() => navigate(l.view)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors ${
                  i < links.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm flex-1">{l.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </section>

      {/* AI summary callout */}
      {/* Past live streams — only shows if the user has broadcast
          at least one stream. Reads from the LiveStream table scoped
          to the user's signed browserId. */}
      <PastStreams />

      <section className="mt-6">
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent("mashahd:ai-watch"));
            toast.info("Open a video first to use AI features");
          }}
          className="w-full flex items-center gap-3 p-4 rounded-xl border border-gold/25 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent hover:from-[hsl(var(--gold)/0.14)] transition-colors text-left"
        >
          <span className="grid place-items-center h-10 w-10 rounded-full bg-gradient-gold text-charcoal">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Mashahd AI</p>
            <p className="text-xs text-muted-foreground">Recaps, smart chapters, comment starters, the Oracle, and tone rewrites.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </section>

      {/* Sign out */}
      <section className="mt-6">
        <Button
          variant="outline"
          className="w-full rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={async () => {
            await logout();
            toast.success("Signed out");
            navigate({ kind: "home" });
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </section>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Mashahd (مشاهِد) — the video pillar of the super-app.
      </p>
    </div>
  );
}
