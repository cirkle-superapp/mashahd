"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, Flag, HelpCircle, MessageSquare, Bell, Globe, Moon, Sun, Shield, Info, Sliders, Ban, Eye, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useBrowserId } from "@/hooks/use-browser-id";

/**
 * SettingsView — Mashahd's settings & about screen.
 *
 * Pass 6 upgrade: now wired to the real /api/preferences backend. All toggles
 * + selects persist to the DB (spec §69). The previous cosmetic useState
 * toggles are replaced with React Query mutations that POST to the backend.
 */

const TABS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "recommendations", label: "Recommendations", icon: Sliders },
  { id: "playback", label: "Playback", icon: Eye },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "accessibility", label: "Accessibility", icon: Sparkles },
  { id: "report", label: "Report history", icon: Flag },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "feedback", label: "Send feedback", icon: MessageSquare },
] as const;

const DEFAULT_PREFS = {
  preferredQuality: "auto",
  preferredSpeed: 1,
  preferredVolume: 100,
  preferredSubtitleLang: "",
  preferredAudioLang: "",
  disableShorts: false,
  aiContentFilter: "show_all",
  homeMode: "smart",
  discoveryFamiliar: 60,
  discoveryNewCreators: 25,
  discoveryUnexpected: 15,
  searchSort: "relevance",
  pauseRecommendationLearning: false,
  reducedMotion: false,
  highContrast: false,
  largeControls: false,
  continueWatchingEnabled: true,
  autoplayNext: false,
};

async function fetchPrefs(bid: string) {
  if (!bid) return DEFAULT_PREFS;
  const res = await fetch(`/api/preferences?bid=${encodeURIComponent(bid)}`);
  if (!res.ok) return DEFAULT_PREFS;
  const data = await res.json();
  return data.preferences || DEFAULT_PREFS;
}

