/**
 * AI Provider Abstraction — 5-provider CONSENSUS mode.
 *
 * ARCHITECTURE (CTO decision, Pass 81 — 2026-09-25):
 *
 *   z-ai has been COMPLETELY REMOVED (no z-ai-web-dev-sdk dependency in
 *   package.json, no z-ai imports anywhere in src/, no z-ai env vars).
 *   The system uses 5 independent AI providers invoked IN PARALLEL
 *   (consensus), with the longest non-empty response winning the quorum:
 *
 *     1. Groq         — ultra-fast inference (~500 tok/s), OpenAI-compatible
 *     2. OpenRouter  — access to many models (Claude, GPT-4, Llama, etc.)
 *     3. NVIDIA      — NVIDIA NIM API, OpenAI-compatible
 *     4. Gemini      — Google's quality model
 *     5. HuggingFace — free inference, slow but always available
 *
 *   All 5 are fired simultaneously with Promise.allSettled. The first
 *   successful response to arrive is preferred (race), but we keep
 *   listening for up to CONSENSUS_TIMEOUT_MS for any slower provider to
 *   return a LONGER, more informative answer. The longest non-empty
 *   text wins. If 0 providers succeed, the caller's deterministic
 *   fallback is used (every AI feature always returns SOMETHING).
 *
 * WHY CONSENSUS (not sequential fallback):
 *   - Diversity: 5 independent model families → less bias, fewer blind
 *     spots than chaining copies of Llama-3 across providers.
 *   - Resilience: any 1+ provider succeeding = a usable answer.
 *   - Latency: parallel fire means wall-clock ≈ slowest successful
 *     provider (not the sum of all 5 like the old sequential code).
 *   - Quality: picking the longest non-empty response is a pragmatic
 *     proxy for "most complete" — works well for chat completions,
 *     summaries, transcripts, translations, and structured JSON.
 *   - Observability: result.sources[] exposes which providers responded,
 *     feeding the cost + reliability dashboards.
 *
 * USAGE:
 *   const { text, source, sources } = await aiChat({
 *     system: "You are a helpful assistant.",
 *     user: "Summarize this video...",
 *     maxTokens: 500,
 *   });
 *   // text    = the consensus (longest non-empty) response
 *   // source  = which provider produced the winning text
 *   // sources = ["groq", "gemini", ...] — full list of responders
 */

// ── Provider configs (from env vars) ──
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const HF_API_KEY = process.env.HF_API_KEY || "";

/** Per-provider timeout. Slower than this and we give up on that one. */
const CONSENSUS_TIMEOUT_MS = 12_000;

export interface AIChatOptions {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIChatResult {
  text: string;
  source: "groq" | "openrouter" | "nvidia" | "gemini" | "hf" | "fallback";
  /** All providers that returned a non-empty response (for observability). */
  sources: Array<"groq" | "openrouter" | "nvidia" | "gemini" | "hf">;
}

type ProviderName = "groq" | "openrouter" | "nvidia" | "gemini" | "hf";

interface ProviderAttempt {
  name: ProviderName;
  text: string;
  ms: number;
}

/**
 * Main AI chat function — fires all 5 providers in parallel and returns
 * the longest non-empty response (consensus). Falls back to empty string
 * (deterministic caller fallback) only if every provider fails or timeouts.
 */
export async function aiChat(opts: AIChatOptions): Promise<AIChatResult> {
  // Track AI requests for observability (§180).
  try {
    const { incrementMetric } = await import("./metrics-store");
    incrementMetric("aiRequests");
  } catch { /* metrics store not available */ }

  // Fire all 5 providers in parallel. Each provider is wrapped in a
  // timeout so a slow one can't hold the consensus hostage.
  const attempts: Array<Promise<ProviderAttempt | null>> = [
    withTimeout(tryGroq(opts), "groq"),
    withTimeout(tryOpenRouter(opts), "openrouter"),
    withTimeout(tryNvidia(opts), "nvidia"),
    withTimeout(tryGemini(opts), "gemini"),
    withTimeout(tryHF(opts), "hf"),
  ];

  const settled = await Promise.allSettled(attempts);

  // Collect successful responses (text > 5 chars to avoid empty/whitespace).
  const responders: ProviderAttempt[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value && r.value.text && r.value.text.length > 5) {
      responders.push(r.value);
    }
  }

