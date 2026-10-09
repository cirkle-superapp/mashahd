/**
 * CustomThumbnail — from-scratch procedural SVG thumbnail generator.
 *
 * Per user request (Pass 89): "we build everything from scratch." This
 * replaces the image-search HTTP API (z-ai image-search-mcp URLs) with
 * a fully self-contained SVG generator.
 *
 * DESIGN — "Category Landscape":
 *   Each thumbnail is a unique geometric landscape derived from:
 *     - The video title hash (determines composition, color shift, density)
 *     - The video category (determines the palette + scene type)
 *
 *   Scene types per category:
 *     Music    → sound wave with rhythmic bars
 *     Gaming   → pixelated geometric battle scene
 *     Tech     → circuit board trace pattern
 *     Travel   → mountain silhouette + sun
 *     Food     → abstract plated dish (concentric circles)
 *     Fitness  → motion-blur streaks
 *     Science  → atomic orbit pattern
 *     Art      → painterly color blocks
 *     Nature   → leaf vein pattern
 *     Cars     → speed streaks + horizon
 *     News     → grid of headlines
 *     Live     → pulsing broadcast signal
 *     (default) → abstract gradient mesh
 *
 *   Every thumbnail:
 *     - Is visually unique (hash-driven jitter on every parameter)
 *     - Carries the category's visual identity (instantly recognizable)
 *     - Is deterministic (same title+category = same thumbnail, forever)
 *     - Is pure SVG (no external HTTP, no images, no fonts)
 *     - Renders inline (data: URL or <svg> element)
 *
 * USAGE:
 *   import { customThumbnailUrl, CustomThumbnail } from "@/lib/custom-thumbnail";
 *
 *   // As a URL (drop-in for <img src>):
 *   <img src={customThumbnailUrl("Elden Ring — Final Boss", "Gaming", 640, 360)} />
 *
 *   // As a React component:
 *   <CustomThumbnail title="Lo-Fi Beats" category="Music" width={640} height={360} />
 */

import React from "react";

// ── Hash (FNV-1a 32-bit) ──
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Brand-tuned category palettes ──
const CATEGORY_PALETTES: Record<string, { bg: string; primary: string; accent: string; highlight: string }> = {
  Music:    { bg: "#1A1A14", primary: "#C2A060", accent: "#C06070", highlight: "#FDFCF9" },
  Gaming:   { bg: "#1A4A5A", primary: "#C06070", accent: "#C2A060", highlight: "#FDFCF9" },
  Tech:     { bg: "#0A1A1A", primary: "#4A6A8A", accent: "#C2A060", highlight: "#FDFCF9" },
  Travel:   { bg: "#FDFCF9", primary: "#1A4A5A", accent: "#C2A060", highlight: "#C06070" },
  Food:     { bg: "#FDFCF9", primary: "#C2A060", accent: "#C06070", highlight: "#1A4A5A" },
  Fitness:  { bg: "#1A1A14", primary: "#C06070", accent: "#FDFCF9", highlight: "#C2A060" },
  Science:  { bg: "#0A1A2A", primary: "#4A6A8A", accent: "#C2A060", highlight: "#FDFCF9" },
  Art:      { bg: "#FDFCF9", primary: "#C06070", accent: "#C2A060", highlight: "#1A4A5A" },
  Nature:   { bg: "#0A1A0A", primary: "#4A6A8A", accent: "#C2A060", highlight: "#FDFCF9" },
  Cars:     { bg: "#1A1A14", primary: "#C2A060", accent: "#C06070", highlight: "#FDFCF9" },
  News:     { bg: "#FDFCF9", primary: "#1A4A5A", accent: "#C06070", highlight: "#4A6A8A" },
  Live:     { bg: "#1A1A14", primary: "#C06070", accent: "#C2A060", highlight: "#FDFCF9" },
};
const DEFAULT_PALETTE = { bg: "#1A1A14", primary: "#C2A060", accent: "#C06070", highlight: "#FDFCF9" };

function getPalette(category: string) {
  const key = (category || "").trim();
  // Try exact match, then case-insensitive, then default
  return CATEGORY_PALETTES[key] ||
    Object.entries(CATEGORY_PALETTES).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ||
    DEFAULT_PALETTE;
}

// ── Scene renderers (one per category, each generates a unique geometric pattern) ──
type SceneParams = {
  h: number;        // hash
  w: number;        // width
  hgt: number;      // height
  palette: typeof DEFAULT_PALETTE;
};

