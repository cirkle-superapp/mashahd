import { readFileSync, writeFileSync } from "node:fs";

// Parse the two CLI-produced files (they have log lines mixed with JSON)
function extractJson(text: string): any {
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Find the matching closing brace
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  return null;
}

const techRaw = readFileSync("/home/z/my-project/tmp/img-search/tech.json", "utf-8");
const gamingRaw = readFileSync("/home/z/my-project/gaming.json", "utf-8");
const remaining = JSON.parse(readFileSync("/home/z/my-project/tmp/img-search/remaining.json", "utf-8"));

const tech = extractJson(techRaw);
const gaming = extractJson(gamingRaw);

const all: Record<string, any[]> = {
  tech: tech?.results?.map((r: any) => ({ original_url: r.original_url, source: r.source, width: r.original_width, height: r.original_height })) || [],
  gaming: gaming?.results?.map((r: any) => ({ original_url: r.original_url, source: r.source, width: r.original_width, height: r.original_height })) || [],
  ...remaining,
};

writeFileSync("/home/z/my-project/tmp/img-search/all.json", JSON.stringify(all, null, 2));
console.log("Combined thumbnails:");
for (const [k, v] of Object.entries(all)) {
  console.log(`  ${k}: ${v.length} images`);
}
