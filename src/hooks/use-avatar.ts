"use client";

import { useEffect, useState, useCallback } from "react";
import { customAvatarDataUrlBrowser } from "@/lib/custom-avatar";

const STORAGE_KEY = "mashahd-avatar";

// Pass 89: DEFAULT_AVATAR + PRESET_AVATARS are now generated from scratch
// via CustomAvatar (procedural SVG). No external DiceBear HTTP dependency.
// Each preset uses a different seed so they look visually distinct.
export const DEFAULT_AVATAR = customAvatarDataUrlBrowser("You", 48);

/**
 * Preset avatars the user can pick from without uploading. Generated via
 * CustomAvatar (procedural SVG) so they're deterministic and need no storage.
 */
export const PRESET_AVATARS = [
  DEFAULT_AVATAR,
  customAvatarDataUrlBrowser("Mashahd", 48),
  customAvatarDataUrlBrowser("Creator", 48),
  customAvatarDataUrlBrowser("Viewer", 48),
  customAvatarDataUrlBrowser("Director", 48),
  customAvatarDataUrlBrowser("Producer", 48),
  customAvatarDataUrlBrowser("Editor", 48),
  customAvatarDataUrlBrowser("Host", 48),
  customAvatarDataUrlBrowser("Guest", 48),
  customAvatarDataUrlBrowser("Member", 48),
  customAvatarDataUrlBrowser("User", 48),
  customAvatarDataUrlBrowser("Friend", 48),
];

/**
 * useAvatar — manages the user's profile picture. Supports:
 *   - presets (DiceBear URLs)
 *   - uploads (data URLs stored in localStorage, capped ~500KB)
 *   - a custom name that feeds the initials avatar
 *
 * The avatar is read synchronously after mount so the header/profile/comments
 * all show the same picture.
 */
export function useAvatar() {
  const [avatar, setAvatarState] = useState<string>(DEFAULT_AVATAR);
  const [name, setNameState] = useState<string>("You");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // localStorage is an external store; this one-shot read is intentional.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAvatarState(parsed.avatar || DEFAULT_AVATAR);
        setNameState(parsed.name || "You");
      }
    } catch {
      /* corrupted — keep defaults */
    }
    // localStorage is an external store; this one-shot read is intentional.
    setLoaded(true);
  }, []);

  const persist = useCallback((nextAvatar: string, nextName: string) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ avatar: nextAvatar, name: nextName })
      );
    } catch {
      /* quota exceeded — keep in-memory only */
    }
    setAvatarState(nextAvatar);
    setNameState(nextName);
    // Notify other components (header, comments, profile) that the avatar
    // changed so they can re-render without a full reload.
    window.dispatchEvent(new CustomEvent("mashahd:avatar-changed"));
  }, []);

  const setAvatar = useCallback(
    (url: string) => persist(url, name),
    [persist, name]
  );

  const setName = useCallback(
    (n: string) => persist(avatar, n),
    [persist, avatar]
  );

  const uploadAvatar = useCallback(
    (file: File) => {
      // Cap at ~500KB to stay within localStorage limits.
      if (file.size > 500_000) {
        return { ok: false, error: "Image is too large (max 500KB)" };
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        persist(dataUrl, name);
      };
      reader.readAsDataURL(file);
      return { ok: true };
    },
    [persist, name]
  );

  const reset = useCallback(() => {
    persist(DEFAULT_AVATAR, "You");
  }, [persist]);

  return { avatar, name, loaded, setAvatar, setName, uploadAvatar, reset };
}
