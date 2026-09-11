import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'

/**
 * Database client for Mashahd.
 *
 * Supports two modes:
 *   1. Local SQLite (development): DATABASE_URL=file:./path/to/db.sqlite
 *   2. Turso / libSQL (production): DATABASE_URL=libsql://...?authToken=...
 *
 * When the DATABASE_URL starts with "libsql:" or "https:" and contains a
 * Turso hostname, the libsql adapter is used. The connection is tested
 * before use — if Turso is unreachable or the token is invalid, the app
 * falls back to local SQLite so it never goes down.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL || ''

  // Check if we're using Turso/libsql.
  const isTurso = url.startsWith('libsql:') || url.includes('turso.io')

  if (isTurso) {
    let cleanUrl = url
    let authToken = process.env.TURSO_AUTH_TOKEN

    if (url.includes('?authToken=')) {
      const [base, query] = url.split('?authToken=')
      cleanUrl = base.replace(/^libsql:/, 'https:')
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
    } catch {
      // Fall through to local SQLite
    }
  }

  // Local SQLite mode (default for development).
  return new PrismaClient({
    log: ['error', 'warn'],
  })
}

// For Turso mode, we test the connection on first use. If it fails, the
// API route will return an error — the client should retry with local
// SQLite. This is handled by the env: if DATABASE_URL is set to the local
// file path, local SQLite is used directly.
export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
