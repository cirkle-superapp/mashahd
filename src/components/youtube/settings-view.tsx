"use client";

import { useState } from "react";
import { Settings as SettingsIcon, Flag, HelpCircle, MessageSquare, Bell, Globe, Moon, Sun, Shield, Info } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * SettingsView — Mashahd's settings & about screen. Every sidebar item in
 * the "Settings" group routes here via the `?v=settings&tab=...` view.
 */
const TABS = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Shield },
  { id: "report", label: "Report history", icon: Flag },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "feedback", label: "Send feedback", icon: MessageSquare },
] as const;

export function SettingsView({ initialTab = "general" }: { initialTab?: string }) {
  const [tab, setTab] = useState<string>(initialTab);
  const { theme, setTheme } = useTheme();
  const [autoplay, setAutoplay] = useState(true);
  const [reducedData, setReducedData] = useState(false);

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
              <SettingRow
                title="Appearance"
                desc="Mashahd defaults to the warm cream light theme. Toggle for a deep-teal dark mode."
              >
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
              <SettingRow title="Autoplay" desc="Start playing the next video automatically when one ends.">
                <Switch checked={autoplay} onCheckedChange={setAutoplay} />
              </SettingRow>
              <SettingRow title="Reduced data" desc="Pause background video loading on cellular connections.">
                <Switch checked={reducedData} onCheckedChange={setReducedData} />
              </SettingRow>
              <SettingRow title="Language" desc="Interface language (English is the only option in this build).">
                <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground px-3 py-1.5 rounded-full border border-border">
                  <Globe className="h-4 w-4" /> English
                </div>
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
              <SettingRow title="Pause watch history" desc="Stop recording new videos to your history.">
                <Switch />
              </SettingRow>
              <SettingRow title="Clear watch history" desc="Remove every video from your watch history.">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => toast.success("Watch history cleared")}
                >
                  Clear
                </Button>
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
              <HelpItem q="Does Live Translate work offline?" a="No — translation calls the z-ai LLM. If the service is unreachable, the original text is shown unchanged." />
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
