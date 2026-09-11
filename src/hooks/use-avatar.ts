"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "mashahd-avatar";
export const DEFAULT_AVATAR =
  "https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=c2a060";

/**
 * Preset avatars the user can pick from without uploading. Generated via
 * DiceBear so they're deterministic and need no storage.
 */
export const PRESET_AVATARS = [
  DEFAULT_AVATAR,
  "https://api.dicebear.com/7.x/notionists/svg?seed=Mashahd&backgroundColor=1a4a5a&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Creator&backgroundColor=c2a060&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Viewer&backgroundColor=db2777&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Director&backgroundColor=0891b2&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Producer&backgroundColor=16a34a&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Editor&backgroundColor=f59e0b&radius=50",
  "https://api.dicebear.com/7.x/notionists/svg?seed=Host&backgroundColor=8b5cf6&radius=50",
  "https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=1a4a5a",
  "https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=db2777",
  "https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=0891b2",
  "https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=16a34a",
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
