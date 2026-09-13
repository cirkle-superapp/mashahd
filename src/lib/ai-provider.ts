/**
 * AI Provider Abstraction — multi-provider LLM with intelligent routing.
 *
 * ARCHITECTURE (COO/CTO decision):
 *
 * The system has access to multiple AI providers. This module abstracts them
 * behind a single `aiChat()` function that tries providers in priority order
 * and falls back gracefully:
 *
 *   1. z-ai (primary) — already integrated, works locally via .z-ai-config
 *      On Vercel, configured via ZAI_API_KEY + ZAI_BASE_URL env vars.
 *   2. Groq (fallback 1) — ultra-fast inference (~500 tok/s), OpenAI-compatible API
 *   3. Gemini (fallback 2) — Google's quality model, different API shape
 *   4. Hugging Face (fallback 3) — free inference, slow but available
 *   5. Deterministic fallback — always works, returns static content
 *
 * WHY THIS DESIGN:
 *   - No single point of failure: if z-ai is down, Groq takes over
 *   - Zero cost: all providers have free tiers, none require payment card
 *   - Provider independence: any provider can be swapped without code changes
 *   - Graceful degradation: every AI feature always returns SOMETHING
 *
 * USAGE:
 *   const { text, source } = await aiChat({
 *     system: "You are a helpful assistant.",
 *     user: "Summarize this video...",
 *     maxTokens: 500,
 *   });
 *   // text = the LLM response
 *   // source = "z-ai" | "groq" | "gemini" | "hf" | "fallback"
 */

// ── Provider configs (from env vars) ──
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || "https://internal-api.z.ai/v1";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const HF_API_KEY = process.env.HF_API_KEY || "";

export interface AIChatOptions {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIChatResult {
  text: string;
  source: "z-ai" | "groq" | "gemini" | "hf" | "fallback";
}

/**
 * Main AI chat function — tries providers in priority order.
 * Returns the first successful response, or a fallback if all fail.
 */
export async function aiChat(opts: AIChatOptions): Promise<AIChatResult> {
  const providers = [
    () => tryZai(opts),
    () => tryGroq(opts),
    () => tryGemini(opts),
    () => tryHF(opts),
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result && result.text && result.text.length > 10) {
        return result;
      }
    } catch (e) {
      // Provider failed — try the next one.
      console.warn(`[ai-provider] ${e}`);
    }
  }

  // All providers failed — return empty string (caller provides deterministic fallback).
  return { text: "", source: "fallback" };
}

// ── z-ai (primary) ──
// The z-ai SDK uses multiple headers for auth:
//   Authorization: Bearer Z.ai (the platform identifier)
//   X-Z-AI-From: Z (required — identifies the SDK)
//   X-Token: <jwt> (session token with userId + chatId)
//   X-Chat-Id: <chatId> (conversation routing)
//   X-User-Id: <userId> (user routing)
const ZAI_TOKEN = process.env.ZAI_TOKEN || "";
const ZAI_CHAT_ID = process.env.ZAI_CHAT_ID || "";
const ZAI_USER_ID = process.env.ZAI_USER_ID || "";

async function tryZai(opts: AIChatOptions): Promise<AIChatResult | null> {
  if (!ZAI_API_KEY || !ZAI_TOKEN) return null;

  const messages: any[] = [];
  if (opts.system) messages.push({ role: "assistant", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${ZAI_API_KEY}`,
    "X-Z-AI-From": "Z", // required by the z-ai API
  };
  if (ZAI_TOKEN) headers["X-Token"] = ZAI_TOKEN;
  if (ZAI_CHAT_ID) headers["X-Chat-Id"] = ZAI_CHAT_ID;
  if (ZAI_USER_ID) headers["X-User-Id"] = ZAI_USER_ID;

  const r = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      max_tokens: opts.maxTokens || 1000,
      temperature: opts.temperature || 0.7,
      thinking: { type: "disabled" },
    }),
  });

  if (!r.ok) throw new Error(`z-ai HTTP ${r.status}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  if (!text) return null;
  return { text, source: "z-ai" };
}

// ── Groq (fallback 1) — OpenAI-compatible, ultra-fast ──
async function tryGroq(opts: AIChatOptions): Promise<AIChatResult | null> {
  if (!GROQ_API_KEY) return null;

  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages,
      max_tokens: opts.maxTokens || 1000,
      temperature: opts.temperature || 0.7,
    }),
  });

  if (!r.ok) throw new Error(`groq HTTP ${r.status}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  if (!text) return null;
  return { text, source: "groq" };
}

// ── Gemini (fallback 2) — Google's quality model ──
async function tryGemini(opts: AIChatOptions): Promise<AIChatResult | null> {
  if (!GEMINI_API_KEY) return null;

  const contents = opts.system
    ? [{ parts: [{ text: opts.system + "\n\n" + opts.user }] }]
    : [{ parts: [{ text: opts.user }] }];

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: opts.maxTokens || 1000,
          temperature: opts.temperature || 0.7,
        },
      }),
    }
  );

  if (!r.ok) throw new Error(`gemini HTTP ${r.status}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  if (!text) return null;
  return { text, source: "gemini" };
}

// ── Hugging Face (fallback 3) — free inference ──
async function tryHF(opts: AIChatOptions): Promise<AIChatResult | null> {
  if (!HF_API_KEY) return null;

  const prompt = opts.system
    ? `${opts.system}\n\n${opts.user}`
    : opts.user;

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
          temperature: opts.temperature || 0.7,
          return_full_text: false,
        },
      }),
    }
  );

  if (!r.ok) throw new Error(`hf HTTP ${r.status}`);
  const data = await r.json();
  const text = (Array.isArray(data) ? data[0]?.generated_text : data?.generated_text)?.trim() || "";
  if (!text) return null;
  return { text, source: "hf" };
}

/**
 * Check which AI providers are configured (for health/metrics).
 */
export function getAIProviderStatus(): Record<string, boolean> {
  return {
    "z-ai": !!ZAI_API_KEY,
    "groq": !!GROQ_API_KEY,
    "gemini": !!GEMINI_API_KEY,
    "hf": !!HF_API_KEY,
  };
}
