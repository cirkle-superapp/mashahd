"use client";

import { Shield, FileText, Cookie, ArrowLeft } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/**
 * LegalView — Terms of Service, Privacy Policy, Cookie Policy (Pass 102).
 *
 * Renders in-app as a view (not a separate route) per the single-route
 * architecture. Accessible from the footer via ?v=legal&section=terms.
 *
 * Closes the "no ToS/Privacy Policy" red flag from the go-live audit.
 * Mashahd-specific: references the 5-service zero-cost architecture,
 * browser-id (not email-based) identity, and the open-data layer.
 */
const SECTIONS = [
  { id: "terms" as const, label: "Terms of Service", icon: FileText },
  { id: "privacy" as const, label: "Privacy Policy", icon: Shield },
  { id: "cookies" as const, label: "Cookie Policy", icon: Cookie },
];

export function LegalView({ section = "terms" }: { section?: "terms" | "privacy" | "cookies" }) {
  const navigate = useAppStore((s) => s.navigate);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto pb-24">
      {/* Back link */}
      <button
        onClick={() => navigate({ kind: "home" })}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6 min-h-[44px] py-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to home
      </button>

      {/* Section tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => navigate({ kind: "legal", section: s.id })}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                section === s.id
                  ? "border-gold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      {section === "terms" && <TermsOfService />}
      {section === "privacy" && <PrivacyPolicy />}
      {section === "cookies" && <CookiePolicy />}
    </div>
  );
}

function TermsOfService() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
      <p className="text-xs text-muted-foreground mb-6">Last updated: {new Date().getFullYear()}</p>

      <h2 className="text-lg font-semibold mt-6 mb-2">1. Acceptance of Terms</h2>
      <p className="text-sm text-muted-foreground">
        By accessing Mashahd (مشاهِد), you agree to these Terms. If you do not agree, please discontinue use.
        Mashahd is a video streaming platform operated on a zero-cost infrastructure (GitHub, Vercel, Turso, Neon, Inngest).
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">2. User Identity</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd uses a browser-based identity system (Browser ID) — not email-based accounts. Your identity is
        cryptographically tied to your browser and is not shared with third parties. You may reset your identity
        at any time by clearing browser storage.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">3. Content</h2>
      <p className="text-sm text-muted-foreground">
        You retain ownership of content you upload. By uploading, you grant Mashahd a license to host, display,
        and process your content through the platform's AI features (summarization, transcription, chapters,
        translation, consensus analysis). Mashahd does not claim ownership of your content.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">4. AI Processing</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd processes content through a 5-provider AI consensus system (CIRKLE BRAIN). AI outputs are
        probabilistic and may contain errors. You are responsible for verifying AI-generated content before
        relying on it.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">5. Acceptable Use</h2>
      <p className="text-sm text-muted-foreground">
        You agree not to: upload copyrighted material you do not own, harass other users, attempt to disrupt
        the service, or use automated systems to scrape content at scale. Violations may result in content
        removal or account suspension.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">6. Disclaimers</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd is provided "as is" without warranties. The service may be unavailable during maintenance or
        due to free-tier infrastructure limits. We are not liable for data loss, service interruption, or
        AI-generated content accuracy.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">7. Open Data</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd ships with open-source reference data (countries, languages, currencies, emoji, timezones)
        under MIT, CC0, or public domain licenses. This data is not warrantied for accuracy.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">8. Contact</h2>
      <p className="text-sm text-muted-foreground">
        For questions about these Terms, open an issue on our GitHub repository.
      </p>
    </article>
  );
}

function PrivacyPolicy() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">Last updated: {new Date().getFullYear()}</p>

      <h2 className="text-lg font-semibold mt-6 mb-2">1. Data We Collect</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd collects minimal data: a cryptographic Browser ID (no email required), watch history (to power
        recommendations and streaks), and engagement signals (likes, comments, reactions). We do NOT collect:
        email addresses, phone numbers, real names, precise location, or payment information.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">2. How We Use Data</h2>
      <p className="text-sm text-muted-foreground">
        Your data powers: personalized recommendations, watch streaks, watch rewards, mood-based filtering,
        and AI consensus features. Your Browser ID is used to associate your activity across sessions without
        requiring an account.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">3. Data Storage</h2>
      <p className="text-sm text-muted-foreground">
        Data is stored in: Turso (primary database), Neon (analytics + disaster recovery mirror), and your
        browser's localStorage (preferences, redeemed rewards, dismissed ads). Video content flows through
        a P2P network and CDN — segments are not stored in our database.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">4. AI Processing</h2>
      <p className="text-sm text-muted-foreground">
        When you use AI features, your content is sent to up to 5 AI providers (Groq, OpenRouter, NVIDIA,
        Gemini, HuggingFace) for consensus processing. Each provider has its own privacy policy. We do not
        store the raw AI responses beyond what is needed to display the feature.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">5. Third Parties</h2>
      <p className="text-sm text-muted-foreground">
        We use: GitHub (source hosting), Vercel (web hosting), Turso (database), Neon (analytics),
        Inngest (job processing). None of these receive your personal data beyond what is necessary for
        the service to function.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">6. Your Rights</h2>
      <p className="text-sm text-muted-foreground">
        You may: request data export (via /api/data-export), reset your identity (clear browser storage),
        or request deletion (open an issue on GitHub). Since we use Browser IDs, clearing your browser
        storage effectively deletes your local identity.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">7. Cookies</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd uses localStorage (not cookies) for preferences. See our Cookie Policy for details.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">8. Children</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd is not directed to children under 13. We do not knowingly collect data from children.
        Content ratings (G, PG, T, MA) are applied to age-restrict sensitive content.
      </p>
    </article>
  );
}

function CookiePolicy() {
  return (
    <article className="prose prose-sm dark:prose-invert max-w-none">
      <h1 className="text-2xl font-bold mb-2">Cookie Policy</h1>
      <p className="text-xs text-muted-foreground mb-6">Last updated: {new Date().getFullYear()}</p>

      <h2 className="text-lg font-semibold mt-6 mb-2">1. LocalStorage, Not Cookies</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd primarily uses browser localStorage instead of cookies. localStorage stays on your device
        and is not sent to servers with each request (unlike cookies). This is a privacy-first approach.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">2. What We Store</h2>
      <ul className="text-sm text-muted-foreground list-disc pl-6 space-y-1">
        <li><strong>Browser ID:</strong> your cryptographic identity (no email)</li>
        <li><strong>Theme preference:</strong> light/dark mode</li>
        <li><strong>Watch progress:</strong> resume positions per video</li>
        <li><strong>Redeemed rewards:</strong> which reward tiers you've claimed</li>
        <li><strong>Dismissed ads:</strong> which sponsored content you've closed</li>
        <li><strong>Quality preference:</strong> preferred video resolution</li>
      </ul>

      <h2 className="text-lg font-semibold mt-6 mb-2">3. Service Worker</h2>
      <p className="text-sm text-muted-foreground">
        Mashahd registers a service worker for offline support (PWA). The service worker caches the app shell
        and static assets. It NEVER caches video segments (those flow through P2P/CDN). You can clear the
        service worker cache via your browser's "Clear browsing data" &gt; "Cached images and files".
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">4. Third-Party Services</h2>
      <p className="text-sm text-muted-foreground">
        Our infrastructure providers (Vercel, Turso, Neon) may set their own cookies for operational purposes.
        See their respective privacy policies for details.
      </p>

      <h2 className="text-lg font-semibold mt-6 mb-2">5. Managing Storage</h2>
      <p className="text-sm text-muted-foreground">
        You can clear all Mashahd localStorage by: Settings → Reset, or your browser's "Clear site data".
        This will reset your identity, preferences, and watch history.
      </p>
    </article>
  );
}
