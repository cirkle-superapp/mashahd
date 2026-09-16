"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Plus, Trash2, Check, Pencil, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useBrowserId } from "@/hooks/use-browser-id";
import { CATEGORIES } from "@/lib/types";

/**
 * InterestProfilesSection — spec §28.
 *
 * Lets a single anonymous user (one browserId) maintain multiple
 * recommendation contexts (Personal / Work / Research / Technology /
 * Entertainment / Business…) WITHOUT separate accounts. Exactly one
 * profile is active at a time and drives the home feed; switching is
 * instant via optimistic React Query updates.
 *
 * Backend: /api/interest-profiles (GET / POST / PATCH / DELETE).
 */

const MAX_PROFILES = 10;
const MAX_NAME_LENGTH = 60;
const QUERY_KEY = (bid: string) => ["interest-profiles", bid] as const;

/**
 * Categories exposed as profile filters. The CATEGORIES list also contains
 * pseudo-entries ("All", "Recently uploaded", "New to you") that don't make
 * sense as profile filters, so we exclude them.
 */
const PROFILE_CATEGORIES: readonly string[] = CATEGORIES.filter(
  (c) => c !== "All" && c !== "Recently uploaded" && c !== "New to you"
);

export interface InterestProfile {
  id: string;
  name: string;
  categories: string[];
  isActive: boolean;
  createdAt?: string;
}

interface FormState {
  name: string;
  categories: string[];
}

const EMPTY_FORM: FormState = { name: "", categories: [] };

// --- API response shapes (typed; no `any`). ---
interface ListResponse {
  profiles?: InterestProfile[];
}
interface MutationResponse {
  ok?: boolean;
  error?: string;
  profile?: InterestProfile;
  activeProfileId?: string;
}

