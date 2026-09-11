"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "yt-clone-browser-id";

/**
 * Returns a stable anonymous browser id, persisted in localStorage. Used to
 * track likes / subscriptions / watch history without requiring auth.
 */
export function useBrowserId(): string {
  const [bid, setBid] = useState<string>("");
  useEffect(() => {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id =
        "b_" +
        Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, id);
    }
    // localStorage is an external store; this one-shot setState after the
    // initial client read is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBid(id);
  }, []);
  return bid;
}
