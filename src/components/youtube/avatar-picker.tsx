"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Check, RotateCcw, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useAvatar,
  PRESET_AVATARS,
} from "@/hooks/use-avatar";

/**
 * AvatarPicker — a dialog for changing the profile picture. Lets the user:
 *   - pick from preset DiceBear avatars
 *   - upload a custom image (JPG/PNG, max 500KB)
 *   - edit their display name (feeds the initials avatar)
 *
 * Persists to localStorage via the useAvatar hook; the mashahd:avatar-changed
 * event keeps the header, profile, and comment composer in sync.
 */
export function AvatarPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { avatar, name, setAvatar, setName, uploadAvatar, reset } = useAvatar();
  const [nameDraft, setNameDraft] = useState(name);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const res = uploadAvatar(file);
    if (!res.ok) {
      toast.error(res.error || "Upload failed");
    } else {
      toast.success("Profile picture updated");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Change profile picture</DialogTitle>
        <DialogDescription>
          Pick a preset or upload your own (JPG/PNG, max 500KB).
        </DialogDescription>

        {/* Preview */}
        <div className="flex flex-col items-center gap-3 py-3">
          <img
            src={avatar}
            alt="Preview"
            className="h-24 w-24 rounded-full object-cover border-4 border-background shadow-float"
          />
          <p className="text-sm font-medium">{nameDraft || "You"}</p>
        </div>

        {/* Display name */}
        <div>
          <label htmlFor="avatar-display-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Display name
          </label>
          <Input
            id="avatar-display-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
            placeholder="Your name"
            className="mt-1"
          />
        </div>

        {/* Preset grid */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
            Presets
          </label>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_AVATARS.map((url, i) => (
              <button
                key={i}
                onClick={() => setAvatar(url)}
                className={cn(
                  "rounded-full overflow-hidden border-2 transition-all",
                  avatar === url
                    ? "border-gold ring-2 ring-gold/40 scale-105"
                    : "border-transparent hover:border-border"
                )}
              >
                <img src={url} alt={`Preset ${i + 1}`} className="h-10 w-10" />
              </button>
            ))}
          </div>
        </div>

        {/* Upload */}
        <div>
          <label htmlFor="avatar-upload-input" className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
            Upload your own
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-gold/50 hover:bg-gold/5 transition-colors text-sm"
          >
            <Upload className="h-4 w-4 text-[hsl(var(--gold))]" />
            Choose a file from your device
          </button>
          <input
            id="avatar-upload-input"
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              setNameDraft("You");
              toast.info("Reset to default");
            }}
            className="rounded-full"
          >
            <RotateCcw className="h-4 w-4 mr-1" /> Reset
          </Button>
          <Button
            onClick={() => {
              setName(nameDraft.trim() || "You");
              toast.success("Profile updated");
              onOpenChange(false);
            }}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Check className="h-4 w-4 mr-1" /> Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