async function fetchProfiles(bid: string): Promise<InterestProfile[]> {
  if (!bid) return [];
  const res = await fetch(
    `/api/interest-profiles?bid=${encodeURIComponent(bid)}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as ListResponse;
  return data.profiles ?? [];
}

export function InterestProfilesSection() {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const queryKey = QUERY_KEY(bid);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchProfiles(bid),
    enabled: !!bid,
  });

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const atLimit = profiles.length >= MAX_PROFILES;
  const showLoading = !bid || isLoading;
  const showEmpty = !showLoading && profiles.length === 0 && !creating;

  // ---------------- CREATE ----------------
  const createMut = useMutation({
    mutationFn: async (input: FormState) => {
      const res = await fetch("/api/interest-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          name: input.name.trim(),
          categories: input.categories,
        }),
      });
      const data = (await res.json()) as MutationResponse;
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Failed to create profile");
      }
      return data.profile;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<InterestProfile[]>(queryKey);
      const current = previous ?? [];
      // Mirror the server: first profile becomes active automatically.
      const tempId = `temp-${Date.now()}`;
      const optimistic: InterestProfile = {
        id: tempId,
        name: input.name.trim(),
        categories: input.categories,
        isActive: current.length === 0,
      };
      qc.setQueryData<InterestProfile[]>(queryKey, [...current, optimistic]);
      return { previous, tempId };
    },
    onError: (_err, _input, ctx) => {
      qc.setQueryData(queryKey, ctx?.previous ?? []);
      toast.error("Could not create profile");
    },
    onSuccess: (created, _input, ctx) => {
      const current = qc.getQueryData<InterestProfile[]>(queryKey) ?? [];
      const replaced = ctx?.tempId
        ? current.map((p) => (p.id === ctx.tempId ? created : p))
        : [...current, created];
      qc.setQueryData(queryKey, replaced);
      toast.success(`Profile "${created.name}" created`);
      setCreating(false);
      setCreateForm(EMPTY_FORM);
    },
  });

  // ---------------- ACTIVATE ----------------
  const activateMut = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch("/api/interest-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          profileId,
          action: "activate",
        }),
      });
      const data = (await res.json()) as MutationResponse;
      if (!res.ok || !data.activeProfileId) {
        throw new Error(data.error || "Failed to activate");
      }
      return data.activeProfileId;
    },
    onMutate: async (profileId) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<InterestProfile[]>(queryKey) ?? [];
      qc.setQueryData<InterestProfile[]>(
        queryKey,
        previous.map((p) => ({ ...p, isActive: p.id === profileId }))
      );
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error("Could not activate profile");
    },
    onSuccess: () => {
      toast.success("Profile activated — feed will rebuild on next refresh");
    },
  });

  // ---------------- UPDATE ----------------
  const updateMut = useMutation({
    mutationFn: async (args: { profileId: string; input: FormState }) => {
      const res = await fetch("/api/interest-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          profileId: args.profileId,
          action: "update",
          name: args.input.name.trim(),
          categories: args.input.categories,
        }),
      });
      const data = (await res.json()) as MutationResponse;
      if (!res.ok || !data.profile) {
        throw new Error(data.error || "Failed to update profile");
      }
      return data.profile;
    },
    onMutate: async ({ profileId, input }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<InterestProfile[]>(queryKey) ?? [];
      qc.setQueryData<InterestProfile[]>(
        queryKey,
        previous.map((p) =>
          p.id === profileId
            ? {
                ...p,
                name: input.name.trim(),
                categories: input.categories,
              }
            : p
        )
      );
      return { previous };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error("Could not save changes");
    },
    onSuccess: (updated) => {
      toast.success(`Profile "${updated.name}" updated`);
      setEditingId(null);
      setEditForm(EMPTY_FORM);
    },
  });

  // ---------------- DELETE ----------------
  const deleteMut = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch("/api/interest-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, profileId }),
      });
      const data = (await res.json()) as MutationResponse;
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      return profileId;
    },
    onMutate: async (profileId) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<InterestProfile[]>(queryKey) ?? [];
      const deleted = previous.find((p) => p.id === profileId);
      const without = previous.filter((p) => p.id !== profileId);
      // If we deleted the active profile, the server auto-activates the
      // first remaining one — reflect that optimistically so the UI stays
      // consistent while the request is in flight.
      const next =
        deleted?.isActive && without.length > 0
          ? without.map((p, i) => ({ ...p, isActive: i === 0 }))
          : without;
      qc.setQueryData(queryKey, next);
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast.error("Could not delete profile");
    },
    onSuccess: () => {
      toast.success("Profile deleted");
      setConfirmDeleteId(null);
    },
  });

  const toggleCategory = (
    form: FormState,
    setForm: (f: FormState) => void,
    cat: string
  ) => {
    const next = form.categories.includes(cat)
      ? form.categories.filter((c) => c !== cat)
      : [...form.categories, cat];
    setForm({ ...form, categories: next });
  };

  return (
    <div className="p-4 rounded-xl bg-card border border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-[hsl(var(--gold))]" />
            Interest profiles
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Separate recommendation contexts — Personal, Work, Research,
            Technology, Entertainment, Business — under one account. Switching
            instantly changes what your feed surfaces. Per spec §28.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {profiles.length}/{MAX_PROFILES}
        </Badge>
      </div>

      {showLoading && (
        <div className="text-xs text-muted-foreground py-4">Loading…</div>
      )}

      {showEmpty && (
        <div className="text-center py-8">
          <User className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No profiles yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create your first profile to start tuning recommendations.
          </p>
        </div>
      )}

      {profiles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {profiles.map((p) => {
            const isEditing = editingId === p.id;
            const isOptimistic = p.id.startsWith("temp-");
            return (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-background/60 p-3"
                aria-label={`Profile ${p.name}${p.isActive ? " (active)" : ""}`}
              >
                {!isEditing && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {p.name}
                        </span>
                        {p.isActive && (
                          <Badge className="bg-[hsl(var(--gold))] text-black hover:bg-[hsl(var(--gold))]">
                            <Check className="h-3 w-3" />
                            Active
                          </Badge>
                        )}
                      </div>
                      {p.categories.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {p.categories.map((c) => (
                            <span
                              key={c}
                              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          No category filters — uses your general affinity.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!p.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full h-7"
                          disabled={activateMut.isPending || isOptimistic}
                          onClick={() => activateMut.mutate(p.id)}
                        >
                          Activate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={isOptimistic}
                        onClick={() => {
                          setEditingId(p.id);
                          setEditForm({
                            name: p.name,
                            categories: p.categories,
                          });
                        }}
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-rose hover:bg-rose/10"
                        disabled={isOptimistic}
                        onClick={() => setConfirmDeleteId(p.id)}
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <ProfileForm
                    form={editForm}
                    submitLabel="Save"
                    submitting={updateMut.isPending}
                    onCancel={() => {
                      setEditingId(null);
                      setEditForm(EMPTY_FORM);
                    }}
                    onSubmit={(input) =>
                      updateMut.mutate({ profileId: p.id, input })
                    }
                    onCategoryToggle={(cat) =>
                      toggleCategory(editForm, setEditForm, cat)
                    }
                    onChangeName={(name) =>
                      setEditForm({ ...editForm, name })
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <ProfileForm
            form={createForm}
            submitLabel="Create profile"
            submitting={createMut.isPending}
            onCancel={() => {
              setCreating(false);
              setCreateForm(EMPTY_FORM);
            }}
            onSubmit={(input) => createMut.mutate(input)}
            onCategoryToggle={(cat) =>
              toggleCategory(createForm, setCreateForm, cat)
            }
            onChangeName={(name) => setCreateForm({ ...createForm, name })}
          />
        </div>
      )}

      <div className="mt-3">
        {atLimit ? (
          <p className="text-xs text-muted-foreground">
            You&apos;ve reached the maximum of {MAX_PROFILES} profiles. Delete
            one to add another.
          </p>
        ) : (
          !creating && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setCreateForm(EMPTY_FORM);
                setCreating(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create new profile
            </Button>
          )
        )}
      </div>

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-rose" />
            Delete this profile?
          </DialogTitle>
          <DialogDescription>
            This permanently removes the profile and its category filters. If it
            was active, Mashahd will fall back to your first remaining profile.
          </DialogDescription>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setConfirmDeleteId(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-rose text-white hover:bg-rose/90"
              disabled={deleteMut.isPending}
              onClick={() =>
                confirmDeleteId && deleteMut.mutate(confirmDeleteId)
              }
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ProfileForm — shared inline form used for both create and edit. Renders a
 * name input (max 60 chars) + a grid of category checkboxes sourced from
 * `CATEGORIES` in src/lib/types.ts.
 */
interface ProfileFormProps {
  form: FormState;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (input: FormState) => void;
  onCancel: () => void;
  onCategoryToggle: (cat: string) => void;
  onChangeName: (name: string) => void;
}

function ProfileForm({
  form,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  onCategoryToggle,
  onChangeName,
}: ProfileFormProps) {
  const trimmedName = form.name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Name
        </label>
        <Input
          value={form.name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Personal, Work, Research…"
          onChange={(e) =>
            onChangeName(e.target.value.slice(0, MAX_NAME_LENGTH))
          }
          aria-label="Profile name"
        />
        <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
          {form.name.length}/{MAX_NAME_LENGTH}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Categories — only surface these in this profile&apos;s feed
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROFILE_CATEGORIES.map((cat) => {
            const checked = form.categories.includes(cat);
            return (
              <label
                key={cat}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onCategoryToggle(cat)}
                />
                <span>{cat}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!canSubmit}
          onClick={() => onSubmit({ ...form, name: trimmedName })}
        >
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
