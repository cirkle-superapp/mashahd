"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  MessageSquarePlus,
  Wand2,
  Compass,
  X,
  Send,
  RefreshCw,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * AiWatchPanel — a tabbed overlay on the watch page that exposes three
 * CIRKLE-inspired AI features:
 *
 *   1. **Starters** (ai-conversation-starters) — 4 comment-style
 *      conversation starters the viewer can post as-is.
 *   2. **Oracle** (cirkle-oracle) — ask a question about the video, get a
 *      grounded answer.
 *   3. **Tone** (ai-tone-adjuster) — rewrite a draft comment in a
 *      different tone before posting.
 *
 * The panel is opened via the `mashahd:ai-watch` window event (dispatched
 * from the command palette or a chip button on the watch page).
 */

type Tab = "starters" | "oracle" | "tone";

export function AiWatchPanel({
  videoId,
  onUseStarter,
}: {
  videoId: string;
  onUseStarter?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("starters");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: Tab }>).detail;
      setOpen(true);
      if (detail?.tab) setTab(detail.tab);
    };
    window.addEventListener("mashahd:ai-watch", handler);
    return () => window.removeEventListener("mashahd:ai-watch", handler);
  }, []);

  if (!open) return null;

  return (
    <div className="mt-4 rounded-xl border border-gold/25 bg-gradient-to-br from-[hsl(var(--gold)/0.06)] to-transparent overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gold/15 bg-[hsl(var(--gold)/0.05)]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" />
          <span className="text-sm font-semibold gradient-text-gold">Mashahd AI</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="p-1.5 rounded-full hover:bg-accent text-muted-foreground"
          aria-label="Close AI panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton active={tab === "starters"} onClick={() => setTab("starters")} icon={MessageSquarePlus} label="Starters" />
        <TabButton active={tab === "oracle"} onClick={() => setTab("oracle")} icon={Compass} label="Oracle" />
        <TabButton active={tab === "tone"} onClick={() => setTab("tone")} icon={Wand2} label="Tone" />
      </div>

      <div className="p-4">
        {tab === "starters" && (
          <StartersTab videoId={videoId} onUse={onUseStarter} />
        )}
        {tab === "oracle" && <OracleTab videoId={videoId} />}
        {tab === "tone" && <ToneTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2",
        active
          ? "border-gold text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/* ── Starters tab ── */

function StartersTab({
  videoId,
  onUse,
}: {
  videoId: string;
  onUse?: (text: string) => void;
}) {
  const [used, setUsed] = useState<Set<number>>(new Set());
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/starters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ ok: boolean; starters: string[]; source: string }>;
    },
    onError: () => toast.error("Could not generate starters"),
  });

  useEffect(() => {
    if (!mutation.data && !mutation.isPending) mutation.mutate();
  }, [videoId]);

  const starters = mutation.data?.starters || [];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        Comment starters tailored to this video. Tap to use one.
      </p>
      {mutation.isPending && !mutation.data ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 shimmer-gold rounded-lg" />
        ))
      ) : (
        starters.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              onUse?.(s);
              setUsed((u) => new Set(u).add(i));
              toast.success("Loaded into the comment box");
            }}
            className="w-full text-left flex items-start gap-2 p-2.5 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-sm"
          >
            <span className="text-[hsl(var(--gold))] font-bold shrink-0">{i + 1}.</span>
            <span className="flex-1">{s}</span>
            {used.has(i) && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
          </button>
        ))
      )}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 mt-1"
      >
        <RefreshCw className={cn("h-3 w-3", mutation.isPending && "animate-spin")} />
        Regenerate
      </button>
    </div>
  );
}

/* ── Oracle tab ── */

function OracleTab({ videoId }: { videoId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/oracle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, question }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ ok: boolean; answer: string; source: string }>;
    },
    onSuccess: (data) => {
      setAnswer(data.answer);
      if (data.source === "fallback") toast.info("Oracle offline — fallback reply");
    },
    onError: () => toast.error("The Oracle has no answer right now"),
  });

  const ask = () => {
    if (!question.trim()) return;
    setAnswer(null);
    mutation.mutate();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Ask the Oracle anything about this video.
      </p>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="e.g. What skill level is this aimed at?"
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
        />
        <Button
          size="sm"
          className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3"
          onClick={ask}
          disabled={mutation.isPending || !question.trim()}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {answer && (
        <div className="p-3 rounded-lg border border-gold/20 bg-[hsl(var(--gold)/0.06)] text-sm leading-relaxed">
          <p className="text-xs font-semibold text-[hsl(var(--gold))] uppercase tracking-wide mb-1">
            Oracle
          </p>
          {answer}
        </div>
      )}
      {!answer && !mutation.isPending && (
        <p className="text-xs text-muted-foreground italic">
          Try: “Is this beginner-friendly?” or “What should I watch next from this channel?”
        </p>
      )}
    </div>
  );
}

/* ── Tone tab ── */

const TONES = [
  { id: "friendly", label: "Friendly" },
  { id: "witty", label: "Witty" },
  { id: "formal", label: "Formal" },
  { id: "concise", label: "Concise" },
  { id: "enthusiastic", label: "Enthusiastic" },
] as const;

function ToneTab() {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<string>("friendly");
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft, tone: activeTone }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ ok: boolean; text: string; source: string }>;
    },
    onSuccess: (data) => {
      setResult(data.text);
      if (data.source === "fallback") toast.info("AI offline — showing original");
      else toast.success(`Rewritten in a ${activeTone} tone`);
    },
    onError: () => toast.error("Could not rewrite"),
  });

  const rewrite = () => {
    if (!draft.trim()) return;
    setResult(null);
    mutation.mutate();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Draft a comment, pick a tone, and rewrite before posting.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="Write your comment…"
        maxLength={500}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60 resize-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {TONES.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTone(t.id)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
              activeTone === t.id
                ? "bg-gradient-gold text-charcoal"
                : "brand-chip"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Button
        size="sm"
        className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={rewrite}
        disabled={mutation.isPending || !draft.trim()}
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
        Rewrite
      </Button>
      {result && (
        <div className="p-3 rounded-lg border border-gold/20 bg-[hsl(var(--gold)/0.06)]">
          <p className="text-xs font-semibold text-[hsl(var(--gold))] uppercase tracking-wide mb-1">
            {activeTone} version
          </p>
          <p className="text-sm">{result}</p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(result).catch(() => {});
              toast.success("Copied to clipboard");
            }}
            className="text-xs text-muted-foreground hover:text-foreground mt-2"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
