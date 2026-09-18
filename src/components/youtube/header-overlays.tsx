"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Video as VideoIcon, X, Upload, Link2, Check, Twitter, Facebook, Mail, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { timeAgo } from "@/lib/format";

/* ────────────────────────────────────────────────────────────────────────
 * Notifications dropdown — the bell icon in the header opens a popover with
 * a feed of recent activity (new uploads, comment replies, AI recaps ready).
 *
 * Pass 4 upgrade: now wired to the real /api/notifications endpoint (was
 * hardcoded SAMPLE_NOTIFS mock). Uses React Query for caching + the signed
 * browserId as the recipientId.
 * ──────────────────────────────────────────────────────────────────────── */

type Notif = {
  id: string;
  type: string; // new_video | new_comment | new_subscriber | tip_received | system | mention
  read: boolean;
  createdAt: string;
  title: string;
  body: string;
  linkUrl?: string;
  actorAvatarUrl?: string;
  actorName?: string;
  thumbnailUrl?: string;
};

async function fetchNotifications(bid: string): Promise<{ notifications: Notif[]; unreadCount: number }> {
  if (!bid) return { notifications: [], unreadCount: 0 };
  const res = await fetch(`/api/notifications?bid=${encodeURIComponent(bid)}&limit=20`);
  if (!res.ok) return { notifications: [], unreadCount: 0 };
  const data = await res.json();
  return {
    notifications: (data.notifications || []).map((n: any) => ({
      id: n.id,
      type: n.type,
      read: n.read,
      createdAt: n.createdAt,
      title: n.title || "",
      body: n.body || "",
      linkUrl: n.linkUrl,
      actorAvatarUrl: n.actorAvatarUrl,
      actorName: n.actorName,
      thumbnailUrl: n.thumbnailUrl,
    })),
    unreadCount: data.unreadCount || 0,
  };
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications", bid],
    queryFn: () => fetchNotifications(bid),
    enabled: !!bid,
    staleTime: 30_000, // refresh every 30s when stale
  });

  const notifs = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!bid) return;
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action: "markAllRead" }),
      });
    },
    onSuccess: () => {
      qc.setQueryData(["notifications", bid], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          notifications: old.notifications.map((n: Notif) => ({ ...n, read: true })),
          unreadCount: 0,
        };
      });
    },
  });

  const markRead = useCallback((id: string) => {
    if (!bid) return;
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserId: bid, action: "markRead", notificationId: id }),
    }).catch(() => {});
    qc.setQueryData(["notifications", bid], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        notifications: old.notifications.map((n: Notif) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, (old.unreadCount || 0) - 1),
      };
    });
  }, [bid, qc]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full hover:bg-gold/10 relative"
        aria-label="Notifications"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-1 min-w-4 h-4 px-1 bg-gold text-charcoal text-[9px] font-bold rounded-full grid place-items-center">
            {unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-12 w-[min(92vw,380px)] glass-strong rounded-2xl shadow-float border border-gold/15 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto custom-scroll">
            {notifs.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" aria-hidden />
                <p>You&apos;re all caught up.</p>
                <p className="text-xs mt-1 opacity-70">New activity will appear here.</p>
              </div>
            ) : (
              notifs.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    // Navigate if there's a linkUrl with a video id.
                    if (n.linkUrl) {
                      const match = n.linkUrl.match(/[?&]id=([^&]+)/);
                      if (match) navigate({ kind: "watch", videoId: match[1] });
                    }
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex gap-3 px-4 py-3 hover:bg-gold/5 text-left transition-colors border-b border-border/40 last:border-0",
                    !n.read && "bg-gold/5"
                  )}
                >
                  <Avatar className="h-9 w-9 rounded-full shrink-0">
                    <AvatarImage src={n.actorAvatarUrl || ""} alt="" />
                    <AvatarFallback>{(n.actorName || "M").slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{n.actorName || "Mashahd"}</span>{" "}
                      <span className="text-muted-foreground">{n.body}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {n.createdAt ? timeAgo(new Date(n.createdAt)) : ""}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="self-center h-2 w-2 rounded-full bg-gold shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t border-border text-center">
            <button
              onClick={() => {
                setOpen(false);
                navigate({ kind: "settings", tab: "notifications" });
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Manage notification settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Create / Upload modal — the video icon in the header opens a dialog with
 * a (cosmetic) upload form. A real upload would POST to /api/videos.
 * ──────────────────────────────────────────────────────────────────────── */

export function CreateButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("Tech");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDesc("");
    setCategory("Tech");
    setFileName(null);
    setDragging(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full hover:bg-gold/10 hidden sm:inline-flex"
        aria-label="Create"
        title="Upload a video"
        onClick={() => setOpen(true)}
      >
        <VideoIcon className="h-5 w-5" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogTitle>Upload a video</DialogTitle>
          <DialogDescription>
            Share a video with the Mashahd community. This is a demo upload —
            nothing is actually stored.
          </DialogDescription>

          {/* Drop zone */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFileName(f.name);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors",
              dragging
                ? "border-gold bg-gold/10"
                : "border-border hover:border-gold/50 hover:bg-gold/5",
            )}
          >
            <Upload className="h-8 w-8 text-gold" />
            {fileName ? (
              <p className="text-sm font-medium">{fileName}</p>
            ) : (
              <>
                <p className="text-sm font-medium">Drag &amp; drop a video file</p>
                <p className="text-xs text-muted-foreground">or click to browse — MP4, WebM up to 2GB</p>
              </>
            )}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFileName(f.name);
              }}
            />
          </label>

          {/* Title */}
          <div>
            <label htmlFor="upload-video-title" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Title (required)
            </label>
            <input
              id="upload-video-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your video a compelling title"
              aria-label="Video title"
              maxLength={100}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="upload-video-description" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </label>
            <textarea
              id="upload-video-description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Tell viewers about your video"
              aria-label="Video description"
              rows={3}
              maxLength={1000}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60 resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="upload-video-category" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Category
            </label>
            <select
              id="upload-video-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Video category"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            >
              {["Tech", "Music", "Gaming", "Cooking", "Travel", "Fitness", "Art", "Science", "Nature", "Cars"].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                )
              )}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!title.trim() || !fileName}
              onClick={() => {
                toast.success("Upload queued (demo)", {
                  description: `“${title}” would be published to ${category}.`,
                });
                setOpen(false);
                reset();
              }}
            >
              Publish
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Share dialog — the Share button on the watch page opens a modal with
 * copy-link + social share buttons. Wired to the actual video URL.
 * ──────────────────────────────────────────────────────────────────────── */

