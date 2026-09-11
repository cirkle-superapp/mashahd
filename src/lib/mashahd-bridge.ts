"use client";

import { useEffect } from "react";
import { useAppStore, type View, viewToQuery, queryToView } from "@/store/app-store";

/**
 * MashahdBridge — the super-app integration layer.
 *
 * Mashahd is the *video pillar* of a larger super-app (alongside Wasl chat,
 * Lamahat photos, Midan square, etc.). This bridge exposes a stable,
 * versioned API on `window.mashahd` so the parent shell can:
 *
 *   - navigate the user to any Mashahd view (home / watch / channel / search)
 *   - query the current view
 *   - subscribe to internal navigation events
 *   - request Mashahd to "exit" back to the shell (emits mashahd:exit)
 *
 * The parent shell never imports Mashahd internals — it talks to this
 * surface only. This keeps Mashahd loosely coupled and safely embeddable.
 *
 *   if (window.mashahd) {
 *     window.mashahd.navigate({ kind: "watch", videoId: "abc" });
 *     const off = window.mashahd.onNavigate((view) => console.log(view));
 *     // later: off();
 *   }
 *
 * NOTE: window.mashahd is also set as a marker so a parent can feature-detect:
 *   typeof window !== 'undefined' && window.mashahd?.id === 'mashahd'
 */

export type MashahdView = View;

export interface MashahdBridge {
  /** Stable id so a parent can feature-detect Mashahd. */
  id: "mashahd";
  /** Semver of the bridge surface (bump on breaking changes). */
  version: "1.0.0";
  /** Navigate Mashahd to a view. Returns the resulting URL. */
  navigate: (view: MashahdView) => string;
  /** Read the current view. */
  getView: () => MashahdView;
  /** Subscribe to navigation events. Returns an unsubscribe fn. */
  onNavigate: (cb: (view: MashahdView) => void) => () => void;
  /** Ask Mashahd to hand control back to the parent shell. */
  exit: () => void;
}

declare global {
  interface Window {
    mashahd?: MashahdBridge;
  }
}

const NAV_EVENT = "mashahd:navigate";
const EXIT_EVENT = "mashahd:exit";

/** Mount the bridge onto window once on the client. */
export function useMashahdBridge() {
  const navigate = useAppStore((s) => s.navigate);
  const syncFromUrl = useAppStore((s) => s.syncFromUrl);

  useEffect(() => {
    const subscribers = new Set<(v: MashahdView) => void>();

    const getView = (): MashahdView => useAppStore.getState().view;

    const bridgeNav = (view: MashahdView): string => {
      // Use the store's navigate (pushes history + updates store).
      navigate(view);
      // Notify subscribers + dispatch a window CustomEvent for non-subscribers.
      subscribers.forEach((cb) => {
        try {
          cb(view);
        } catch {
          /* isolate listener errors */
        }
      });
      window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: view }));
      return window.location.pathname + viewToQuery(view);
    };

    const onNavigate = (cb: (v: MashahdView) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    };

    const exit = () => {
      window.dispatchEvent(new CustomEvent(EXIT_EVENT));
    };

    const bridge: MashahdBridge = {
      id: "mashahd",
      version: "1.0.0",
      navigate: bridgeNav,
      getView,
      onNavigate,
      exit,
    };

    window.mashahd = bridge;

    // Also keep subscribers in sync when the user navigates with the
    // browser back/forward buttons (popstate -> syncFromUrl).
    const onPop = () => {
      syncFromUrl();
      const v = getView();
      subscribers.forEach((cb) => cb(v));
      window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: v }));
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (window.mashahd === bridge) delete window.mashahd;
    };
  }, [navigate, syncFromUrl]);
}