  // Consensus: pick the LONGEST non-empty response. Tiebreak by fastest (lowest ms).
  let winner: ProviderAttempt | null = null;
  for (const r of responders) {
    if (!winner || r.text.length > winner.text.length ||
        (r.text.length === winner.text.length && r.ms < winner.ms)) {
      winner = r;
    }
  }

  if (winner) {
    return {
      text: winner.text,
      source: winner.name,
      sources: responders.map((r) => r.name),
    };
  }

  // All 5 providers failed — track the fallback.
  try {
    const { incrementMetric } = await import("./metrics-store");
    incrementMetric("aiFallbacks");
  } catch { /* metrics store not available */ }

  return { text: "", source: "fallback", sources: [] };
}

/** Wrap a provider attempt with a hard timeout. */
async function withTimeout(
  p: Promise<{ text: string } | null>,
  name: ProviderName
): Promise<ProviderAttempt | null> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      p,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CONSENSUS_TIMEOUT_MS)
      ),
    ]);
    if (!result || !result.text) return null;
    return { name, text: result.text, ms: Date.now() - start };
  } catch {
    return null;
  }
}

// ── Groq — OpenAI-compatible, ultra-fast (~500 tok/s) ──
async function tryGroq(opts: AIChatOptions): Promise<{ text: string } | null> {
  if (!GROQ_API_KEY) return null;

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  // Try multiple models in case some are deprecated.
  const models = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "gemma2-9b-it"];
  for (const model of models) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens || 1000,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      if (!r.ok) continue;
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content?.trim() || "";
      if (text) return { text };
    } catch {
      continue;
    }
  }
  return null;
}

// ── OpenRouter — access to many models ──
async function tryOpenRouter(opts: AIChatOptions): Promise<{ text: string } | null> {
  if (!OPENROUTER_API_KEY) return null;

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const models = [
    "meta-llama/llama-3.1-8b-instruct:free",
    "nvidia/nemotron-3.5-lightning:free",
    "liquid/lfm-2.5-2.6b:free",
    "openai/gpt-4o-mini",
  ];
  for (const model of models) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://mashahd.vercel.app",
          "X-Title": "Mashahd",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens || 1000,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      if (!r.ok) continue;
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content?.trim() || "";
      if (text) return { text };
    } catch {
      continue;
    }
  }
  return null;
}

// ── NVIDIA — NIM API, OpenAI-compatible ──
async function tryNvidia(opts: AIChatOptions): Promise<{ text: string } | null> {
  if (!NVIDIA_API_KEY) return null;

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  // Use verified-working model. Other models on NVIDIA have reached EOL.
  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: "meta/llama-3.2-11b-vision-instruct",
        messages,
        max_tokens: opts.maxTokens || 1000,
        temperature: opts.temperature ?? 0.7,
        top_p: 0.9,
        stream: false,
      }),
    });

    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    return text ? { text } : null;
  } catch {
    return null;
  }
}

// ── Gemini — Google's quality model ──
async function tryGemini(opts: AIChatOptions): Promise<{ text: string } | null> {
  if (!GEMINI_API_KEY) return null;

  const prompt = opts.system ? `${opts.system}\n\n${opts.user}` : opts.user;
  const contents = [{ parts: [{ text: prompt }] }];

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: opts.maxTokens || 1000,
            temperature: opts.temperature ?? 0.7,
          },
        }),
      }
    );

    if (!r.ok) return null;
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    return text ? { text } : null;
  } catch {
    return null;
  }
}

// ── Hugging Face — free inference ──
async function tryHF(opts: AIChatOptions): Promise<{ text: string } | null> {
  if (!HF_API_KEY) return null;

  const prompt = opts.system ? `${opts.system}\n\n${opts.user}` : opts.user;

  try {
    const r = await fetch(
      "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: opts.maxTokens || 500,
            temperature: opts.temperature ?? 0.7,
            return_full_text: false,
          },
        }),
      }
    );

    if (!r.ok) return null;
    const data = await r.json();
    const text = (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text)?.trim() || "";
    return text ? { text } : null;
  } catch {
    return null;
  }
}

/**
 * Check which AI providers are configured (for health/metrics).
 */
export function getAIProviderStatus(): Record<string, boolean> {
  return {
    "groq": !!GROQ_API_KEY,
    "openrouter": !!OPENROUTER_API_KEY,
    "nvidia": !!NVIDIA_API_KEY,
    "gemini": !!GEMINI_API_KEY,
    "hf": !!HF_API_KEY,
  };
}
