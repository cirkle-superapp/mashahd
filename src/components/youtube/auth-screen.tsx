"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Phone,
  AtSign,
  Lock,
  Check,
  X,
  Loader2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MashahdMark } from "@/components/brand/mashahd-logo";
import { useAuth } from "@/hooks/use-auth";

/**
 * AuthScreen — a full-screen authentication modal with CIRKLE-style
 * email/phone/username login + registration with live username
 * availability checking.
 *
 * Features:
 *   - Toggle between "Sign in" and "Create account"
 *   - Identifier field accepts email, phone, or username (for login)
 *   - On register: live username availability check (debounced 350ms)
 *     with auto-suggested alternatives when taken
 *   - On success: dispatches mashahd:auth-changed so the whole app
 *     updates (header avatar, profile, etc.)
 */

type Mode = "login" | "register";
type IdentifierType = "email" | "phone" | "username";

function detectIdentifierType(s: string): IdentifierType {
  if (s.includes("@")) return "email";
  if (/^[+0-9\s\-()]{7,}$/.test(s)) return "phone";
  return "username";
}

type UsernameStatus = "idle" | "checking" | "available" | "taken";

export function AuthScreen({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const idType = detectIdentifierType(identifier);

  // Live username availability check (debounced 350ms).
  const checkUsername = useCallback(async (u: string) => {
    const cleaned = u.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
    if (cleaned.length < 3) {
      setUsernameStatus("idle");
      setSuggestions([]);
      return;
    }
    setUsernameStatus("checking");
    try {
      const res = await fetch("/api/auth/check-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleaned }),
      });
      const data = await res.json();
      if (data.available) {
        setUsernameStatus("available");
        setSuggestions([]);
      } else {
        setUsernameStatus("taken");
        setSuggestions(data.suggestions || []);
      }
    } catch {
      setUsernameStatus("idle");
    }
  }, []);

  // Debounce the username check.
  useEffect(() => {
    if (mode !== "register") return;
    clearTimeout(debounceRef.current);
    setUsernameStatus("idle");
    if (username.length >= 3) {
      setUsernameStatus("checking");
      debounceRef.current = setTimeout(() => checkUsername(username), 350);
    }
    return () => clearTimeout(debounceRef.current);
  }, [username, mode, checkUsername]);

  const reset = () => {
    setIdentifier("");
    setPassword("");
    setUsername("");
    setDisplayName("");
    setUsernameStatus("idle");
    setSuggestions([]);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(identifier, password);
        toast.success("Welcome back!", {
          description: "You're now signed in to Mashahd.",
        });
      } else {
        // Register
        if (usernameStatus !== "available") {
          toast.error("Please choose an available username");
          setSubmitting(false);
          return;
        }
        const name = displayName.trim() || username;
        await register(identifier, password, username, name);
        toast.success("Account created!", {
          description: `Your CIRKLE username is @${username}`,
        });
      }
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        {/* Logo + title */}
        <div className="flex flex-col items-center gap-3 pt-2 pb-4">
          <MashahdMark size={48} />
          <DialogTitle className="text-xl font-display text-center">
            {mode === "login" ? "Welcome back" : "Join Mashahd"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {mode === "login"
              ? "Sign in with your email, phone, or CIRKLE username."
              : "Create your account and choose your CIRKLE username."}
          </DialogDescription>
        </div>

        <div className="space-y-4">
          {/* Identifier (email / phone / username) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {mode === "login" ? "Email, phone, or username" : "Email or phone number"}
            </label>
            <div className="relative mt-1">
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={mode === "login" ? "you@example.com / +1234... / @username" : "you@example.com"}
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {idType === "email" ? <Mail className="h-4 w-4" /> : idType === "phone" ? <Phone className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
              </span>
            </div>
            {mode === "register" && idType === "username" && (
              <p className="text-xs text-amber-600 mt-1">
                Please enter your email or phone number to register.
              </p>
            )}
          </div>

          {/* Username (register only) — with live availability */}
          {mode === "register" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                CIRKLE username
              </label>
              <div className="relative mt-1">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30))}
                  placeholder="choose a username"
                  className="pl-9 pr-9"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <AtSign className="h-4 w-4" />
                </span>
                {/* Status indicator */}
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {usernameStatus === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {usernameStatus === "available" && <Check className="h-4 w-4 text-emerald-500" />}
                  {usernameStatus === "taken" && <X className="h-4 w-4 text-destructive" />}
                </span>
              </div>
              {/* Availability message */}
              {username.length >= 3 && usernameStatus === "available" && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <Check className="h-3 w-3" /> @{username} is available
                </p>
              )}
              {username.length >= 3 && usernameStatus === "taken" && (
                <div className="mt-1">
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <X className="h-3 w-3" /> @{username} is taken
                  </p>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="text-xs text-muted-foreground">Try:</span>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => setUsername(s)}
                          className="text-xs px-2 py-0.5 rounded-full brand-chip hover:bg-gold/20"
                        >
                          @{s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {username.length >= 3 && usernameStatus === "checking" && (
                <p className="text-xs text-muted-foreground mt-1">Checking availability…</p>
              )}
            </div>
          )}

          {/* Display name (register only) */}
          {mode === "register" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Display name (optional)
              </label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 60))}
                placeholder={username || "Your name"}
                className="mt-1"
              />
            </div>
          )}

          {/* Password */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Password
            </label>
            <div className="relative mt-1">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitting || (mode === "register" && usernameStatus !== "available")}
            className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>

          {/* Toggle login / register */}
          <div className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => { setMode("register"); reset(); }}
                  className="text-[hsl(var(--gold))] font-medium hover:underline"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => { setMode("login"); reset(); }}
                  className="text-[hsl(var(--gold))] font-medium hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
