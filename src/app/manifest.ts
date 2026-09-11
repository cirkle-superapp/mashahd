import type { MetadataRoute } from "next";

/**
 * Web app manifest for Mashahd (مشاهِد) — the video pillar of the super-app.
 * Mirrors CIRKLE's manifest structure but branded for Mashahd. The icon is
 * served from /icon.svg (Next.js App Router auto-detects src/app/icon.svg).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mashahd — مشاهِد | Video",
    short_name: "Mashahd",
    description:
      "Mashahd (مشاهِد) — the AI-native video pillar of the super-app. Watch, discover, summarize, and translate videos.",
    start_url: "/",
    display: "standalone",
    background_color: "#FDFCF9",
    theme_color: "#1A4A5A",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    categories: ["entertainment", "video", "multimedia"],
  };
}
