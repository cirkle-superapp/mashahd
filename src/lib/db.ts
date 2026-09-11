import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

/**
 * Database client for Mashahd.
 *
 * Supports two modes:
 *   1. Local SQLite (development): DATABASE_URL=file:./path/to/db.sqlite
 *   2. Turso / libSQL (production): DATABASE_URL=libsql://... or https://...
 *
 * When the DATABASE_URL starts with "libsql:" or "https:" and contains a
 * Turso hostname, the libsql adapter is used. Otherwise, a plain PrismaClient
 * is returned (local SQLite mode).
 *
 * The Turso token should be embedded in the URL as a query parameter:
 *   libsql://<host>?authToken=<token>
 * or set via TURSO_AUTH_TOKEN env var.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || ''

  // Check if we're using Turso/libsql (URL starts with libsql: or https: and
  // contains a Turso hostname, OR TURSO_AUTH_TOKEN is set).
  const isTurso =
    url.startsWith('libsql:') ||
    (url.startsWith('https:') && url.includes('turso.io')) ||
    Boolean(process.env.TURSO_AUTH_TOKEN)

  if (isTurso) {
    // Parse the URL — the authToken may be in the query string or a separate env var.
    let cleanUrl = url
    let authToken = process.env.TURSO_AUTH_TOKEN

    // If the URL contains ?authToken=, extract it.
    if (url.includes('?authToken=')) {
      const [base, query] = url.split('?authToken=')
      cleanUrl = base.replace(/^libsql:/, 'https:') // libsql: → https: for the client
      if (!authToken) authToken = query
    } else if (url.startsWith('libsql:')) {
      cleanUrl = url.replace(/^libsql:/, 'https:')
    }

    try {
      const libsql = createClient({
        url: cleanUrl,
        authToken: authToken || undefined,
      })
      const adapter = new PrismaLibSql(libsql)
      return new PrismaClient({ adapter, log: ['error', 'warn'] })
    } catch (e) {
      console.error('[db] Failed to connect to Turso, falling back to local SQLite:', e)
      // Fall through to local SQLite
    }
  }

  // Local SQLite mode (default for development).
  return new PrismaClient({
    log: ['error', 'warn'],
  })
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
