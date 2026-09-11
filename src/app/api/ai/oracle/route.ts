import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/**
 * POST /api/ai/oracle
 * Body: { videoId, question }
 *
 * Cirkle Oracle (adapted from CIRKLE's cirkle-oracle overlay). Answers a
 * viewer's question about the video they're watching, grounded in the
 * video's title, description, tags, and category. Falls back to a generic
 * acknowledgment if the LLM is unavailable.
 */
export async function POST(req: NextRequest) {
  const { videoId, question } = await req.json().catch(
    () => ({ videoId: "", question: "" })
  );
  if (!videoId || !question) {
    return NextResponse.json({ error: "videoId + question required" }, { status: 400 });
  }
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { title: true, description: true, category: true, tags: true, channel: { select: { name: true } } },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const prompt = `You are the Mashahd Oracle — a knowledgeable assistant that answers questions about a video the viewer is watching. Ground your answer in the video's metadata below; if the question can't be answered from that, say so honestly and offer a related tangent.

Title: ${video.title}
Channel: ${video.channel.name}
Category: ${video.category}
Tags: ${video.tags.split("|").filter(Boolean).join(", ") || "none"}
Description: ${video.description.slice(0, 700)}

Viewer question: ${question}

Answer in 2-4 sentences, conversational, no markdown headers.`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "You are the Mashahd Oracle — concise, helpful, honest." },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    });
    const answer = completion.choices[0]?.message?.content?.trim() || "";
    return NextResponse.json({ ok: true, answer, source: "ai" });
  } catch (e) {
    console.error("[ai/oracle] LLM failed:", e);
    return NextResponse.json({
      ok: true,
      answer: `Great question. Based on "${video.title}", I'd suggest watching the full video — the answer usually unfolds in the second half. (The Oracle is offline right now, so this is a fallback reply.)`,
      source: "fallback",
    });
  }
}
