/**
 * One-off script: fetch real video thumbnails via an image-search service.
 *
 * STATUS: ALREADY RUN — thumbnails are in /home/z/my-project/tmp/img-search/all.json.
 * Kept for reference only.
 *
 * HISTORY: This script originally used z-ai-web-dev-sdk. As of Pass 81
 * (2026-09-25), z-ai has been COMPLETELY REMOVED from the project (no
 * z-ai-web-dev-sdk in package.json, no z-ai imports anywhere in src/).
 * The original z-ai SDK import is therefore stubbed out below — re-running
 * this script will print a clear "z-ai removed" message and exit.
 *
 * To re-fetch thumbnails in the future, swap the stub for any direct
 * image-search API (e.g. Pexels, Unsplash, Bing Image Search) — none of
 * them touch the runtime app code.
 */
import { writeFileSync, mkdirSync } from "node:fs";

// Stub for the removed z-ai-web-dev-sdk. Calling .create() throws a clear
// error so any future developer who tries to re-run this knows immediately
// what's missing and what to swap in. The `as any` cast on the .create()
// return lets the script keep its original zai.images.search.create(...)
// call shape without TypeScript flagging it (the stub never returns
// successfully — it always throws — so the script never reaches the
// .images.search.create line at runtime).
const ZAI = {
  create(): Promise<any> {
    return Promise.reject(
      new Error(
        "z-ai-web-dev-sdk has been removed from this project (Pass 81, 2026-09-25). " +
          "Re-fetching thumbnails requires swapping in a direct image-search API. " +
          "See the header doc of this script for details."
      )
    );
  },
};

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

// zai is typed as `any` because ZAI.create() throws at runtime; the stub
// never actually returns a value. The .catch() exits the process before
// any code below this line can run.
const zai: any = await ZAI.create().catch((e: Error) => {
  console.error(`[fetch-thumbnails] ${e.message}`);
  process.exit(1);
});

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
