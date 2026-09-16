#!/usr/bin/env bash
# Mashahd — Backup script: DB + schema + worklog
#
# Creates a timestamped backup of:
#   - The local SQLite database (db/custom.db)
#   - The Prisma schema (prisma/schema.prisma)
#   - The worklog (worklog.md)
#
# Keeps the last 20 backups (older ones are pruned).
#
# Usage:
#   ./scripts/backup.sh           # create a backup
#   MASHAHD_KEEP=50 ./scripts/backup.sh   # keep last 50
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

BACKUP_DIR="backups"
KEEP="${MASHAHD_KEEP:-20}"
TS=$(date -u +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# 1. Database (only if it exists).
if [ -f "db/custom.db" ]; then
  cp db/custom.db "$BACKUP_DIR/custom-$TS.db"
  echo "✓ Backed up DB → $BACKUP_DIR/custom-$TS.db"
fi

# 2. Schema (small, always back up).
if [ -f "prisma/schema.prisma" ]; then
  cp prisma/schema.prisma "$BACKUP_DIR/schema-$TS.prisma"
  echo "✓ Backed up schema → $BACKUP_DIR/schema-$TS.prisma"
fi

# 3. Worklog (the audit trail — irreplaceable).
if [ -f "worklog.md" ]; then
  cp worklog.md "$BACKUP_DIR/worklog-$TS.md"
  echo "✓ Backed up worklog → $BACKUP_DIR/worklog-$TS.md"
fi

# 4. Prune older backups (keep newest $KEEP).
ls -1t "$BACKUP_DIR"/custom-*.db 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
ls -1t "$BACKUP_DIR"/schema-*.prisma 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
ls -1t "$BACKUP_DIR"/worklog-*.md 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

COUNT=$(ls -1 "$BACKUP_DIR" 2>/dev/null | wc -l)
echo "✓ Backup complete. $COUNT backups retained (keep=$KEEP)."
