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

/**
 * useAuth — client-side session management for Mashahd (CIRKLE-style auth).
 *
 * Stores the session token + user profile in localStorage. On mount, it
 * verifies the token with the backend and restores the session. Exposes
 * login, register, and logout functions. Dispatches a `mashahd:auth-changed`
 * event so the header, profile, and other components can re-render.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (!token) {
      // localStorage is an external store; this one-shot read is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    // Verify the token with the backend.
    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser(data.user);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } else {
          // Token expired or invalid — clear it.
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      })
      .catch(() => {
        // Network error — keep the saved user optimistically.
        if (savedUser) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            /* corrupted */
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback((u: AuthUser, token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setUser(u);
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
    setUser(null);
    window.dispatchEvent(new CustomEvent("mashahd:auth-changed"));
  }, []);

  // Listen for auth changes from other tabs/components.
  useEffect(() => {
    const onChanged = () => {
      const saved = localStorage.getItem(USER_KEY);
      if (saved) {
        try {
          setUser(JSON.parse(saved));
        } catch {
          /* corrupted */
        }
      } else {
        setUser(null);
      }
    };
    window.addEventListener("mashahd:auth-changed", onChanged);
    return () => window.removeEventListener("mashahd:auth-changed", onChanged);
  }, []);

  return { user, loading, register, login, logout };
}
