/**
 * CustomAvatar — from-scratch procedural SVG avatar generator.
 *
 * Per user request (Pass 89): "we want to be the API not use others API.
 * we build everything from scratch." This replaces the DiceBear HTTP API
 * (https://api.dicebear.com/7.x/notionists/svg?seed=...) with a fully
 * self-contained SVG generator.
 *
 * DESIGN — "Cirkle Constellation":
 *   Each avatar is a unique geometric composition derived from a hash of
 *   the seed string. The composition uses the CIRKLE brand's three-circle
 *   motif (the same mark as the MashahdMark logo) but with:
 *     - 3 different brand-tuned color palettes (rotated by hash)
 *     - Variable circle positions (jittered by hash)
 *     - A unique "constellation" pattern of small dots overlaid on the
 *       3 main circles (each dot's position derived from hash bytes)
 *     - An optional letter monogram in the center
 *
 *   This means every avatar:
 *     - Is visually unique (2^32+ possible compositions per palette)
 *     - Carries the brand identity (3-circle cirkle motif)
 *     - Is deterministic (same seed = same avatar, forever)
 *     - Is pure SVG (no external HTTP, no images, no fonts)
 *     - Renders inline (data: URL or <svg> element)
 *
 * USAGE:
 *   import { CustomAvatar, customAvatarDataUrl } from "@/lib/custom-avatar";
 *
 *   // As a React component:
 *   <CustomAvatar seed="apexgaming" size={48} />
 *
 *   // As a data URL (for <img src> or <AvatarImage src>):
 *   <img src={customAvatarDataUrl("apexgaming", 48)} />
 */

import React from "react";

// ── Hash function (FNV-1a 32-bit, deterministic + fast) ──
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0; // unsigned
}

