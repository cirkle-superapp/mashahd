#!/usr/bin/env bash
# Mashahd — Full Backup Script
# Backs up: (1) local SQLite, (2) Turso database, (3) uploaded media storage,
# (4) the .env file. Timestamped to backups/YYYY-MM-DD-HHMMSS/.
set -euo pipefail

TS=$(date -u +%Y-%m-%d-%H%M%S)
DEST="/home/z/my-project/backups/$TS"
mkdir -p "$DEST"

echo "→ Backup destination: $DEST"

# 1. Local SQLite
if [ -f /home/z/my-project/db/custom.db ]; then
  cp /home/z/my-project/db/custom.db "$DEST/local-sqlite.db"
  echo "✓ Local SQLite backed up ($(du -h "$DEST/local-sqlite.db" | cut -f1))"
fi

# 2. Turso database (via the libsql client — dump as JSON arrays per table)
node -e "
const { createClient } = require('@libsql/client');
const fs = require('fs');
const url = process.env.TURSO_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error('  (TURSO_URL/TURSO_AUTH_TOKEN not set, skipping Turso)'); process.exit(0); }
(async () => {
  const c = createClient({ url, authToken: token });
  const tables = (await c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'\")).rows.map(r => r.name);
  const dump = {};
  for (const t of tables) {
    const r = await c.execute('SELECT * FROM ' + t);
    dump[t] = r.rows;
  }
  fs.writeFileSync('$DEST/turso-dump.json', JSON.stringify(dump, null, 2));
  console.log('✓ Turso backed up (' + tables.length + ' tables, ' + JSON.stringify(Object.fromEntries(tables.map(t => [t, dump[t].length]))) + ')');
})().catch(e => { console.error('  Turso backup error:', e.message); process.exit(1); });
"

# 3. Media storage (uploaded videos + HLS renditions)
if [ -d /home/z/my-project/storage ]; then
  tar -czf "$DEST/storage.tar.gz" -C /home/z/my-project storage 2>/dev/null && \
    echo "✓ Storage backed up ($(du -h "$DEST/storage.tar.gz" | cut -f1))" || \
    echo "  (storage empty or not present)"
fi

# 4. .env (so secrets are recoverable)
if [ -f /home/z/my-project/.env ]; then
  cp /home/z/my-project/.env "$DEST/env.backup"
  echo "✓ .env backed up"
fi

# 5. Prisma schema snapshot
if [ -f /home/z/my-project/prisma/schema.prisma ]; then
  cp /home/z/my-project/prisma/schema.prisma "$DEST/schema.prisma.snapshot"
  echo "✓ Prisma schema snapshot"
fi

echo ""
echo "✅ Backup complete → $DEST"
ls -la "$DEST"