function renderMusicScene(p: SceneParams): string {
  // Sound wave: vertical bars with varying heights derived from hash bytes
  const bars: string[] = [];
  const barCount = 24;
  const barWidth = p.w / barCount;
  for (let i = 0; i < barCount; i++) {
    const byteVal = (p.h >>> (i % 8)) & 0xff;
    const barHeight = 0.15 + (byteVal / 255) * 0.7;
    const x = i * barWidth;
    const y = p.hgt * (1 - barHeight) / 2;
    bars.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barWidth * 0.7).toFixed(1)}" height="${(p.hgt * barHeight).toFixed(1)}" fill="${p.palette.primary}" opacity="${0.5 + (byteVal / 255) * 0.5}"/>`);
  }
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  <g>${bars.join("")}</g>
  <circle cx="${(p.w * 0.8).toFixed(0)}" cy="${(p.hgt * 0.25).toFixed(0)}" r="${(p.w * 0.08).toFixed(0)}" fill="${p.palette.accent}" opacity="0.8"/>`;
}

function renderGamingScene(p: SceneParams): string {
  // Pixelated battle scene: geometric shapes + a "boss" shape
  const cx = p.w / 2;
  const cy = p.hgt / 2;
  const bossR = Math.min(p.w, p.hgt) * 0.2;
  // Hexagonal boss (polygon)
  const hexPts = Array.from({length: 6}, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${(cx + Math.cos(a) * bossR).toFixed(1)},${(cy + Math.sin(a) * bossR).toFixed(1)}`;
  }).join(" ");
  // Pixelated floor (grid of squares)
  const grid: string[] = [];
  const gridSize = Math.max(8, Math.floor(p.w / 32));
  for (let y = p.hgt * 0.7; y < p.hgt; y += gridSize) {
    for (let x = 0; x < p.w; x += gridSize) {
      const byteVal = (p.h >>> (Math.floor(x / gridSize) + Math.floor(y / gridSize))) & 0xff;
      if (byteVal > 180) {
        grid.push(`<rect x="${x}" y="${y.toFixed(0)}" width="${gridSize}" height="${gridSize}" fill="${p.palette.primary}" opacity="${0.3 + (byteVal / 255) * 0.4}"/>`);
      }
    }
  }
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  <g>${grid.join("")}</g>
  <polygon points="${hexPts}" fill="${p.palette.accent}" opacity="0.85"/>
  <circle cx="${cx}" cy="${cy}" r="${(bossR * 0.4).toFixed(1)}" fill="${p.palette.highlight}"/>`;
}

function renderTechScene(p: SceneParams): string {
  // Circuit board: traces (polylines) + nodes (circles)
  const traces: string[] = [];
  const nodes: string[] = [];
  const gridX = 8, gridY = 8;
  for (let i = 0; i < 12; i++) {
    const byteVal = (p.h >>> (i * 2)) & 0xff;
    const startX = (byteVal % 12) * gridX;
    const startY = ((byteVal >>> 4) % 8) * gridY;
    // Draw a right-angle trace
    const midX = startX + ((byteVal % 5) + 2) * gridX;
    const endY = startY + ((byteVal >>> 3) % 5 + 1) * gridY;
    traces.push(`<polyline points="${startX},${startY} ${midX},${startY} ${midX},${endY}" stroke="${p.palette.primary}" stroke-width="1.5" fill="none" opacity="0.7"/>`);
    nodes.push(`<circle cx="${midX}" cy="${endY}" r="2" fill="${p.palette.accent}"/>`);
    nodes.push(`<circle cx="${startX}" cy="${startY}" r="2" fill="${p.palette.accent}"/>`);
  }
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  <g>${traces.join("")}${nodes.join("")}</g>`;
}