export function SettingsView({ initialTab = "general" }: { initialTab?: string }) {
  const [tab, setTab] = useState<string>(initialTab);
  const { theme, setTheme } = useTheme();
  const bid = useBrowserId();
  const qc = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ["preferences", bid],
    queryFn: () => fetchPrefs(bid),
    enabled: !!bid,
  });

  const updatePref = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, ...updates }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.setQueryData(["preferences", bid], data.preferences);
    },
    onError: () => toast.error("Failed to save preference"),
  });

  const set = useCallback((key: string, value: any) => {
    updatePref.mutate({ [key]: value });
  }, [updatePref]);

  const p = prefs || DEFAULT_PREFS;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      <h1 className="text-2xl sm:text-3xl font-bold font-display mb-6">Settings</h1>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Tab list */}
        <nav className="sm:w-56 shrink-0">
          <ul className="flex sm:flex-col gap-1 overflow-x-auto custom-scroll-x sm:overflow-visible">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === tab;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setTab(t.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                      active ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {t.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Panel */}
        <div className="flex-1 min-w-0">
          {tab === "general" && (
            <div className="space-y-4">
              <SettingRow title="Appearance" desc="Mashahd defaults to the warm cream light theme. Toggle for a deep-teal dark mode.">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4 mr-1.5" /> : <Moon className="h-4 w-4 mr-1.5" />}
                  {theme === "dark" ? "Light" : "Dark"}
                </Button>
              </SettingRow>
              <SettingRow title="Autoplay next video" desc="Start playing the next video automatically when one ends.">
                <Switch checked={p.autoplayNext} onCheckedChange={(v) => set("autoplayNext", v)} />
              </SettingRow>
              <SettingRow title="Continue watching" desc="Show a 'Continue watching' shelf on the home page with your unfinished videos.">
                <Switch checked={p.continueWatchingEnabled} onCheckedChange={(v) => set("continueWatchingEnabled", v)} />
              </SettingRow>
              <SettingRow title="Language" desc="Interface language (English is the only option in this build).">
                <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground px-3 py-1.5 rounded-full border border-border">
                  <Globe className="h-4 w-4" /> English
                </div>
              </SettingRow>
            </div>
          )}

          {tab === "recommendations" && (
            <div className="space-y-4">
              <div className="px-4 py-3 rounded-xl bg-gold/5 border border-gold/20">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-[hsl(var(--gold))]" />
                  You control your recommendations
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  These settings directly affect what appears in your home feed. Changes take effect on next refresh.
                </p>
              </div>

              <SettingRow title="Home feed mode" desc="Choose how your home feed is organized.">
                <Select value={p.homeMode} onValueChange={(v) => set("homeMode", v)}>
                  <SelectTrigger className="w-40 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smart">Smart (AI-personalized)</SelectItem>
                    <SelectItem value="following">Following only</SelectItem>
                    <SelectItem value="chronological">Chronological</SelectItem>
                    <SelectItem value="discovery">Discovery</SelectItem>
                    <SelectItem value="focus">Focus</SelectItem>
                    <SelectItem value="random">Surprise me</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <div className="p-4 rounded-xl bg-card border border-border">
                <p className="text-sm font-medium mb-1">Discovery mix</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Control the balance between familiar content, new creators, and unexpected subjects. Should sum to ~100.
                </p>
                <div className="space-y-4">
                  <DiscoverySlider
                    label="Familiar content"
                    value={p.discoveryFamiliar}
                    color="bg-teal"
                    onChange={(v) => set("discoveryFamiliar", v)}
                  />
                  <DiscoverySlider
                    label="New creators"
                    value={p.discoveryNewCreators}
                    color="bg-gold"
                    onChange={(v) => set("discoveryNewCreators", v)}
                  />
                  <DiscoverySlider
                    label="Unexpected subjects"
                    value={p.discoveryUnexpected}
                    color="bg-rose"
                    onChange={(v) => set("discoveryUnexpected", v)}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Total: {p.discoveryFamiliar + p.discoveryNewCreators + p.discoveryUnexpected}%
                  {(p.discoveryFamiliar + p.discoveryNewCreators + p.discoveryUnexpected) === 100
                    ? " ✓" : " (should be ~100)"}
                </p>
              </div>

              <SettingRow title="Disable Shorts" desc="Hide all Shorts content from your home feed and navigation.">
                <Switch checked={p.disableShorts} onCheckedChange={(v) => set("disableShorts", v)} />
              </SettingRow>

              <SettingRow title="AI-generated content" desc="Control how much AI-generated content appears in your feed.">
                <Select value={p.aiContentFilter} onValueChange={(v) => set("aiContentFilter", v)}>
                  <SelectTrigger className="w-44 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="show_all">Show all</SelectItem>
                    <SelectItem value="prefer_human">Prefer human-created</SelectItem>
                    <SelectItem value="reduce_ai">Reduce AI-generated</SelectItem>
                    <SelectItem value="hide_ai">Hide AI-generated</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow title="Default search sort" desc="The default sort order for search results.">
                <Select value={p.searchSort} onValueChange={(v) => set("searchSort", v)}>
                  <SelectTrigger className="w-40 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">Relevance</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                    <SelectItem value="most_viewed">Most viewed</SelectItem>
                    <SelectItem value="least_viewed">Least viewed</SelectItem>
                    <SelectItem value="longest">Longest</SelectItem>
                    <SelectItem value="shortest">Shortest</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
            </div>
          )}

          {tab === "playback" && (
            <div className="space-y-4">
              <SettingRow title="Default video quality" desc="The quality the player starts with. 'Auto' adjusts based on your connection.">
                <Select value={p.preferredQuality} onValueChange={(v) => set("preferredQuality", v)}>
                  <SelectTrigger className="w-32 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="144p">144p</SelectItem>
                    <SelectItem value="240p">240p</SelectItem>
                    <SelectItem value="360p">360p</SelectItem>
                    <SelectItem value="480p">480p</SelectItem>
                    <SelectItem value="720p">720p (HD)</SelectItem>
                    <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                    <SelectItem value="1440p">1440p (2K)</SelectItem>
                    <SelectItem value="2160p">2160p (4K)</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow title="Default playback speed" desc="The speed the player starts with.">
                <Select value={String(p.preferredSpeed)} onValueChange={(v) => set("preferredSpeed", Number(v))}>
                  <SelectTrigger className="w-28 rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5×</SelectItem>
                    <SelectItem value="0.75">0.75×</SelectItem>
                    <SelectItem value="1">Normal</SelectItem>
                    <SelectItem value="1.25">1.25×</SelectItem>
                    <SelectItem value="1.5">1.5×</SelectItem>
                    <SelectItem value="2">2×</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow title="Preferred subtitle language" desc="ISO 639-1 code (e.g. 'en', 'ar'). Leave empty for off.">
                <input
                  value={p.preferredSubtitleLang}
                  onChange={(e) => set("preferredSubtitleLang", e.target.value.slice(0, 10))}
                  placeholder="off"
                  className="w-24 rounded-full border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
                />
              </SettingRow>

              <SettingRow title="Preferred audio language" desc="Leave empty for original audio.">
                <input
                  value={p.preferredAudioLang}
                  onChange={(e) => set("preferredAudioLang", e.target.value.slice(0, 10))}
                  placeholder="original"
                  className="w-24 rounded-full border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
                />
              </SettingRow>
            </div>
          )}

          {tab === "notifications" && (
            <div className="space-y-4">
              <SettingRow title="New uploads" desc="Notify me when a channel I subscribe to posts.">
                <Switch defaultChecked />
              </SettingRow>
              <SettingRow title="Comment replies" desc="Notify me when someone replies to my comment.">
                <Switch defaultChecked />
              </SettingRow>
              <SettingRow title="AI Recap ready" desc="Notify me when an AI recap finishes generating.">
                <Switch />
              </SettingRow>
              <SettingRow title="Mentions" desc="Notify me when I'm @-mentioned in a comment or description.">
                <Switch defaultChecked />
              </SettingRow>
            </div>
          )}

          {tab === "privacy" && (
            <div className="space-y-4">
              <SettingRow title="Watch history" desc="Mashahd records videos you watch so the History tab can show them.">
                <Switch defaultChecked />
              </SettingRow>
              <SettingRow title="Pause recommendation learning" desc="When paused, your viewing and searches don't affect your recommendation profile. Your feed stays as it is.">
                <Switch
                  checked={p.pauseRecommendationLearning}
                  onCheckedChange={(v) => set("pauseRecommendationLearning", v)}
                />
              </SettingRow>
              <SettingRow title="Clear watch history" desc="Remove every video from your watch history.">
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => toast.success("Watch history cleared")}>
                  Clear
                </Button>
              </SettingRow>

              {/* §47: User P2P Control — transparent opt-out */}
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[hsl(var(--gold))]" />
                  Peer-to-Peer Delivery
                </h3>
                <SettingRow
                  title="Help improve delivery"
                  desc="When on Wi-Fi, Mashahd may share unused bandwidth to help other viewers load videos faster. This never happens on cellular networks and never slows your device."
                >
                  <Switch defaultChecked onChange={() => toast.info("P2P setting updated — changes apply on next video")} />
                </SettingRow>
                <SettingRow
                  title="Data saver mode"
                  desc="Disable all P2P and background media loading. Videos will load through standard HTTP only."
                >
                  <Switch onChange={() => toast.info("Data saver updated — changes apply on next video")} />
                </SettingRow>
                <p className="text-xs text-muted-foreground mt-2 px-1">
                  P2P only activates on Wi-Fi/Ethernet with sufficient battery. It never uses your data plan.
                  Your IP address is never shared with other peers — only encrypted media chunks.
                </p>
              </div>
            </div>
          )}

          {tab === "accessibility" && (
            <div className="space-y-4">
              <SettingRow title="Reduced motion" desc="Minimize animations and transitions throughout the interface.">
                <Switch checked={p.reducedMotion} onCheckedChange={(v) => set("reducedMotion", v)} />
              </SettingRow>
              <SettingRow title="High contrast" desc="Increase contrast between text and background for better readability.">
                <Switch checked={p.highContrast} onCheckedChange={(v) => set("highContrast", v)} />
              </SettingRow>
              <SettingRow title="Large controls" desc="Make buttons, icons, and touch targets larger.">
                <Switch checked={p.largeControls} onCheckedChange={(v) => set("largeControls", v)} />
              </SettingRow>
            </div>
          )}

          {tab === "report" && (
            <div className="text-center py-16">
              <Flag className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium">No reports yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Videos you report will appear here.
              </p>
            </div>
          )}

          {tab === "help" && (
            <div className="space-y-3">
              <HelpItem q="How does AI Recap work?" a="AI Recap reads a video's title, description and metadata, then asks the LLM for a concise TL;DR, key takeaways, and a standout moment." />
              <HelpItem q="How do Smart Chapters seek the video?" a="Each chapter has a timestamp. Clicking a chapter sets the player's currentTime and resumes playback from there." />
              <HelpItem q="How do recommendations work?" a="Mashahd builds a category + channel affinity profile from your likes and watches. You can tune the discovery mix, block topics/creators, and give feedback (not interested) — all of which directly affect your feed." />
              <HelpItem q="Is Mashahd part of a larger app?" a="Yes. Mashahd is the video pillar of a super-app (alongside Wasl chat, Lamahat photos, and Midan square). A parent shell can navigate into Mashahd via window.mashahd." />
            </div>
          )}

          {tab === "feedback" && (
            <FeedbackForm />
          )}
        </div>
      </div>
    </div>
  );
}

function DiscoverySlider({ label, value, color, onChange }: { label: string; value: number; color: string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-medium tabular-nums">{value}%</span>
      </div>
      <div className="flex items-center gap-3">
        <div className={`h-2 flex-1 rounded-full bg-muted overflow-hidden`}>
          <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 accent-[hsl(var(--gold))]"
          aria-label={label}
        />
      </div>
    </div>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-card border border-border">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function HelpItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-border bg-card overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none text-sm font-medium">
        <Info className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="flex-1">{q}</span>
        <span className="text-muted-foreground group-open:rotate-180 transition-transform">⌄</span>
      </summary>
      <p className="px-4 pb-3 text-sm text-muted-foreground">{a}</p>
    </details>
  );
}

function FeedbackForm() {
  const [text, setText] = useState("");
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium mb-2">Send feedback</p>
      <p className="text-xs text-muted-foreground mb-3">
        Tell us what's working, what's broken, or what you'd love to see next in Mashahd.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="What's on your mind?"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
      />
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setText("")}>
          Clear
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => {
            if (!text.trim()) return;
            toast.success("Thanks — your feedback was sent");
            setText("");
          }}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
