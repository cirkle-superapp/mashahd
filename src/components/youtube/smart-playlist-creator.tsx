"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Plus,
  Trash2,
  Play,
  Clock,
  Filter,
  ArrowLeft,
  Loader2,
  Users,
  EyeOff,
  Heart,
  Calendar,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";
import { CATEGORIES, type Video } from "@/lib/types";

/**
 * SmartPlaylistCreator — spec §30: "Allow rules such as: 'All unwatched
 * videos under 20 minutes from followed creators.' Rules must update
 * dynamically."
 *
 * Lists the user's existing smart playlists (fetched from
 * /api/smart-playlists?bid=...). Each entry exposes a "View results" button
 * (navigates to /?v=smartPlaylist&id=...) and a "Delete" button. A
 * "Create smart playlist" button opens a rule-builder Dialog with a live
 * preview count of how many videos match the current rules. Creating POSTs to
 * /api/smart-playlists; deleting DELETEs via the same route.
 *
 * `SmartPlaylistResultsView` (also exported here) renders the resolved videos
 * for a given smart playlist id, fetched from
 * /api/smart-playlists/[id]/resolve?bid=...
 */

// ---- Types ---------------------------------------------------------------

export type SmartPlaylistDateRange = "7d" | "30d" | "90d" | "all";

/** Rules that define a smart playlist (mirrors backend cleanRules shape). */
export interface SmartPlaylistRules {
  categories: string[];
  creators: string[];
  maxDuration?: number;
  minDuration?: number;
  unwatchedOnly: boolean;
  savedOnly: boolean;
  dateRange: SmartPlaylistDateRange;
}

/** A persisted smart playlist row as returned by GET /api/smart-playlists. */
export interface SmartPlaylist {
  id: string;
  name: string;
  description: string | null;
  rules: SmartPlaylistRules;
  createdAt: string;
}

interface SmartPlaylistListResponse {
  playlists: SmartPlaylist[];
}

interface SmartPlaylistCreatePayload {
  browserId: string;
  name: string;
  description?: string;
  rules: SmartPlaylistRules;
}

interface SmartPlaylistDeletePayload {
  browserId: string;
  playlistId: string;
}

interface ResolveResponse {
  playlist: {
    id: string;
    name: string;
    description: string | null;
    rules: SmartPlaylistRules;
  };
  videos: Video[];
  count: number;
}

interface UserStateForPreview {
  watchedVideoIds: string[];
  favoriteVideoIds: string[];
  subscribedChannelIds: string[];
}

// ---- Constants -----------------------------------------------------------

/** Category labels excluded from the rule builder (per spec). */
const EXCLUDED_CATEGORIES = new Set<string>([
  "All",
  "Recently uploaded",
  "New to you",
]);

/** Selectable categories for the rule builder. */
const AVAILABLE_CATEGORIES: string[] = CATEGORIES.filter(
  (c) => !EXCLUDED_CATEGORIES.has(c),
);

