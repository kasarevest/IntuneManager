#!/usr/bin/env node
/**
 * migrate-bootstrap.mjs
 *
 * Idempotent migration bootstrap for a database originally created via `prisma db push`.
 * Those databases have correct tables but no _prisma_migrations history, so
 * `prisma migrate deploy` would attempt to re-create all tables and fail.
 *
 * What this script does:
 *  1. Check whether _prisma_migrations exists (SQL Server: sys.tables).
 *  2. If YES  → exit 0 (nothing to do; normal migrate deploy will run next).
 *  3. If NO   → generate a baseline migration SQL from the current schema,
 *               write it to prisma/migrations/0_init/migration.sql,
 *               then call `prisma migrate resolve --applied "0_init"` to
 *               register it as already-applied without executing the DDL.
 *
 * After this runs, `prisma migrate deploy` is a no-op for 0_init and will
 * apply any real future migrations normally.
 */

import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const serverDir = join(__dir, '..')
const MIGRATION_NAME = '0_init'
const migrationDir = join(serverDir, 'prisma', 'migrations', MIGRATION_NAME)
const migrationFile = join(migrationDir, 'migration.sql')

let prisma
try {
  const { PrismaClient } = await import('@prisma/client')
  prisma = new PrismaClient()
} catch {
  console.error('[bootstrap] Could not load @prisma/client — run `npx prisma generate` first.')
  process.exit(1)
}

try {
  // SQL Server: check sys.tables for the Prisma migrations tracking table.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = N'_prisma_migrations'`
  )
  const tableExists = Number(rows[0]?.cnt ?? 0) > 0

  if (tableExists) {
    console.log('[bootstrap] _prisma_migrations table already exists — skipping baseline.')
    process.exit(0)
  }

  console.log('[bootstrap] No migration history found. Generating baseline from current schema...')

  // Generate SQL that represents the current schema state (from-empty → to-schema).
  const sql = execSync(
    'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
    { cwd: serverDir, encoding: 'utf8' }
  )

  mkdirSync(migrationDir, { recursive: true })
  writeFileSync(migrationFile, sql, 'utf8')
  console.log(`[bootstrap] Wrote prisma/migrations/${MIGRATION_NAME}/migration.sql (${sql.length} bytes)`)

  // Mark the baseline as already applied — Prisma registers it but does NOT run the DDL.
  execSync(`npx prisma migrate resolve --applied "${MIGRATION_NAME}"`, {
    cwd: serverDir,
    stdio: 'inherit',
  })

  console.log('[bootstrap] Baseline registered. Future `migrate deploy` calls will apply only new migrations.')
} catch (err) {
  console.error('[bootstrap] Fatal error:', err.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
