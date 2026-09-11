"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DEFAULT_AVATAR } from "@/hooks/use-avatar";

/**
 * UserAvatar — reads the current avatar from localStorage and re-renders
 * when it changes (via the mashahd:avatar-changed event). Use this anywhere
 * the user's own avatar appears (header, profile, comment composer, etc.)
 * so they all stay in sync.
 */
export function UserAvatar({
  className,
  fallback = "Y",
}: {
  className?: string;
  fallback?: string;
}) {
  const [avatar, setAvatar] = useState<string>(DEFAULT_AVATAR);

  useEffect(() => {
    const read = () => {
      try {
        const saved = localStorage.getItem("mashahd-avatar");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.avatar) setAvatar(parsed.avatar);
        }
      } catch {
        /* keep default */
      }
    };
    read();
    window.addEventListener("mashahd:avatar-changed", read);
    return () =>
      window.removeEventListener("mashahd:avatar-changed", read);
  }, []);

  return (
    <Avatar className={className}>
      <AvatarImage src={avatar} alt="Your avatar" />
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  );
}
