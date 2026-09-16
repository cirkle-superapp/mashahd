import { PrismaClient } from '@prisma/client'
import { createTursoDB, getTursoClient } from './turso-db'

/**
 * Database client for Mashahd.
 *
 * When TURSO_URL + TURSO_AUTH_TOKEN are set, uses a Prisma-compatible wrapper
 * over the raw @libsql/client (bypassing Prisma's driver adapter bug).
 * Falls back to Prisma + local SQLite otherwise.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined
}

function createDb(): any {
  // Try Turso first
  const tursoDb = createTursoDB();
  if (tursoDb) {
    return tursoDb;
  }

  // Fall back to local SQLite via Prisma
  console.log('[db] Using local SQLite database (Prisma)')
  return new PrismaClient({ log: ['error', 'warn'] })
}

// Create a fresh client if none cached, OR if the cached client is missing
// newer models (happens after schema changes without a full process restart).
function getDb(): any {
  if (globalForPrisma.prisma && typeof globalForPrisma.prisma.userPreference === 'object') {
    return globalForPrisma.prisma;
  }
  const client = createDb();
  globalForPrisma.prisma = client;
  return client;
}

export const db = getDb()
