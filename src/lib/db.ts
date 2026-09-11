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

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