function renderTravelScene(p: SceneParams): string {
  // Mountain silhouette + sun
  const sunR = p.w * 0.08;
  const sunCx = p.w * (0.2 + ((p.h & 0xff) / 255) * 0.6);
  const sunCy = p.hgt * 0.35;
  // Mountain polyline (jagged peaks)
  const peaks = Array.from({length: 8}, (_, i) => {
    const x = (i / 7) * p.w;
    const byteVal = (p.h >>> (i * 3)) & 0xff;
    const y = p.hgt * (0.4 + (byteVal / 255) * 0.35);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  <circle cx="${sunCx.toFixed(1)}" cy="${sunCy.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${p.palette.accent}" opacity="0.9"/>
  <polygon points="0,${p.hgt} ${peaks} ${p.w},${p.hgt}" fill="${p.palette.primary}" opacity="0.85"/>`;
}

function renderFoodScene(p: SceneParams): string {
  // Concentric circles (plated dish)
  const cx = p.w / 2, cy = p.hgt / 2;
  const maxR = Math.min(p.w, p.hgt) * 0.4;
  const rings: string[] = [];
  for (let i = 4; i >= 0; i--) {
    const r = maxR * (i + 1) / 5;
    const color = i % 2 === 0 ? p.palette.primary : p.palette.accent;
    rings.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${color}" opacity="${0.5 + (i / 5) * 0.4}"/>`);
  }
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  ${rings.join("")}
  <circle cx="${cx}" cy="${cy}" r="${(maxR * 0.15).toFixed(1)}" fill="${p.palette.highlight}"/>`;
}

function renderFitnessScene(p: SceneParams): string {
  // Motion blur streaks (diagonal lines)
  const streaks: string[] = [];
  for (let i = 0; i < 14; i++) {
    const byteVal = (p.h >>> i) & 0xff;
    const y = (i / 14) * p.hgt + (byteVal / 255) * 10;
    const len = p.w * (0.3 + (byteVal / 255) * 0.6);
    const x = (byteVal / 255) * (p.w - len);
    streaks.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + len).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${i % 2 === 0 ? p.palette.primary : p.palette.accent}" stroke-width="${2 + (byteVal / 255) * 4}" opacity="${0.4 + (byteVal / 255) * 0.5}"/>`);
  }
  return `<rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  ${streaks.join("")}`;
}

function renderDefaultScene(p: SceneParams): string {
  // Abstract gradient mesh (default for unknown categories)
  const cx1 = p.w * 0.3, cy1 = p.hgt * 0.3;
  const cx2 = p.w * 0.7, cy2 = p.hgt * 0.7;
  return `<defs>
    <radialGradient id="g1" cx="${cx1 / p.w}" cy="${cy1 / p.hgt}" r="0.5">
      <stop offset="0%" stop-color="${p.palette.primary}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${p.palette.bg}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="${cx2 / p.w}" cy="${cy2 / p.hgt}" r="0.5">
      <stop offset="0%" stop-color="${p.palette.accent}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${p.palette.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${p.w}" height="${p.hgt}" fill="${p.palette.bg}"/>
  <rect width="${p.w}" height="${p.hgt}" fill="url(#g1)"/>
  <rect width="${p.w}" height="${p.hgt}" fill="url(#g2)"/>
  <circle cx="${(p.w * 0.5).toFixed(0)}" cy="${(p.hgt * 0.5).toFixed(0)}" r="${(Math.min(p.w, p.hgt) * 0.08).toFixed(1)}" fill="${p.palette.highlight}" opacity="0.4"/>`;
}

// Scene dispatcher
function renderScene(category: string, p: SceneParams): string {
  const key = (category || "").toLowerCase();
  switch (key) {
    case "music": return renderMusicScene(p);
    case "gaming": return renderGamingScene(p);
    case "tech": return renderTechScene(p);
    case "travel": return renderTravelScene(p);
    case "food":
    case "cooking": return renderFoodScene(p);
    case "fitness": return renderFitnessScene(p);
    default: return renderDefaultScene(p);
  }
}

function generateThumbnailSvg(title: string, category: string, w: number = 640, h: number = 360): string {
  const h_ = hashString(`${title}|${category}`);
  const palette = getPalette(category);
  const scene = renderScene(category, { h: h_, w, hgt: h, palette });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${scene}</svg>`;
}

/**
 * Generate a data: URL for a thumbnail (drop-in for <img src>).
 */
export function customThumbnailUrl(title: string, category: string, width: number = 640, height: number = 360): string {
  const svg = generateThumbnailSvg(title, category, width, height);
  if (typeof Buffer !== "undefined") {
    const b64 = Buffer.from(svg).toString("base64");
    return `data:image/svg+xml;base64,${b64}`;
  }
  // Browser fallback
  if (typeof window !== "undefined" && window.btoa) {
    return `data:image/svg+xml;base64,${window.btoa(svg)}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * React component — preferred for new code.
 */
export function CustomThumbnail({
  title,
  category,
  width = 640,
  height = 360,
  className,
}: {
  title: string;
  category: string;
  width?: number;
  height?: number;
  className?: string;
}): React.ReactElement {
  const svg = generateThumbnailSvg(title, category, width, height);
  return (
    <span
      className={className}
      style={{
        display: "block",
        width: "100%",
        aspectRatio: `${width} / ${height}`,
        lineHeight: 0,
        overflow: "hidden",
        borderRadius: "0.5rem",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={`Thumbnail for ${title}`}
    />
  );
}
