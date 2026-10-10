import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/videos/[id]/speed
 *
 * Returns the available playback speeds for a video.
 * YouTube has 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x.
 * Mashahd supports the same set + an "auto" mode that adjusts
 * based on the viewer's reading speed (from the CIRKLE BRAIN).
 */
export async function GET() {
  return NextResponse.json({
    speeds: [
      { value: 0.25, label: "0.25x", note: "Slow motion" },
      { value: 0.5, label: "0.5x", note: "Half speed" },
      { value: 0.75, label: "0.75x", note: "Three-quarter speed" },
      { value: 1, label: "Normal", note: "1x (default)" },
      { value: 1.25, label: "1.25x", note: "Slightly faster" },
      { value: 1.5, label: "1.5x", note: "Faster" },
      { value: 2, label: "2x", note: "Double speed" },
    ],
    defaultSpeed: 1,
    note: "Playback speed control — same as YouTube. The player's <video> element supports playbackRate natively.",
  });
}
