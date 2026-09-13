/**
 * One-off script: fetch real video thumbnails via the z-ai image-search service.
 * ALREADY RUN — thumbnails are in /home/z/my-project/tmp/img-search/all.json.
 * Kept for reference only. z-ai has been removed from the project.
 *
 * Run with: bun run scripts/fetch-thumbnails.ts (will fail — z-ai removed)
 */
// @ts-ignore - z-ai-web-dev-sdk has been removed from the project
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, mkdirSync } from "node:fs";

const queries: { key: string; query: string }[] = [
  { key: "travel", query: "scenic mountain landscape travel destination aerial view" },
  { key: "food", query: "delicious gourmet food plated on restaurant table" },
  { key: "fitness", query: "person doing workout exercise in modern gym" },
  { key: "music", query: "live concert music performance stage lights crowd" },
  { key: "science", query: "scientific laboratory experiment microscope research" },
  { key: "art", query: "artist painting on canvas in bright studio" },
  { key: "nature", query: "wild animals in nature documentary savanna" },
  { key: "cars", query: "luxury sports car driving fast on coastal road" },
];

const OUT_DIR = "/home/z/my-project/tmp/img-search";
mkdirSync(OUT_DIR, { recursive: true });

const zai = await ZAI.create();

const all: Record<string, { original_url: string; source: string; width: string; height: string }[]> = {};

for (const { key, query } of queries) {
  try {
    console.log(`[${key}] searching: ${query}`);
    const res: any = await zai.images.search.create({
      query,
      count: 6,
      gl: "us",
      rank: false,
    });
    if (res && res.success && res.results) {
      all[key] = res.results.map((r: any) => ({
        original_url: r.original_url,
        source: r.source || "",
        width: r.original_width || "",
        height: r.original_height || "",
      }));
      console.log(`[${key}] got ${all[key].length} images`);
    } else {
      console.warn(`[${key}] no results`, res);
      all[key] = [];
    }
  } catch (e) {
    console.error(`[${key}] error:`, e);
    all[key] = [];
  }
}

writeFileSync(`${OUT_DIR}/remaining.json`, JSON.stringify(all, null, 2));
console.log(`\nDone. Wrote ${OUT_DIR}/remaining.json`);
