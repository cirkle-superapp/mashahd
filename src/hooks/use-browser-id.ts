"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "yt-clone-browser-id";
const LEGACY_KEY = "yt-clone-browser-id-legacy";

/**
 * Returns a stable, server-signed anonymous browser id.
 *
 * SECURITY (deep audit pass 2): previously the browserId was generated
 * client-side with no validation — anyone could fabricate IDs to inflate
 * view/like/subscribe counts. Now the client fetches a cryptographically
 * signed browserId from /api/user-state on first use. The server verifies
 * the HMAC signature on every state-changing request.
 *
 * The signed bid is cached in localStorage. If the server rejects it
 * (e.g. secret rotated), the client re-fetches a fresh one.
 */
export function useBrowserId(): string {
  const [bid, setBid] = useState<string>("");

  useEffect(() => {
    let id = localStorage.getItem(STORAGE_KEY);

    if (!id || id.startsWith("b_")) {
      // No bid, or legacy unsigned bid — fetch a signed one from the server.
      // Stash legacy id so /api/user-state can migrate its state.
      if (id) localStorage.setItem(LEGACY_KEY, id);
      fetch("/api/user-state", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.browserId) {
            localStorage.setItem(STORAGE_KEY, data.browserId);
            setBid(data.browserId);
          } else if (id) {
            // Server unavailable — fall back to legacy id for this session.
            setBid(id);
          }
        })
        .catch(() => {
          // Network error — use legacy id if we have one.
          if (id) {
            setBid(id);
          }
        });
      return;
    }

    // localStorage is an external store; this one-shot setState after the
    // initial client read is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBid(id);
  }, []);

  return bid;
}
