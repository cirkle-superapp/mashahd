"use client";

import { useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "mashahd-auth-token";
const USER_KEY = "mashahd-auth-user";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string;
  verified: boolean;
}

// ── Module-level singleton ──
// Previously every component calling `useAuth()` fired its own POST
// /api/auth/session on mount — up to 3 redundant network calls on first paint
// (header + profile-view + auth-screen). This singleton deduplicates: only the
// FIRST caller triggers the verification fetch; subsequent callers within the
// same page load reuse the in-flight promise or the cached result.

type SessionState =
  | { status: "loading" }
  | { status: "authed"; user: AuthUser }
  | { status: "anonymous" };

let _state: SessionState = { status: "loading" };
let _inflight: Promise<SessionState> | null = null;
let _listeners: Array<() => void> = [];
let _initialized = false;

function notify() {
  for (const l of _listeners) {
    try {
      l();
    } catch {
      /* listener threw — ignore */
    }
  }
}

function setState(s: SessionState) {
  _state = s;
  notify();
}

async function verifySession(): Promise<SessionState> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  if (!token) {
    return { status: "anonymous" };
  }
  try {
    const r = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await r.json();
    if (data.authenticated && data.user) {
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return { status: "authed", user: data.user as AuthUser };
    }
    // Token expired/invalid — clear it.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return { status: "anonymous" };
  } catch {
    // Network error — optimistically restore the saved user if any.
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedUser) {
      try {
        return { status: "authed", user: JSON.parse(savedUser) as AuthUser };
      } catch {
        /* corrupted */
      }
    }
    return { status: "anonymous" };
  }
}

function ensureInitialized() {
  if (_initialized || typeof window === "undefined") return;
  _initialized = true;
  // Kick off the single verification fetch.
  _inflight = verifySession().finally(() => {
    _inflight = null;
  });
  _inflight.then(setState);
}

/**
 * useAuth — client-side session management for Mashahd (CIRKLE-style auth).
 *
 * Stores the session token + user profile in localStorage. On mount, it
 * verifies the token with the backend (once per page load, shared across all
 * callers via a module-level singleton) and restores the session. Exposes
 * login, register, and logout functions. Dispatches a `mashahd:auth-changed`
 * event so non-hook consumers can react.
 */
export function useAuth() {
  ensureInitialized();

  const [user, setUser] = useState<AuthUser | null>(
    _state.status === "authed" ? _state.user : null
  );
  const [loading, setLoading] = useState(_state.status === "loading");

  // Subscribe to the singleton.
  useEffect(() => {
    const sync = () => {
      if (_state.status === "authed") {
        setUser(_state.user);
        setLoading(false);
      } else if (_state.status === "anonymous") {
        setUser(null);
        setLoading(false);
      } else {
        setLoading(true);
      }
    };
    sync();
    _listeners.push(sync);
    return () => {
      _listeners = _listeners.filter((l) => l !== sync);
    };
  }, []);

  const persist = useCallback((u: AuthUser, token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setState({ status: "authed", user: u });
    window.dispatchEvent(new CustomEvent("mashahd:auth-changed"));
  }, []);

  const register = useCallback(
    async (identifier: string, password: string, username: string, displayName: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, username, displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      persist(data.user, data.sessionToken);
      return data;
    },
    [persist]
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      persist(data.user, data.sessionToken);
      return data;
    },
    [persist]
  );

  const logout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ status: "anonymous" });
    window.dispatchEvent(new CustomEvent("mashahd:auth-changed"));
  }, []);

  // Listen for auth changes from other tabs.
  useEffect(() => {
    const onChanged = () => {
      const saved = localStorage.getItem(USER_KEY);
      if (saved) {
        try {
          const u = JSON.parse(saved) as AuthUser;
          setState({ status: "authed", user: u });
        } catch {
          /* corrupted */
        }
      } else {
        setState({ status: "anonymous" });
      }
    };
    window.addEventListener("mashahd:auth-changed", onChanged);
    return () => window.removeEventListener("mashahd:auth-changed", onChanged);
  }, []);

  return { user, loading, register, login, logout };
}