// Extract 4 bytes from a hash (for independent parameters)
function hashBytes(h: number): [number, number, number, number] {
  return [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
}

// ── Brand-tuned color palettes (3 variants, rotated by hash) ──
// Each palette uses the CIRKLE brand tokens (gold/teal/rose/steel/charcoal/cream)
// but in different roles (background/stroke/accent/dot) for variety.
const PALETTES = [
  {
    name: "cream-gold",
    bg: "#FDFCF9",         // cream
    stroke: "#C2A060",     // gold
    accent: "#1A4A5A",     // teal
    dot: "#C06070",        // rose
    monogram: "#1A4A5A",  // teal
  },
  {
    name: "teal-rose",
    bg: "#1A4A5A",         // teal
    stroke: "#C2A060",     // gold
    accent: "#FDFCF9",     // cream
    dot: "#C06070",        // rose
    monogram: "#FDFCF9",   // cream
  },
  {
    name: "rose-charcoal",
    bg: "#1A1A14",         // charcoal
    stroke: "#C06070",     // rose
    accent: "#C2A060",     // gold
    dot: "#4A6A8A",        // steel
    monogram: "#FDFCF9",   // cream
  },
  {
    name: "steel-gold",
    bg: "#4A6A8A",         // steel
    stroke: "#FDFCF9",     // cream
    accent: "#C2A060",     // gold
    dot: "#1A4A5A",        // teal
    monogram: "#FDFCF9",   // cream
  },
];

// ── SVG generation ──
function generateAvatarSvg(seed: string, size: number = 48): string {
  const h = hashString(seed || "mashahd");
  const [b0, b1, b2, b3] = hashBytes(h);
  const palette = PALETTES[b0 % PALETTES.length];

  // Jittered circle positions (each circle's center is offset from the
  // canonical CIRKLE triangle position by a hash-derived amount)
  const jitter = (byte: number, range: number) =>
    ((byte / 255) - 0.5) * range;

  const c1 = { x: 50 + jitter(b1, 8), y: 32 + jitter(b2, 6) }; // top circle
  const c2 = { x: 32 + jitter(b3, 8), y: 60 + jitter(b1, 6) }; // bottom-left
  const c3 = { x: 68 + jitter(b2, 8), y: 60 + jitter(b3, 6) }; // bottom-right

  // Constellation dots — 5-7 small dots scattered on the 3 circles.
  // Each dot's position is derived from hash bytes.
  const dotCount = 5 + (b1 % 4); // 5-8 dots
  const dots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < dotCount; i++) {
    const angleHash = (h >>> (i * 4)) & 0xff;
    const radiusHash = (h >>> (i * 4 + 2)) & 0xff;
    const angle = (angleHash / 255) * Math.PI * 2;
    const baseCircle = i % 3 === 0 ? c1 : i % 3 === 1 ? c2 : c3;
    const radius = 10 + (radiusHash / 255) * 10;
    dots.push({
      x: baseCircle.x + Math.cos(angle) * radius,
      y: baseCircle.y + Math.sin(angle) * radius,
      r: 1 + (radiusHash / 255) * 1.5,
    });
  }

  // Monogram — first letter of the seed, uppercased (optional)
  const monogram = (seed && seed[0] || "M").toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <rect width="100" height="100" rx="${size > 80 ? 22 : 50}" fill="${palette.bg}"/>
  <g opacity="0.85">
    <circle cx="${c1.x.toFixed(2)}" cy="${c1.y.toFixed(2)}" r="22" stroke="${palette.stroke}" stroke-width="2.5" fill="none"/>
    <circle cx="${c2.x.toFixed(2)}" cy="${c2.y.toFixed(2)}" r="22" stroke="${palette.accent}" stroke-width="2.5" fill="none"/>
    <circle cx="${c3.x.toFixed(2)}" cy="${c3.y.toFixed(2)}" r="22" stroke="${palette.dot}" stroke-width="2.5" fill="none"/>
  </g>
  <g>
    ${dots.map((d) => `<circle cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="${d.r.toFixed(2)}" fill="${palette.dot}" opacity="0.7"/>`).join("")}
  </g>
  <circle cx="50" cy="50" r="6" fill="${palette.stroke}"/>
  <text x="50" y="54" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="8" font-weight="700" fill="${palette.monogram}">${monogram}</text>
</svg>`;
  return svg;
}

/**
 * Generate a data: URL for an avatar (use as <img src> or <AvatarImage src>).
 * Drops into existing components that expect a URL with zero changes.
 */
export function customAvatarDataUrl(seed: string, size: number = 48): string {
  const svg = generateAvatarSvg(seed, size);
  // Use base64 encoding for max compatibility (works in <img src>, CSS url(), etc.)
  const b64 = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * React component — preferred for new code (no data: URL overhead, direct SVG).
 */
export function CustomAvatar({
  seed,
  size = 48,
  className,
  rounded = true,
}: {
  seed: string;
  size?: number;
  className?: string;
  rounded?: boolean;
}): React.ReactElement {
  const svg = generateAvatarSvg(seed, size);
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: rounded ? "9999px" : undefined,
        overflow: "hidden",
        lineHeight: 0,
      }}
      // Inline SVG via dangerouslySetInnerHTML — no data: URL overhead.
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={`Avatar for ${seed}`}
    />
  );
}

/**
 * Helper — drop-in replacement for the DiceBear URL pattern used in 9 files.
 * Usage:
 *   // Before:
 *   const url = `https://api.dicebear.com/7.x/notionists/svg?seed=${name}&radius=50`;
 *   // After:
 *   const url = customAvatarUrl(name);
 */
export function customAvatarUrl(seed: string, size: number = 48): string {
  return customAvatarDataUrl(seed, size);
}

// ── For browser-only contexts (no Node Buffer) ──
declare global {
  interface Window {
    btoa?: (s: string) => string;
  }
}

/**
 * Browser-safe version — uses btoa() instead of Node's Buffer.
 * Falls back to unencoded SVG (still works in <img src> in modern browsers).
 */
export function customAvatarDataUrlBrowser(seed: string, size: number = 48): string {
  const svg = generateAvatarSvg(seed, size);
  if (typeof window !== "undefined" && window.btoa) {
    return `data:image/svg+xml;base64,${window.btoa(svg)}`;
  }
  // Fallback: encodeURIComponent (works in CSS url() + <img src>)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
