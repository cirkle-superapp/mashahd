"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ListMusic,
  Play,
  Trash2,
  Share2,
  Loader2,
  ArrowLeft,
  Globe,
  Link2,
  Lock,
  MoreHorizontal,
  FolderPlus,
  Folder,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAppStore } from "@/store/app-store";
import { VideoCard } from "./video-card";
import { formatViews, timeAgo, getImageUrl } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type PlaylistVideo = {
  itemId: string;
  position: number;
  addedAt: string;
  video: {
    id: string;
    title: string;
    durationSec: number;
    views: number;
    thumbnailUrl: string;
    createdAt: string;
    channel: { id: string; name: string; handle: string; verified: boolean };
  };
};

type PlaylistData = {
  playlist: {
    id: string;
    title: string;
    description: string;
    visibility: string;
    coverUrl: string;
    createdAt: string;
    updatedAt: string;
    isOwner: boolean;
  };
  videos: PlaylistVideo[];
};

/**
 * PlaylistView — shows a single playlist's videos in order, with management
 * controls for the owner (remove, play all, share, delete playlist).
 */
export function PlaylistView({ playlistId }: { playlistId: string }) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const { navigate } = useAppStore();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["playlist", playlistId, bid],
    queryFn: async () => {
      const r = await fetch(`/api/playlists/${playlistId}?bid=${encodeURIComponent(bid)}`);
      if (!r.ok) throw new Error("failed");
      return (await r.json()) as PlaylistData;
    },
    enabled: !!playlistId,
  });

  const removeMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const r = await fetch(
        `/api/playlists/${playlistId}/items?itemId=${itemId}&browserId=${encodeURIComponent(bid)}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlist", playlistId, bid] });
      qc.invalidateQueries({ queryKey: ["playlists", bid] });
      toast.success("Removed from playlist");
    },
    onError: () => toast.error("Could not remove"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/playlists/${playlistId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid }),
      });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists", bid] });
      toast.success("Playlist deleted");
      navigate({ kind: "library" });
    },
    onError: () => toast.error("Could not delete playlist"),
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 sm:p-10 text-center">
        <ListMusic className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-semibold">Playlist not found</p>
        <p className="text-sm text-muted-foreground mt-1">
          It may have been deleted or made private.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate({ kind: "library" })}>
          Back to Library
        </Button>
      </div>
    );
  }

  const { playlist, videos } = data;
  const totalDuration = videos.reduce((acc, v) => acc + (v.video.durationSec || 0), 0);
  const visIcon =
    playlist.visibility === "public" ? Globe :
    playlist.visibility === "unlisted" ? Link2 : Lock;

  const playAll = () => {
    if (videos.length === 0) return;
    navigate({ kind: "watch", videoId: videos[0].video.id });
  };

  const sharePlaylist = () => {
    const url = `${window.location.origin}/?v=playlist&id=${playlist.id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Playlist link copied"),
      () => toast.error("Could not copy link")
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <Button variant="ghost" size="sm" className="mb-2" onClick={() => navigate({ kind: "library" })}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Library
      </Button>

      {/* Playlist header */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
        <div className="relative w-full sm:w-64 aspect-video rounded-xl overflow-hidden bg-muted shrink-0">
          {playlist.coverUrl || videos[0]?.video.thumbnailUrl ? (
            <img
              src={getImageUrl(playlist.coverUrl || videos[0]?.video.thumbnailUrl, playlist.title)}
              alt={playlist.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <ListMusic className="h-10 w-10" />
            </div>
          )}
          {videos.length > 0 && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-xs font-medium">
              {videos.length} video{videos.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(() => {
              const VisIcon = visIcon;
              return <VisIcon className="h-3.5 w-3.5" />;
            })()}
            <span className="capitalize">{playlist.visibility}</span>
            <span>·</span>
            <span>Updated {timeAgo(playlist.updatedAt)}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{playlist.title}</h1>
          {playlist.description && (
            <p className="text-sm text-muted-foreground">{playlist.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {videos.length} video{videos.length === 1 ? "" : "s"}
            {totalDuration > 0 && (
              <> · {Math.floor(totalDuration / 60)}m {totalDuration % 60}s total</>
            )}
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={playAll} disabled={videos.length === 0}>
              <Play className="h-4 w-4 mr-1 fill-current" />
              Play all
            </Button>
            <Button variant="outline" onClick={sharePlaylist}>
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
            {playlist.isOwner && (
              <Button
                variant="ghost"
                className="text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Folders — §29. The playlist-folders API exists for organizing the
          user's playlists into folders. We surface them here as a small
          horizontal chip row above the videos so the user can browse +
          create folders without leaving the playlist view. */}
      <PlaylistFolders bid={bid} />

      {/* Videos list */}
      {videos.length === 0 ? (
        <div className="text-center py-12">
          <ListMusic className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">No videos in this playlist yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            {playlist.isOwner
              ? "Browse videos and use the Save button to add them here."
              : "Check back later."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v, idx) => (
            <div key={v.itemId} className="relative group">
              <div className="absolute top-2 left-2 z-10 grid place-items-center h-6 w-6 rounded-full bg-black/70 text-white text-xs font-bold">
                {idx + 1}
              </div>
              <VideoCard
                video={{
                  ...v.video,
                  // Augment with playlist metadata for display
                  // (VideoCard already handles views + timeAgo)
                } as never}
              />
              {playlist.isOwner && (
                <button
                  onClick={() => removeMutation.mutate(v.itemId)}
                  disabled={removeMutation.isPending}
                  className="absolute top-2 right-2 z-10 grid place-items-center h-8 w-8 rounded-full bg-black/70 hover:bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  aria-label="Remove from playlist"
                  title="Remove from playlist"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={() => setConfirmDelete(false)}>
          <div className="glass-strong rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Delete this playlist?</h3>
            <p className="text-sm text-muted-foreground mt-2">
              &ldquo;{playlist.title}&rdquo; will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end mt-5">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Delete playlist
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * PlaylistFolders — minimal folder-organization surface (§29).
 *
 * Fetches /api/playlist-folders?bid=… via useQuery and shows a horizontal
 * chip row of folders. A "Create folder" button opens an inline input that
 * POSTs to /api/playlist-folders. The schema doesn't yet expose a
 * playlist→folder foreign key (the backend route intentionally avoids a
 * destructive migration), so folders are surfaced as standalone
 * organizational containers — the user can see + create them here, and
 * future work will wire folder→playlist assignment once the schema migrates.
 * ──────────────────────────────────────────────────────────────────────── */

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt?: string;
};

async function fetchFolders(bid: string): Promise<Folder[]> {
  if (!bid) return [];
  const r = await fetch(`/api/playlist-folders?bid=${encodeURIComponent(bid)}`);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.folders || []) as Folder[];
}

function PlaylistFolders({ bid }: { bid: string }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["playlist-folders", bid],
    queryFn: () => fetchFolders(bid),
    enabled: !!bid,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/playlist-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, name: name.trim() }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlist-folders", bid] });
      toast.success("Folder created");
      setName("");
      setCreating(false);
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't create folder"),
  });

  const folders = data ?? [];

  // Nothing to show yet AND the user isn't mid-create? Hide the row entirely
  // to keep the playlist view uncluttered for users who haven't opted into
  // folders. The "Create folder" button stays accessible so they can opt in.
  if (folders.length === 0 && !creating) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setCreating(true)}
        >
          <FolderPlus className="h-4 w-4 mr-1.5" />
          Create folder
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Folders
        </p>
        <button
          onClick={() => setCreating((c) => !c)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New folder
        </button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scroll">
        {isLoading ? (
          <Skeleton className="h-9 w-24 rounded-full" />
        ) : (
          folders.map((f) => (
            <div
              key={f.id}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-surface border border-border text-sm hover:bg-accent transition-colors"
              title={f.createdAt ? `Created ${timeAgo(f.createdAt)}` : f.name}
            >
              <Folder className="h-3.5 w-3.5 text-gold" />
              <span className="truncate max-w-[12ch]">{f.name}</span>
            </div>
          ))
        )}

        {creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              createMutation.mutate();
            }}
            className="shrink-0 inline-flex items-center gap-1.5 h-9 pl-2 pr-1 rounded-full bg-surface border border-gold/40"
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Folder name"
              maxLength={100}
              aria-label="New folder name"
              className="h-7 w-32 border-0 bg-transparent px-1.5 text-sm focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName("");
                  setCreating(false);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full hover:bg-gold/10"
              disabled={!name.trim() || createMutation.isPending}
              aria-label="Create folder"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 text-gold" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full hover:bg-accent"
              onClick={() => {
                setName("");
                setCreating(false);
              }}
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
