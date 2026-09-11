import { PrismaClient } from '@prisma/client'

/**
 * Database client for Mashahd.
 *
 * Uses Prisma with local SQLite by default. When TURSO_URL + TURSO_AUTH_TOKEN
 * are set, the Prisma libsql driver adapter is used (requires Prisma 7+ for
 * full stability — the v6 adapter has a known library-engine env bug).
 *
 * The Turso database has already been provisioned with all 13 tables via
 * scripts/push-turso.ts. Once Prisma fixes the adapter env issue (or you
 * upgrade to Prisma 7 which has native libsql support), uncomment the
 * adapter code below.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Check if Turso is configured
const useTurso = Boolean(process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN)

if (useTurso) {
  // TODO: Enable this block once Prisma 7.x is released with native libsql
  // support, or the v6 library-engine env bug is fixed.
  // For now, the app uses local SQLite but the Turso database is provisioned
  // and ready (all tables created via scripts/push-turso.ts).
  //
  // import { PrismaLibSQL } from '@prisma/adapter-libsql'
  // import { createClient } from '@libsql/client'
  // const libsql = createClient({
  //   url: process.env.TURSO_URL!.replace(/^libsql:/, 'https:'),
  //   authToken: process.env.TURSO_AUTH_TOKEN,
  // })
  // const adapter = new PrismaLibSQL(libsql)
  // export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter })
  console.log('[db] Turso configured but using local SQLite (Prisma adapter bug — see db.ts comment)')
}

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