export function ShareButton({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bid = useBrowserId();
  // Build the share URL safely — use a state + effect to avoid hydration
  // mismatch (server renders a relative URL, client renders the full origin).
  const [url, setUrl] = useState<string>(`/?v=watch&id=${videoId}`);
  useEffect(() => {
    setUrl(`${window.location.origin}/?v=watch&id=${videoId}`);
  }, [videoId]);

  // Pass 4 upgrade: record share events to /api/videos/[id]/share so we can
  // track virality + power recommendations. Fire-and-forget (non-blocking).
  const recordShare = (platform: string) => {
    fetch(`/api/videos/${videoId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserId: bid, platform }),
    }).catch(() => {/* non-critical */});
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      recordShare("copy_link");
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  const socials: { label: string; icon: React.ComponentType<{ className?: string }>; tint: string; href: string; platform: string }[] = [
    { label: "Twitter", icon: Twitter, tint: "hover:bg-sky-500/10 hover:text-sky-500", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, platform: "twitter" },
    { label: "Facebook", icon: Facebook, tint: "hover:bg-blue-600/10 hover:text-blue-600", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, platform: "facebook" },
    { label: "Email", icon: Mail, tint: "hover:bg-rose-500/10 hover:text-rose-500", href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`, platform: "email" },
  ];

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="rounded-full h-9 px-4 bg-surface hover:bg-gold/10 border border-border text-foreground"
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-4 w-4 mr-1.5" /> Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Share video</DialogTitle>
          <DialogDescription>{title}</DialogDescription>

          {/* Copy link */}
          <div className="flex items-center gap-2 mt-2">
            <input
              readOnly
              value={url}
              aria-label="Share URL"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gold/60"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-4"
              onClick={copy}
            >
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          {/* Social row */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {socials.map((s) => {
              const Icon = s.icon;
              return (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => recordShare(s.platform)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 py-3 rounded-xl border border-border bg-surface transition-colors",
                    s.tint
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-xs">{s.label}</span>
                </a>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
