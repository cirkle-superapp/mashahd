import { createClient } from "@libsql/client";

const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("ERROR: TURSO_URL + TURSO_AUTH_TOKEN required");
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// ALTER TABLE ADD COLUMN statements. SQLite errors if the column exists,
// so we catch + log "already exists" silently.
const migrations = [
  // Channel — missing columns from newer schema versions
  { table: "Channel", col: "verified", sql: "ALTER TABLE Channel ADD COLUMN verified INTEGER DEFAULT 0" },
  { table: "Channel", col: "bannerUrl", sql: "ALTER TABLE Channel ADD COLUMN bannerUrl TEXT DEFAULT ''" },
  { table: "Channel", col: "ownerId", sql: "ALTER TABLE Channel ADD COLUMN ownerId TEXT" },
  { table: "Channel", col: "links", sql: "ALTER TABLE Channel ADD COLUMN links TEXT DEFAULT ''" },
  { table: "Channel", col: "country", sql: "ALTER TABLE Channel ADD COLUMN country TEXT DEFAULT ''" },
  // Video — missing columns
  { table: "Video", col: "visibility", sql: "ALTER TABLE Video ADD COLUMN visibility TEXT DEFAULT 'public'" },
  { table: "Video", col: "publishedAt", sql: "ALTER TABLE Video ADD COLUMN publishedAt TEXT" },
  { table: "Video", col: "language", sql: "ALTER TABLE Video ADD COLUMN language TEXT DEFAULT ''" },
  { table: "Video", col: "ageGated", sql: "ALTER TABLE Video ADD COLUMN ageGated INTEGER DEFAULT 0" },
  { table: "Video", col: "clipPolicy", sql: "ALTER TABLE Video ADD COLUMN clipPolicy TEXT DEFAULT 'allowed'" },
];

let added = 0;
let existed = 0;
for (const m of migrations) {
  try {
    await client.execute(m.sql);
    console.log(`  ✓ added ${m.table}.${m.col}`);
    added++;
  } catch (e) {
    if (e.message?.includes("duplicate column") || e.message?.includes("already exists")) {
      existed++;
    } else {
      console.warn(`  ✗ ${m.table}.${m.col}:`, e.message?.slice(0, 100));
    }
  }
}
console.log(`\nMigration complete: ${added} columns added, ${existed} already existed.`);