/** Date range select options. */
const DATE_RANGE_OPTIONS: { value: SmartPlaylistDateRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const EMPTY_RULES: SmartPlaylistRules = {
  categories: [],
  creators: [],
  unwatchedOnly: false,
  savedOnly: false,
  dateRange: "all",
};

const SECONDS_PER_MINUTE = 60;

function minutesToSeconds(minutes: number): number | undefined {
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Math.round(minutes * SECONDS_PER_MINUTE);
}

/** Build the rules payload from the dialog's form state. */
function buildRules(
  form: CreateDialogFormState,
): SmartPlaylistRules {
  const rules: SmartPlaylistRules = {
    categories: form.categories,
    creators: form.includeFollowing ? ["following"] : [],
    unwatchedOnly: form.unwatchedOnly,
    savedOnly: form.savedOnly,
    dateRange: form.dateRange,
  };
  const min = minutesToSeconds(form.minMinutes);
  const max = minutesToSeconds(form.maxMinutes);
  if (min !== undefined) rules.minDuration = min;
  if (max !== undefined) rules.maxDuration = max;
  return rules;
}

/** Produce human-readable rule chips for an existing smart playlist. */
function describeRules(rules: SmartPlaylistRules): string[] {
  const chips: string[] = [];
  if (rules.categories?.length) {
    chips.push(`${rules.categories.length} categor${rules.categories.length === 1 ? "y" : "ies"}`);
  }
  if (rules.creators?.includes("following")) {
    chips.push("Following creators");
  } else if (rules.creators?.length) {
    chips.push(`${rules.creators.length} creator${rules.creators.length === 1 ? "" : "s"}`);
  }
  if (rules.minDuration !== undefined || rules.maxDuration !== undefined) {
    const minStr = rules.minDuration !== undefined
      ? `${Math.round(rules.minDuration / SECONDS_PER_MINUTE)}m`
      : "0";
    const maxStr = rules.maxDuration !== undefined
      ? `${Math.round(rules.maxDuration / SECONDS_PER_MINUTE)}m`
      : "∞";
    chips.push(`${minStr}–${maxStr}`);
  }
  if (rules.unwatchedOnly) chips.push("Unwatched");
  if (rules.savedOnly) chips.push("Saved only");
  if (rules.dateRange && rules.dateRange !== "all") {
    chips.push(`Last ${rules.dateRange.replace("d", " days")}`);
  }
  return chips;
}

// ---- Preview helpers (client-side) --------------------------------------

const PREVIEW_LIMIT = 200;

async function fetchAllVideosForPreview(): Promise<Video[]> {
  const r = await fetch(`/api/videos?limit=${PREVIEW_LIMIT}`);
  if (!r.ok) throw new Error("failed to load videos for preview");
  const data = (await r.json()) as { videos: Video[] };
  return data.videos ?? [];
}

async function fetchUserStateForPreview(
  bid: string,
): Promise<UserStateForPreview> {
  if (!bid) {
    return {
      watchedVideoIds: [],
      favoriteVideoIds: [],
      subscribedChannelIds: [],
    };
  }
  const r = await fetch(`/api/user-state?bid=${encodeURIComponent(bid)}`);
  if (!r.ok) {
    return {
      watchedVideoIds: [],
      favoriteVideoIds: [],
      subscribedChannelIds: [],
    };
  }
  return (await r.json()) as UserStateForPreview;
}

/**
 * Compute how many videos match the given rules using already-fetched data.
 * Mirrors the server's `resolveSmartPlaylist` logic so the preview count is
 * close to what the resolve endpoint would actually return.
 */
function computeMatchCount(
  videos: Video[],
  state: UserStateForPreview,
  rules: SmartPlaylistRules,
): number {
  const watched = new Set(state.watchedVideoIds || []);
  const saved = new Set(state.favoriteVideoIds || []);
  const subs = new Set(state.subscribedChannelIds || []);

  let filtered = videos;

  if (rules.categories?.length) {
    const catSet = new Set(rules.categories);
    filtered = filtered.filter((v) => catSet.has(v.category));
  }

  // Creators: if "following" is present, also allow subscribed channels.
  const explicitCreators = (rules.creators || []).filter((c) => c !== "following");
  const includeFollowing = (rules.creators || []).includes("following");
  if (explicitCreators.length || includeFollowing) {
    const creatorSet = new Set(explicitCreators);
    filtered = filtered.filter((v) => {
      const direct = creatorSet.has(v.channelId);
      const following = includeFollowing && subs.has(v.channelId);
      return direct || following;
    });
  }

  if (rules.dateRange && rules.dateRange !== "all") {
    const days = parseInt(rules.dateRange, 10);
    const since = Date.now() - days * 86_400_000;
    filtered = filtered.filter((v) => new Date(v.createdAt).getTime() >= since);
  }

  if (rules.minDuration !== undefined) {
    filtered = filtered.filter((v) => v.durationSec >= rules.minDuration!);
  }
  if (rules.maxDuration !== undefined) {
    filtered = filtered.filter((v) => v.durationSec <= rules.maxDuration!);
  }

  if (rules.unwatchedOnly) {
    filtered = filtered.filter((v) => !watched.has(v.id));
  }
  if (rules.savedOnly) {
    filtered = filtered.filter((v) => saved.has(v.id));
  }

  return filtered.length;
}

// ---- Main component ------------------------------------------------------

export function SmartPlaylistCreator() {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const { navigate } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Fetch the list of existing smart playlists for this user.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["smart-playlists", bid],
    queryFn: async (): Promise<SmartPlaylist[]> => {
      const r = await fetch(
        `/api/smart-playlists?bid=${encodeURIComponent(bid)}`,
      );
      if (!r.ok) throw new Error("failed to load smart playlists");
      const json = (await r.json()) as SmartPlaylistListResponse;
      return Array.isArray(json.playlists) ? json.playlists : [];
    },
    enabled: !!bid,
    staleTime: 60_000,
  });

  const playlists = data ?? [];

  // DELETE mutation: removes a smart playlist.
  const deleteMutation = useMutation({
    mutationFn: async (playlistId: string) => {
      const r = await fetch(`/api/smart-playlists`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          playlistId,
        } satisfies SmartPlaylistDeletePayload),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string")
            ? (body as { error: string }).error
            : "failed to delete",
        );
      }
      return playlistId;
    },
    onSuccess: (deletedId) => {
      qc.invalidateQueries({ queryKey: ["smart-playlists", bid] });
      toast.success("Smart playlist deleted");
      setConfirmDeleteId((current) => (current === deletedId ? null : current));
    },
    onError: () => toast.error("Could not delete smart playlist"),
  });

  const handleViewResults = (playlistId: string) => {
    navigate({ kind: "smartPlaylist", playlistId });
  };

  return (
    <section className="space-y-4" aria-label="Smart playlists">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" aria-hidden />
          Smart playlists
        </h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Create smart playlist
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Rule-based playlists that update automatically. e.g. &ldquo;All unwatched
        videos under 20 minutes from followed creators.&rdquo;
      </p>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Could not load smart playlists. Please try again later.
          </p>
        </div>
      ) : playlists.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Sparkles
            className="h-8 w-8 mx-auto text-muted-foreground mb-2"
            aria-hidden
          />
          <p className="text-sm font-medium">No smart playlists yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one to auto-collect videos that match your rules.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Create your first
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {playlists.map((p) => (
            <SmartPlaylistCard
              key={p.id}
              playlist={p}
              onViewResults={() => handleViewResults(p.id)}
              onDelete={() => setConfirmDeleteId(p.id)}
              pendingDelete={
                confirmDeleteId === p.id && deleteMutation.isPending
              }
            />
          ))}
        </div>
      )}

      <CreateSmartPlaylistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {/* Delete confirmation dialog */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <DialogContent className="max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>Delete smart playlist?</DialogTitle>
            <DialogDescription>
              This playlist and its rules will be permanently removed. The
              matching videos themselves will not be deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteId(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || confirmDeleteId === null}
              onClick={() => {
                if (confirmDeleteId) deleteMutation.mutate(confirmDeleteId);
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---- Smart playlist card -------------------------------------------------

function SmartPlaylistCard({
  playlist,
  onViewResults,
  onDelete,
  pendingDelete,
}: {
  playlist: SmartPlaylist;
  onViewResults: () => void;
  onDelete: () => void;
  pendingDelete: boolean;
}) {
  const chips = useMemo(() => describeRules(playlist.rules), [playlist.rules]);
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-4 w-4 text-gold shrink-0"
              aria-hidden
            />
            <h3 className="font-medium truncate">{playlist.name}</h3>
          </div>
          {playlist.description ? (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {playlist.description}
            </p>
          ) : null}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip} variant="secondary" className="text-[11px]">
              {chip}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No rules — matches all videos.
        </p>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          onClick={onViewResults}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          View results
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
          onClick={onDelete}
          disabled={pendingDelete}
          aria-label={`Delete ${playlist.name}`}
          title="Delete"
        >
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ---- Create dialog -------------------------------------------------------

interface CreateDialogFormState {
  name: string;
  description: string;
  categories: string[];
  minMinutes: number;
  maxMinutes: number;
  unwatchedOnly: boolean;
  savedOnly: boolean;
  dateRange: SmartPlaylistDateRange;
  includeFollowing: boolean;
}

const INITIAL_FORM: CreateDialogFormState = {
  name: "",
  description: "",
  categories: [],
  minMinutes: 0,
  maxMinutes: 0,
  unwatchedOnly: false,
  savedOnly: false,
  dateRange: "all",
  includeFollowing: false,
};

function CreateSmartPlaylistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateDialogFormState>(INITIAL_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset the form whenever the dialog closes (avoids a setState-in-effect
  // and keeps the next open fresh).
  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setForm(INITIAL_FORM);
      setSubmitError(null);
    }
    onOpenChange(next);
  };

  const update = <K extends keyof CreateDialogFormState>(
    key: K,
    value: CreateDialogFormState[K],
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCategory = (cat: string, checked: boolean): void => {
    setForm((prev) => ({
      ...prev,
      categories: checked
        ? [...prev.categories, cat]
        : prev.categories.filter((c) => c !== cat),
    }));
  };

  const rules = useMemo(() => buildRules(form), [form]);

  // Live preview count — fetch all videos + user state once per dialog open,
  // then recompute as rules change.
  const { data: previewCount, isLoading: previewLoading } = usePreviewCount(
    bid,
    rules,
    open,
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!bid) throw new Error("Browser ID not ready");
      if (!form.name.trim()) throw new Error("Name is required");
      const payload: SmartPlaylistCreatePayload = {
        browserId: bid,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        rules,
      };
      const r = await fetch(`/api/smart-playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string")
            ? (body as { error: string }).error
            : "failed to create smart playlist",
        );
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smart-playlists", bid] });
      toast.success("Smart playlist created");
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Could not create playlist";
      setSubmitError(message);
      toast.error(message);
    },
  });

  const canSubmit =
    !!bid && form.name.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold" aria-hidden />
            Create smart playlist
          </DialogTitle>
          <DialogDescription>
            Define rules. Videos matching these rules will appear in this
            playlist automatically — and the list updates dynamically as new
            videos match.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-name">Name</Label>
            <Input
              id="sp-name"
              value={form.name}
              maxLength={100}
              placeholder="e.g. Quick tech watchlist"
              onChange={(e) => update("name", e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-desc">
              Description{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="sp-desc"
              value={form.description}
              maxLength={500}
              placeholder="What this playlist is for"
              rows={2}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Categories
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-md border border-border p-3 max-h-44 overflow-y-auto">
              {AVAILABLE_CATEGORIES.map((cat) => {
                const checked = form.categories.includes(cat);
                return (
                  <label
                    key={cat}
                    className="flex items-center gap-2 text-sm cursor-pointer select-none"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleCategory(cat, v === true)}
                    />
                    <span className="truncate">{cat}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {form.categories.length === 0
                ? "No category filter — include all categories."
                : `${form.categories.length} categor${form.categories.length === 1 ? "y" : "ies"} selected.`}
            </p>
          </div>

          {/* Duration range */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Duration range (minutes)
            </Label>
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <span className="text-xs text-muted-foreground">Min</span>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  inputMode="numeric"
                  value={form.minMinutes === 0 ? "" : String(form.minMinutes)}
                  placeholder="0"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    update("minMinutes", Number.isFinite(n) && n > 0 ? n : 0);
                  }}
                />
              </div>
              <span className="text-muted-foreground text-sm pt-5">–</span>
              <div className="flex-1 space-y-1">
                <span className="text-xs text-muted-foreground">Max</span>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  inputMode="numeric"
                  value={form.maxMinutes === 0 ? "" : String(form.maxMinutes)}
                  placeholder="∞"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    update("maxMinutes", Number.isFinite(n) && n > 0 ? n : 0);
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank for no limit on that side.
            </p>
          </div>

          {/* Date range */}
          <div className="space-y-2">
            <Label htmlFor="sp-date" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              Uploaded
            </Label>
            <Select
              value={form.dateRange}
              onValueChange={(v) =>
                update("dateRange", v as SmartPlaylistDateRange)
              }
            >
              <SelectTrigger id="sp-date" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Flags */}
          <div className="space-y-2.5 rounded-md border border-border p-3">
            <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
              <Checkbox
                checked={form.unwatchedOnly}
                onCheckedChange={(v) => update("unwatchedOnly", v === true)}
              />
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span>Unwatched only</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
              <Checkbox
                checked={form.savedOnly}
                onCheckedChange={(v) => update("savedOnly", v === true)}
              />
              <Heart className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span>Saved / favorited only</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
              <Checkbox
                checked={form.includeFollowing}
                onCheckedChange={(v) => update("includeFollowing", v === true)}
              />
              <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span>Include videos from followed creators</span>
            </label>
          </div>

          {/* Live preview count */}
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Matching videos
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {previewLoading ? (
                <Skeleton className="h-4 w-8 inline-block" />
              ) : (
                <>
                  {previewCount ?? 0}{" "}
                  <span className="text-muted-foreground font-normal">
                    video{(previewCount ?? 0) === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </span>
          </div>

          {submitError ? (
            <p className="text-xs text-rose-500">{submitError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Create playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook: fetches all videos + user state once when the dialog opens, then
 * recomputes the match count via `computeMatchCount` whenever `rules`
 * changes. Returns null while loading.
 */
function usePreviewCount(
  bid: string,
  rules: SmartPlaylistRules,
  enabled: boolean,
): { data: number | null; isLoading: boolean } {
  const videosQuery = useQuery({
    queryKey: ["smart-playlist-preview-videos"],
    queryFn: fetchAllVideosForPreview,
    enabled,
    staleTime: 60_000,
  });

  const stateQuery = useQuery({
    queryKey: ["smart-playlist-preview-state", bid],
    queryFn: () => fetchUserStateForPreview(bid),
    enabled: enabled && !!bid,
    staleTime: 30_000,
  });

  const isLoading = videosQuery.isLoading || stateQuery.isLoading;
  const count = useMemo(() => {
    if (!videosQuery.data || !stateQuery.data) return null;
    return computeMatchCount(videosQuery.data, stateQuery.data, rules);
  }, [videosQuery.data, stateQuery.data, rules]);

  return { data: count, isLoading };
}

// ---- Resolved results view -----------------------------------------------

/**
 * SmartPlaylistResultsView — fetches the resolved videos for a given smart
 * playlist id from /api/smart-playlists/[id]/resolve?bid=... and renders them
 * in a grid. Reached via the `smartPlaylist` view kind (URL: ?v=smartPlaylist&id=...).
 */
export function SmartPlaylistResultsView({
  playlistId,
}: {
  playlistId: string;
}) {
  const bid = useBrowserId();
  const { navigate } = useAppStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["smart-playlist-resolve", playlistId, bid],
    queryFn: async (): Promise<ResolveResponse> => {
      const r = await fetch(
        `/api/smart-playlists/${encodeURIComponent(playlistId)}/resolve?bid=${encodeURIComponent(bid)}`,
      );
      if (!r.ok) throw new Error("failed to resolve smart playlist");
      return (await r.json()) as ResolveResponse;
    },
    enabled: !!bid && !!playlistId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 sm:p-10 text-center">
        <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-semibold">Smart playlist not found</p>
        <p className="text-sm text-muted-foreground mt-1">
          It may have been deleted.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate({ kind: "library" })}
        >
          Back to Library
        </Button>
      </div>
    );
  }

  const { playlist, videos } = data;
  const chips = describeRules(playlist.rules);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="mb-2"
        onClick={() => navigate({ kind: "library" })}
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Library
      </Button>

      <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden />
            <span>Smart playlist</span>
            <span>·</span>
            <span>{videos.length} matching video{videos.length === 1 ? "" : "s"}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
            {playlist.name}
          </h1>
          {playlist.description ? (
            <p className="text-sm text-muted-foreground">
              {playlist.description}
            </p>
          ) : null}
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {chips.map((chip) => (
                <Badge key={chip} variant="secondary" className="text-[11px]">
                  {chip}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            disabled={videos.length === 0}
            onClick={() => {
              if (videos[0]) navigate({ kind: "watch", videoId: videos[0].id });
            }}
          >
            <Play className="h-4 w-4 mr-1 fill-current" />
            Play all
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        This list updates dynamically as new videos match your rules.
      </p>

      {videos.length === 0 ? (
        <div className="text-center py-12">
          <Filter
            className="h-10 w-10 mx-auto text-muted-foreground mb-3"
            aria-hidden
          />
          <p className="font-medium">No videos match these rules yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Try adjusting the rules — or check back when new videos are uploaded.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <ResolvedVideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact video card for the resolved results grid. */
function ResolvedVideoCard({ video }: { video: Video }) {
  const { navigate } = useAppStore();
  return (
    <button
      onClick={() => navigate({ kind: "watch", videoId: video.id })}
      className="text-left group"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded leading-none tabular-nums">
          {Math.floor(video.durationSec / 60)}:
          {String(video.durationSec % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <h3 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-foreground">
          {video.title}
        </h3>
        <p className="text-xs text-muted-foreground">
          {video.channel?.name ?? "Unknown channel"}
        </p>
      </div>
    </button>
  );
}

export default SmartPlaylistCreator;
