#!/usr/bin/env node
/**
 * Mashahd — Remote DB backup (Pass 106).
 *
 * Dumps every table from Turso (primary) and Neon (analytics/DR) to
 * timestamped JSON files under backups/remote-{TS}/. Designed for
 * disaster recovery: pair with prisma/schema.prisma to rebuild either
 * database from scratch (prisma db push + JSON re-insert).
 *
 * Run directly:   node scripts/backup-remote.mjs
 * Or via npm:     bun run backup:remote
 *
 * Reads .env via fs (NOT bash source) so the `&` in NEON_DATABASE_URL
 * doesn't mangle the connection string.
 */
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── Load .env (dotenv-style, &-safe) ──
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1);
const OUT = join(process.cwd(), `backups/remote-${TS}`);
const manifest = { timestamp: new Date().toISOString(), turso: { tables: {} }, neon: { tables: {} } };

// ── Turso dump ──
async function dumpTurso() {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) {
    console.log("[turso] skipped — TURSO_URL/AUTH_TOKEN not set");
    return;
  }
  const dir = join(OUT, "turso");
  mkdirSync(dir, { recursive: true });
  const t = createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN });
  const tables = await t.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'"
  );
  let totalRows = 0;
  for (const r of tables.rows) {
    const name = r.name;
    try {
      const rows = await t.execute(`SELECT * FROM "${name}"`);
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows.rows, null, 2));
      manifest.turso.tables[name] = rows.rows.length;
      totalRows += rows.rows.length;
    } catch (e) {
      manifest.turso.tables[name] = `ERR:${String(e).slice(0, 60)}`;
    }
  }
  manifest.turso.tableCount = tables.rows.length;
  manifest.turso.totalRows = totalRows;
  console.log(`[turso] ✓ ${tables.rows.length} tables, ${totalRows} rows → ${dir}`);
}

// ── Neon dump ──
async function dumpNeon() {
  if (!env.NEON_DATABASE_URL) {
    console.log("[neon] skipped — NEON_DATABASE_URL not set");
    return;
  }
  const dir = join(OUT, "neon");
  mkdirSync(dir, { recursive: true });
  // Strip channel_binding — node-pg doesn't support it (libpq-only).
  const cs = env.NEON_DATABASE_URL.replace(/[?&]channel_binding=require/, "").replace(/\?&/, "?");
  const { Client } = await import("pg");
  const c = new Client({ connectionString: cs, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    const tRes = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    let totalRows = 0;
    for (const { table_name } of tRes.rows) {
      try {
        const r = await c.query(`SELECT * FROM "${table_name}"`);
        writeFileSync(join(dir, `${table_name}.json`), JSON.stringify(r.rows, null, 2));
        manifest.neon.tables[table_name] = r.rowCount;
        totalRows += r.rowCount;
      } catch (e) {
        manifest.neon.tables[table_name] = `ERR:${String(e).slice(0, 60)}`;
      }
    }
    manifest.neon.tableCount = tRes.rowCount;
    manifest.neon.totalRows = totalRows;
    console.log(`[neon]  ✓ ${tRes.rowCount} tables, ${totalRows} rows → ${dir}`);
  } finally {
    await c.end().catch(() => {});
  }
}

// ── Run + write manifest ──
mkdirSync(OUT, { recursive: true });
await dumpTurso().catch((e) => console.log(`[turso] ✗ ${String(e).slice(0, 120)}`));
await dumpNeon().catch((e) => console.log(`[neon]  ✗ ${String(e).slice(0, 120)}`));
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\n✓ Backup complete → ${OUT}/manifest.json`);
console.log(JSON.stringify({ turso: manifest.turso.tableCount, neon: manifest.neon.tableCount }, null, 0));
