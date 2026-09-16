"use client";

import { useState } from "react";
import { Scissors, Loader2, Check, X, Share2, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAvatar } from "@/hooks/use-avatar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Clip {
  id: string;
  videoId: string;
  creatorName: string;
  title: string;
  startSec: number;
  endSec: number;
  note: string;
  views: number;
  createdAt: string;
}

/**
 * ClipDialog — lets the viewer create a short clip (5-120s segment) of the
 * current video. The clip start/end default to ±10s around the current
 * playback position, adjustable via sliders. After creation, the clip gets
 * a shareable permalink.
 */
export function ClipDialog({
  open,
  onClose,
  videoId,
  currentTime,
  duration,
  onSeek,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const bid = useBrowserId();
  const { avatar, name } = useAvatar();
  const qc = useQueryClient();

  // Default clip = ±10s around current time, clamped to [0, duration].
  // Initial state derived from props; reset via the `open` key when the
  // dialog re-opens (see the <Dialog> wrapper below).
  const [start, setStart] = useState(() => Math.max(0, Math.floor(currentTime) - 10));
  const [end, setEnd] = useState(() => Math.min(duration, Math.floor(currentTime) + 10));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Existing clips for this video.
  const { data: existingClips } = useQuery({
    queryKey: ["clips", videoId],
    queryFn: async () => {
      const r = await fetch(`/api/clips?videoId=${videoId}`);
      if (!r.ok) return [];
      return (await r.json()).clips as Clip[];
    },
    enabled: !!videoId && open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          creatorId: bid,
          creatorName: name,
          title: title.trim(),
          startSec: start,
          endSec: end,
          note: note.trim(),
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "failed");
      }
      return (await r.json()).clip as Clip;
    },
    onSuccess: (clip) => {
      setCreatedId(clip.id);
      qc.invalidateQueries({ queryKey: ["clips", videoId] });
      toast.success("Clip created!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyLink = () => {
    if (!createdId) return;
    const url = `${window.location.origin}/?v=watch&id=${videoId}&clip=${createdId}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Clip link copied")).catch(() => toast.error("Couldn't copy link"));
  };

  const clipLen = end - start;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) {
        // Reset form on close.
        setTitle("");
        setNote("");
        setCreatedId(null);
        onClose();
      }
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-full bg-gradient-to-br from-rose/20 to-transparent border border-rose/30">
              <Scissors className="h-4 w-4 text-rose" />
            </span>
            Create a clip
          </DialogTitle>
          <DialogDescription>
            Share the best moment of this video as a short clip (5–120s).
          </DialogDescription>
        </DialogHeader>

        {!createdId ? (
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="clip-title" className="text-xs text-muted-foreground">
                Clip title
              </Label>
              <Input
                id="clip-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The plot twist everyone missed"
                maxLength={120}
                autoFocus
              />
            </div>

            {/* Start / End sliders */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Start</span>
                  <span className="font-mono tabular-nums text-foreground">{fmt(start)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration - 5}
                  value={start}
                  onChange={(e) => {
                    const v = Math.min(Number(e.target.value), end - 5);
                    setStart(v);
                    onSeek(v);
                  }}
                  className="w-full accent-[hsl(var(--gold))]"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>End</span>
                  <span className="font-mono tabular-nums text-foreground">{fmt(end)}</span>
                </div>
                <input
                  type="range"
                  min={start + 5}
                  max={duration}
                  value={end}
                  onChange={(e) => {
                    const v = Math.max(Number(e.target.value), start + 5);
                    setEnd(v);
                  }}
                  className="w-full accent-[hsl(var(--gold))]"
                />
              </div>
              <div className="text-center text-xs text-muted-foreground">
                Clip length: <span className="font-mono text-foreground">{clipLen}s</span>
                {clipLen < 5 && <span className="text-rose-500"> (min 5s)</span>}
                {clipLen > 120 && <span className="text-rose-500"> (max 120s)</span>}
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label htmlFor="clip-note" className="text-xs text-muted-foreground">
                Note (optional)
              </Label>
              <Input
                id="clip-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why is this moment worth sharing?"
                maxLength={300}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={onClose}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  !title.trim() ||
                  clipLen < 5 ||
                  clipLen > 120 ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Scissors className="h-4 w-4 mr-1" />
                )}
                Create clip
              </Button>
            </div>

            {/* Existing clips */}
            {existingClips && existingClips.length > 0 && (
              <div className="pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">
                  {existingClips.length} clip{existingClips.length === 1 ? "" : "s"} already created
                </p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {existingClips.slice(0, 5).map((c) => (
                    <li key={c.id} className="text-xs flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-accent/40">
                      <span className="truncate flex-1">{c.title}</span>
                      <span className="text-muted-foreground font-mono tabular-nums">{c.startSec}s–{c.endSec}s</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          // Success state
          <div className="text-center py-4">
            <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-gradient-to-br from-rose/20 to-transparent border border-rose/40 mb-4">
              <Check className="h-7 w-7 text-rose" />
            </div>
            <h3 className="text-lg font-semibold">Clip created!</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Share it with this link:
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <code className="text-xs flex-1 truncate">/?v=watch&id={videoId}&clip={createdId}</code>
            </div>
            <div className="flex gap-2 justify-center mt-5">
              <Button variant="outline" onClick={copyLink}>
                <Share2 className="h-4 w-4 mr-1" /> Copy link
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
