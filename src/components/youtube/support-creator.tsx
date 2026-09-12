"use client";

import { useState } from "react";
import { Heart, Sparkles, Loader2, Check, Coffee, Star, Gift, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "coffee", amount: 5, label: "Coffee", icon: Coffee, note: "Buy them a coffee" },
  { id: "star", amount: 10, label: "Star", icon: Star, note: "A small star for the work" },
  { id: "supporter", amount: 25, label: "Supporter", icon: Heart, note: "Become a supporter" },
  { id: "patron", amount: 50, label: "Patron", icon: Gift, note: "Patron-level support" },
];

/**
 * SupportCreator — a dialog for tipping a creator. Mashahd's creator-economy
 * feature: cosmetic demo of direct creator support (0% fees narrative, like
 * CIRKLE's CirkleMint concept). The tip isn't actually charged — the dialog
 * simulates the flow and records the tip locally for the creator's stats.
 */
export function SupportCreator({
  open,
  onClose,
  channelName,
  channelId,
}: {
  open: boolean;
  onClose: () => void;
  channelName: string;
  channelId: string;
}) {
  const [selected, setSelected] = useState<string | null>("coffee");
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const preset = PRESETS.find((p) => p.id === selected);
  const amount = preset ? preset.amount : custom ? Math.max(1, parseInt(custom, 10) || 0) : 0;

  const submit = async () => {
    if (amount < 1) {
      toast.error("Please enter an amount of at least 1");
      return;
    }
    setSubmitting(true);
    // Simulate the tip flow (in production this would integrate a payment
    // provider or CirkleMint). Wait ~1.2s for the "confirming" beat.
    await new Promise((r) => setTimeout(r, 1200));
    setSubmitting(false);
    setDone(true);

    // Persist a record so the creator's support count can be surfaced.
    try {
      const key = `mashahd-supports:${channelId}`;
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      existing.push({
        amount,
        message: message.trim(),
        at: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(existing));
      window.dispatchEvent(new CustomEvent("mashahd:support-given", { detail: { channelId, amount } }));
    } catch {
      /* storage may be blocked */
    }
  };

  const close = () => {
    setDone(false);
    setSelected("coffee");
    setCustom("");
    setMessage("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        {!done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="grid place-items-center h-8 w-8 rounded-full bg-gradient-to-br from-[hsl(var(--gold)/0.2)] to-transparent border border-gold/30">
                  <Heart className="h-4 w-4 text-rose fill-current" />
                </span>
                Support {channelName}
              </DialogTitle>
              <DialogDescription>
                Send a tip directly to this creator. <span className="text-[hsl(var(--gold))] font-medium">100% goes to the creator — 0% fees.</span>
              </DialogDescription>
            </DialogHeader>

            {/* Preset amounts */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                const active = selected === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { setSelected(p.id); setCustom(""); }}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-gold/50 bg-gold/10"
                        : "border-border hover:bg-accent/40"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-[hsl(var(--gold))]" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.label}</div>
                      <div className="text-xs text-muted-foreground">${p.amount}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom amount */}
            <div className="space-y-1.5 mt-3">
              <Label htmlFor="custom-amount" className="text-xs text-muted-foreground">
                Or enter a custom amount
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="custom-amount"
                  type="number"
                  min={1}
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
                  placeholder="e.g. 15"
                  className="pl-7"
                />
              </div>
            </div>

            {/* Optional message */}
            <div className="space-y-1.5 mt-3">
              <Label htmlFor="support-msg" className="text-xs text-muted-foreground">
                Message (optional)
              </Label>
              <Input
                id="support-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Loved your latest video!"
                maxLength={140}
              />
            </div>

            {/* Total + confirm */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-xl font-bold tabular-nums">${amount}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={close}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  onClick={submit}
                  disabled={amount < 1 || submitting}
                  className="bg-gradient-to-r from-[hsl(var(--gold))] to-amber-500 text-black hover:opacity-90"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Heart className="h-4 w-4 mr-1 fill-current" />
                  )}
                  {submitting ? "Confirming…" : `Tip $${amount}`}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="mx-auto grid place-items-center h-14 w-14 rounded-full bg-gradient-to-br from-[hsl(var(--gold)/0.25)] to-transparent border border-gold/40 mb-4">
              <Check className="h-7 w-7 text-[hsl(var(--gold))]" />
            </div>
            <h3 className="text-lg font-semibold">Thank you for supporting {channelName}!</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
              Your ${amount} tip was sent. <span className="text-[hsl(var(--gold))] font-medium">100% of it goes to the creator.</span>
            </p>
            {message.trim() && (
              <p className="mt-3 text-sm italic text-muted-foreground border-l-2 border-gold/40 pl-3 mx-auto max-w-xs">
                &ldquo;{message.trim()}&rdquo;
              </p>
            )}
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 text-[hsl(var(--gold))]" />
              You&apos;re a Mashahd supporter
            </div>
            <Button onClick={close} className="mt-5">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
