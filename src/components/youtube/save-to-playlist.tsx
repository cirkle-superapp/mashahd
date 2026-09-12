"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ListMusic, Check, Loader2, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBrowserId } from "@/hooks/use-browser-id";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Playlist {
  id: string;
  title: string;
  visibility: string;
  itemCount: number;
}

/**
 * SaveToPlaylist — a dialog that lets the user save a video to one of their
 * existing playlists, or create a new playlist and add to it. Triggered from
 * the VideoCard hover menu, the watch page action row, and the command
 * palette.
 *
 * Opens when the `open` prop is true. Calls `onClose` when dismissed.
 */
export function SaveToPlaylist({
  open,
  onClose,
  videoId,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
}) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newVis, setNewVis] = useState<"public" | "private" | "unlisted">("public");

  // Load the caller's playlists.
  const { data, isLoading } = useQuery({
    queryKey: ["playlists", bid],
    queryFn: async () => {
      const r = await fetch(`/api/playlists?bid=${encodeURIComponent(bid)}`);
      if (!r.ok) throw new Error("failed");
      return (await r.json()).playlists as Playlist[];
    },
    enabled: !!bid && open,
  });

  // Add to playlist (idempotent — returns 200 with alreadyExists=true if dup).
  const addMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      const r = await fetch(`/api/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, videoId }),
      });
      if (!r.ok) throw new Error("failed");
      return { playlistId, ...(await r.json()) };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["playlists", bid] });
      if (res.alreadyExists) {
        toast.info("Already in this playlist");
      } else {
        toast.success("Added to playlist");
      }
      onClose();
    },
    onError: () => toast.error("Could not add to playlist"),
  });

  // Create + add in one shot.
  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, title: newTitle.trim(), visibility: newVis }),
      });
      if (!r.ok) throw new Error("failed");
      const { playlist } = await r.json();
      const r2 = await fetch(`/api/playlists/${playlist.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, videoId }),
      });
      if (!r2.ok) throw new Error("failed");
      return playlist;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists", bid] });
      toast.success(`Created "${newTitle.trim()}" and added the video`);
      setCreating(false);
      setNewTitle("");
      onClose();
    },
    onError: () => toast.error("Could not create playlist"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-gold" />
            Save to playlist
          </DialogTitle>
          <DialogDescription>
            Add this video to one of your playlists, or create a new one.
          </DialogDescription>
        </DialogHeader>

        {!creating ? (
          <div className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : data && data.length > 0 ? (
              <ul className="space-y-1 max-h-72 overflow-y-auto">
                {data.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => addMutation.mutate(p.id)}
                      disabled={addMutation.isPending}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                        "hover:bg-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{p.title}</span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {p.itemCount} video{p.itemCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                You don&apos;t have any playlists yet.
              </p>
            )}

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create new playlist
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pl-title">Playlist name</Label>
              <Input
                id="pl-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Weekend watches"
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select value={newVis} onValueChange={(v) => setNewVis(v as typeof newVis)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can find it</SelectItem>
                  <SelectItem value="unlisted">Unlisted — only with the link</SelectItem>
                  <SelectItem value="private">Private — only you</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                disabled={!newTitle.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Create &amp; add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
