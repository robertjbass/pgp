import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlValue,
} from 'sql.js'
import {
  readFileSync,
  existsSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  renameSync,
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  getConfigDir,
  getDbPath,
  ensurePrivate,
  PRIVATE_FILE_MODE,
} from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// New location: ~/.lpgp/data.db
const DB_DIR = getConfigDir()
const DB_PATH = getDbPath()

// Schema is bundled with the package
const SCHEMA_PATH = join(__dirname, 'schema.sql')

// Legacy locations (for migration)
const LEGACY_DB_DIR = join(__dirname, '..', 'db')
const LEGACY_DB_PATH = join(LEGACY_DB_DIR, 'data.db')
const LEGACY_JSON_PATH = join(LEGACY_DB_DIR, 'data.json')

// Your own keypairs (you have both public and private keys)
export type Keypair = {
  id: number
  name: string
  email: string
  fingerprint: string
  public_key: string
  private_key: string
  passphrase_protected: boolean
  algorithm: string
  key_size: string
  can_sign: boolean
  can_encrypt: boolean
  can_certify: boolean
  can_authenticate: boolean
  expires_at: string | null
  revoked: boolean
  revocation_reason: string | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  is_default: boolean
}

// Other people's public keys (for encrypting messages to them)
export type Contact = {
  id: number
  name: string
  email: string
  fingerprint: string
  public_key: string
  algorithm: string
  key_size: string
  trusted: boolean
  last_verified_at: string | null
  notes: string | null
  expires_at: string | null
  revoked: boolean
  created_at: string
  updated_at: string
}

// App settings (single row with typed fields)
export type Settings = {
  id: number
  default_keypair_id: number | null
  auto_sign_messages: boolean
  copy_decrypted_to_clipboard: boolean
  prefer_inline_pgp: boolean
  keyserver_url: string
}

type Schema = {
  keypair: Keypair[]
  contact: Contact[]
  settings: Settings
}

// SQLite stores booleans as 0/1, so we need conversion helpers
function boolToInt(value: boolean): number {
  return value ? 1 : 0
}

function intToBool(value: number): boolean {
  return value === 1
}

// Singleton instance
let dbInstance: Db | null = null

export class Db {
  private db: SqlJsDatabase

  private constructor(db: SqlJsDatabase) {
    this.db = db
  }

  /**
   * Initialize and get the database instance
   */
  static async init(): Promise<Db> {
    if (dbInstance) {
      return dbInstance
    }

    // getConfigDir() (behind DB_DIR) creates the directory with owner-only
    // permissions and tightens it if it already existed.
    Db.migrateFromLegacyLocation()
    Db.removeStaleJournalFiles()

    // Initialize sql.js
    const SQL = await initSqlJs()

    // Load existing database or create new one
    let db: SqlJsDatabase
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH)
      try {
        db = new SQL.Database(buffer)
        // Force a real read so a truncated file fails here, not later
        db.exec('SELECT count(*) FROM sqlite_master')
      } catch (error) {
        throw new Error(
          `The database at ${DB_PATH} could not be opened (${error instanceof Error ? error.message : error}). ` +
            'It may be corrupted. Restore it from a backup, or move it aside to start fresh (your keys are in that file).'
        )
      }
    } else {
      db = new SQL.Database()
    }

    const instance = new Db(db)

    // Initialize schema
    instance.initializeSchema()
    instance.migrateDropKeypairEmailUnique()
    instance.runVersionedMigrations()

    // Migrate old JSON data if it exists
    instance.migrateFromJson()

    // Save initial state
    instance.save()

    dbInstance = instance
    return instance
  }

  /**
   * Get the singleton instance (must call init() first)
   */
  static getInstance(): Db {
    if (!dbInstance) {
      throw new Error('Database not initialized. Call Db.init() first.')
    }
    return dbInstance
  }

  /**
   * Save database to disk
   */
  /**
   * Save atomically: write a sibling temp file, then rename over the
   * database so a crash mid-write can never leave a truncated file.
   */
  private save(): void {
    const data = this.db.export()
    const buffer = Buffer.from(data)
    const tmp = `${DB_PATH}.tmp-${process.pid}`
    writeFileSync(tmp, buffer, { mode: PRIVATE_FILE_MODE })
    ensurePrivate(tmp, PRIVATE_FILE_MODE)
    renameSync(tmp, DB_PATH)
    ensurePrivate(DB_PATH, PRIVATE_FILE_MODE)
  }

  /**
   * Remove leftover `-wal` / `-shm` journal files from the better-sqlite3 era.
   * sql.js never reads them, so they are dead weight that may still contain
   * private-key pages, and a real SQLite client would replay a stale WAL over
   * the newer main file.
   */
  private static removeStaleJournalFiles(): void {
    for (const suffix of ['-wal', '-shm']) {
      const path = `${DB_PATH}${suffix}`
      if (!existsSync(path)) continue
      try {
        unlinkSync(path)
        console.error(`Removed stale SQLite journal file: ${path}`)
      } catch (error) {
        console.error(
          `Could not remove stale journal file ${path}: ${error instanceof Error ? error.message : error}`,
        )
      }
    }
  }

  /**
   * Migrate database from the old project-local location to ~/.lpgp
   */
  private static migrateFromLegacyLocation(): void {
    // If new db already exists, nothing to migrate
    if (existsSync(DB_PATH)) {
      return
    }

    // Check if there's a database in the legacy location
    if (existsSync(LEGACY_DB_PATH)) {
      try {
        // Copy the old database to the new location
        copyFileSync(LEGACY_DB_PATH, DB_PATH)
        console.error(`Migrated database from ${LEGACY_DB_PATH} to ${DB_PATH}`)
      } catch (error) {
        console.error('Failed to migrate database from legacy location:', error)
      }
    }
  }

  /**
   * Older databases declared `keypair.email` UNIQUE, which prevents having a
   * "Personal" and a "Work" key for the same address. SQLite cannot drop a
   * constraint in place, so rebuild the table from the current schema.
   */
  private migrateDropKeypairEmailUnique(): void {
    const row = this.queryOne(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'keypair'"
    )
    const currentSql = row?.sql as string | undefined
    if (!currentSql || !/email\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(currentSql)) {
      return
    }

    const schema = readFileSync(SCHEMA_PATH, 'utf-8')
    const match = schema.match(/CREATE TABLE IF NOT EXISTS keypair \([\s\S]*?\n\);/)
    if (!match) {
      throw new Error('schema.sql is missing the keypair table definition')
    }
    const createNew = match[0].replace(
      'CREATE TABLE IF NOT EXISTS keypair',
      'CREATE TABLE keypair_new'
    )
    const columns = this.queryAll('PRAGMA table_info(keypair)')
      .map((c) => c.name as string)
      .join(', ')

    this.db.exec('BEGIN')
    try {
      this.db.exec(createNew)
      this.db.exec(
        `INSERT INTO keypair_new (${columns}) SELECT ${columns} FROM keypair`
      )
      this.db.exec('DROP TABLE keypair')
      this.db.exec('ALTER TABLE keypair_new RENAME TO keypair')
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    // Recreate the indexes that were dropped with the old table
    this.initializeSchema()
    this.save()
    console.error(
      'Migrated keypair table: multiple keypairs may now share an email address.'
    )
  }

  /**
   * One-shot migrations tracked with SQLite's `PRAGMA user_version`.
   * Add a new numbered step for anything that must run exactly once.
   */
  private runVersionedMigrations(): void {
    const current =
      (this.db.exec('PRAGMA user_version')[0]?.values[0]?.[0] as number) ?? 0
    const steps: Array<() => void> = [
      // 1: signing was never exposed in the UI before, so turn it on for
      //    everyone now that it is the default.
      () => this.db.run('UPDATE settings SET auto_sign_messages = 1 WHERE id = 1'),
      // 2: clipboard preference for decrypted text (fresh databases already
      //    have the column from schema.sql, so guard the ALTER).
      () => {
        const cols = this.queryAll('PRAGMA table_info(settings)').map(
          (c) => c.name
        )
        if (!cols.includes('copy_decrypted_to_clipboard')) {
          this.db.run(
            'ALTER TABLE settings ADD COLUMN copy_decrypted_to_clipboard INTEGER NOT NULL DEFAULT 1'
          )
        }
      },
    ]
    if (current >= steps.length) return
    for (let i = current; i < steps.length; i++) {
      steps[i]?.()
      this.db.run(`PRAGMA user_version = ${i + 1}`)
    }
    this.save()
  }

  private initializeSchema(): void {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8')
    this.db.run(schema)
  }

  private migrateFromJson(): void {
    if (!existsSync(LEGACY_JSON_PATH)) {
      return
    }

    try {
      const fileContent = readFileSync(LEGACY_JSON_PATH, 'utf-8').trim()
      if (fileContent === '') {
        return
      }

      // Old schema structure
      type OldKeypair = {
        id: number
        name: string
        email: string
        fingerprint: string
        public_key: string
        private_key: string
        passphrase_protected: boolean
        created_at: string
        updated_at: string
        is_default: boolean
      }

      type OldContact = {
        id: number
        name: string
        email: string
        fingerprint: string
        public_key: string
        trusted: boolean
        notes?: string
        created_at: string
        updated_at: string
      }

      type OldSchema = {
        keypair: OldKeypair[]
        contact: OldContact[]
        settings: Array<{ id: number; key: string; value: string }>
      }

      const oldData = JSON.parse(fileContent) as OldSchema

      // Migrate keypairs (with default values for new fields)
      for (const kp of oldData.keypair) {
        const existing = this.db.exec(
          `SELECT id FROM keypair WHERE fingerprint = '${kp.fingerprint.replace(/'/g, "''")}'`
        )
        if (existing.length === 0 || existing[0]?.values.length === 0) {
          this.db.run(
            `INSERT INTO keypair (
              name, email, fingerprint, public_key, private_key, passphrase_protected,
              algorithm, key_size, can_sign, can_encrypt, can_certify, can_authenticate,
              expires_at, revoked, revocation_reason, created_at, updated_at, last_used_at, is_default
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              kp.name,
              kp.email,
              kp.fingerprint,
              kp.public_key,
              kp.private_key,
              boolToInt(kp.passphrase_protected),
              'RSA',
              '4096',
              1,
              1,
              0,
              0,
              null,
              0,
              null,
              kp.created_at,
              kp.updated_at,
              null,
              boolToInt(kp.is_default),
            ]
          )
        }
      }

      // Migrate contacts (with default values for new fields)
      for (const contact of oldData.contact) {
        const existing = this.db.exec(
          `SELECT id FROM contact WHERE fingerprint = '${contact.fingerprint.replace(/'/g, "''")}'`
        )
        if (existing.length === 0 || existing[0]?.values.length === 0) {
          this.db.run(
            `INSERT INTO contact (
              name, email, fingerprint, public_key, algorithm, key_size,
              trusted, last_verified_at, notes, expires_at, revoked, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              contact.name,
              contact.email,
              contact.fingerprint,
              contact.public_key,
              'RSA',
              '4096',
              boolToInt(contact.trusted),
              null,
              contact.notes || null,
              null,
              0,
              contact.created_at,
              contact.updated_at,
            ]
          )
        }
      }

      this.save()
      console.error('Successfully migrated data from JSON to SQLite')
    } catch (error) {
      console.error('Failed to migrate JSON data:', error)
    }
  }

  private queryAll(
    sql: string,
    params: SqlValue[] = []
  ): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql)
    if (params.length > 0) {
      stmt.bind(params)
    }

    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      results.push(row as Record<string, unknown>)
    }
    stmt.free()
    return results
  }

  private queryOne(
    sql: string,
    params: SqlValue[] = []
  ): Record<string, unknown> | undefined {
    const results = this.queryAll(sql, params)
    return results[0]
  }

  private runSql(
    sql: string,
    params: SqlValue[] = []
  ): { lastInsertRowid: number } {
    this.db.run(sql, params)
    const result = this.db.exec('SELECT last_insert_rowid() as id')
    const lastId = result[0]?.values[0]?.[0] as number
    this.save()
    return { lastInsertRowid: lastId }
  }

  public select<T extends keyof Schema>({
    table,
    where,
  }: {
    table: T
    where?: {
      key: T extends 'settings'
        ? keyof Settings
        : T extends 'keypair'
          ? keyof Keypair
          : keyof Contact
      compare: 'is' | 'is not' | 'like' | 'not like'
      value: unknown
    }
  }): T extends 'settings' ? Settings : Schema[T] {
    if (table === 'settings') {
      const row = this.queryOne('SELECT * FROM settings WHERE id = 1')
      if (!row) {
        throw new Error('Settings not found')
      }
      // Convert SQLite integers to booleans
      return {
        ...row,
        auto_sign_messages: intToBool(row.auto_sign_messages as number),
        copy_decrypted_to_clipboard: intToBool(
          (row.copy_decrypted_to_clipboard as number | undefined) ?? 1
        ),
        prefer_inline_pgp: intToBool(row.prefer_inline_pgp as number),
      } as T extends 'settings' ? Settings : Schema[T]
    }

    let sql = `SELECT * FROM ${table}`
    const params: SqlValue[] = []

    if (where) {
      const operator =
        where.compare === 'is'
          ? '='
          : where.compare === 'is not'
            ? '!='
            : where.compare === 'like'
              ? 'LIKE'
              : 'NOT LIKE'

      const isLike = where.compare === 'like' || where.compare === 'not like'
      sql += ` WHERE ${String(where.key)} ${operator} ?${isLike ? " ESCAPE '\\'" : ''}`
      params.push(
        (isLike
          ? `%${String(where.value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
          : where.value) as SqlValue
      )
    }

    const rows = this.queryAll(sql, params)

    // Convert SQLite integers to booleans for keypair and contact
    return rows.map((row) => {
      if (table === 'keypair') {
        return {
          ...row,
          passphrase_protected: intToBool(row.passphrase_protected as number),
          can_sign: intToBool(row.can_sign as number),
          can_encrypt: intToBool(row.can_encrypt as number),
          can_certify: intToBool(row.can_certify as number),
          can_authenticate: intToBool(row.can_authenticate as number),
          revoked: intToBool(row.revoked as number),
          is_default: intToBool(row.is_default as number),
        }
      } else if (table === 'contact') {
        return {
          ...row,
          trusted: intToBool(row.trusted as number),
          revoked: intToBool(row.revoked as number),
        }
      }
      return row
    }) as T extends 'settings' ? Settings : Schema[T]
  }

  public insert<T extends keyof Schema>(
    table: T,
    value: T extends 'settings'
      ? Partial<Omit<Settings, 'id'>>
      : T extends 'keypair'
        ? Omit<Keypair, 'id' | 'created_at' | 'updated_at'>
        : Omit<Contact, 'id' | 'created_at' | 'updated_at'>
  ): T extends 'settings' ? Settings : T extends 'keypair' ? Keypair : Contact {
    if (table === 'settings') {
      // Settings is a single row, use UPDATE instead
      const updates = value as Partial<Omit<Settings, 'id'>>
      const setPairs: string[] = []
      const params: SqlValue[] = []

      for (const [key, val] of Object.entries(updates)) {
        setPairs.push(`${key} = ?`)
        if (typeof val === 'boolean') {
          params.push(boolToInt(val))
        } else {
          params.push(val)
        }
      }

      this.runSql(
        `UPDATE settings SET ${setPairs.join(', ')} WHERE id = 1`,
        params
      )

      return this.select({ table: 'settings' }) as T extends 'settings'
        ? Settings
        : T extends 'keypair'
          ? Keypair
          : Contact
    }

    const now = new Date().toISOString()
    const record = { ...value, created_at: now, updated_at: now } as Record<
      string,
      unknown
    >

    // Convert booleans to integers for SQLite
    if (table === 'keypair') {
      record.passphrase_protected = boolToInt(
        record.passphrase_protected as boolean
      )
      record.can_sign = boolToInt(
        (record.can_sign as boolean | undefined) ?? true
      )
      record.can_encrypt = boolToInt(
        (record.can_encrypt as boolean | undefined) ?? true
      )
      record.can_certify = boolToInt(
        (record.can_certify as boolean | undefined) ?? false
      )
      record.can_authenticate = boolToInt(
        (record.can_authenticate as boolean | undefined) ?? false
      )
      record.revoked = boolToInt(
        (record.revoked as boolean | undefined) ?? false
      )
      record.is_default = boolToInt(
        (record.is_default as boolean | undefined) ?? false
      )
    } else if (table === 'contact') {
      record.trusted = boolToInt(
        (record.trusted as boolean | undefined) ?? false
      )
      record.revoked = boolToInt(
        (record.revoked as boolean | undefined) ?? false
      )
    }

    const keys = Object.keys(record)
    const placeholders = keys.map(() => '?').join(', ')
    const values = keys.map((k) => record[k]) as SqlValue[]

    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    const info = this.runSql(sql, values)

    // Fetch through select() so booleans come back converted
    const inserted = this.select({
      table,
      where: { key: 'id', compare: 'is', value: info.lastInsertRowid },
    } as Parameters<typeof this.select>[0]) as unknown[]
    return inserted[0] as T extends 'settings'
      ? Settings
      : T extends 'keypair'
        ? Keypair
        : Contact
  }

  /**
   * Insert a keypair. The first keypair ever stored becomes the default
   * automatically; otherwise it becomes default only when asked. The default
   * flag is switched after a successful insert so a failed insert can never
   * leave the database with no default.
   */
  public insertKeypair(
    value: Omit<Keypair, 'id' | 'created_at' | 'updated_at' | 'is_default'>,
    options: { makeDefault: boolean }
  ): Keypair {
    const existing = this.getKeypairByFingerprint(value.fingerprint)
    if (existing) {
      throw new Error(
        `This key is already stored as "${existing.name}" (fingerprint ${existing.fingerprint}).`
      )
    }

    const isFirst = this.select({ table: 'keypair' }).length === 0
    const inserted = this.insert('keypair', { ...value, is_default: false })
    if (options.makeDefault || isFirst) {
      this.setDefaultKeypair(inserted.id)
    }
    return this.getKeypairById(inserted.id) as Keypair
  }

  public getKeypairById(id: number): Keypair | null {
    const rows = this.select({
      table: 'keypair',
      where: { key: 'id', compare: 'is', value: id },
    })
    return rows[0] ?? null
  }

  public getKeypairByFingerprint(fingerprint: string): Keypair | null {
    const rows = this.select({
      table: 'keypair',
      where: {
        key: 'fingerprint',
        compare: 'is',
        value: fingerprint.replace(/\s+/g, '').toUpperCase(),
      },
    })
    return rows[0] ?? null
  }

  public getSettings(): Settings {
    return this.select({ table: 'settings' })
  }

  public updateSettings(updates: Partial<Omit<Settings, 'id'>>): Settings {
    return this.insert('settings', updates)
  }

  public getDefaultKeypair(): Keypair | null {
    const rows = this.select({
      table: 'keypair',
      where: { key: 'is_default', compare: 'is', value: 1 },
    })
    return rows[0] ?? null
  }

  /**
   * Make exactly one keypair the default, atomically.
   */
  public setDefaultKeypair(id: number): void {
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db.run(
        'UPDATE keypair SET is_default = 0, updated_at = ? WHERE is_default = 1',
        [now]
      )
      this.db.run(
        'UPDATE keypair SET is_default = 1, updated_at = ? WHERE id = ?',
        [now, id]
      )
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.save()
  }

  public update<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings' ? keyof Settings : keyof Keypair | keyof Contact
      value: unknown
    },
    updates: T extends 'settings'
      ? Partial<Settings>
      : T extends 'keypair'
        ? Partial<Keypair>
        : Partial<Contact>
  ): void {
    const now = new Date().toISOString()
    // The settings table has no updated_at column
    const record = (
      table === 'settings' ? { ...updates } : { ...updates, updated_at: now }
    ) as Record<string, unknown>

    // Convert booleans to integers for SQLite
    if (table === 'keypair') {
      if ('passphrase_protected' in record)
        record.passphrase_protected = boolToInt(
          record.passphrase_protected as boolean
        )
      if ('can_sign' in record)
        record.can_sign = boolToInt(record.can_sign as boolean)
      if ('can_encrypt' in record)
        record.can_encrypt = boolToInt(record.can_encrypt as boolean)
      if ('can_certify' in record)
        record.can_certify = boolToInt(record.can_certify as boolean)
      if ('can_authenticate' in record)
        record.can_authenticate = boolToInt(record.can_authenticate as boolean)
      if ('revoked' in record)
        record.revoked = boolToInt(record.revoked as boolean)
      if ('is_default' in record)
        record.is_default = boolToInt(record.is_default as boolean)
    } else if (table === 'contact') {
      if ('trusted' in record)
        record.trusted = boolToInt(record.trusted as boolean)
      if ('revoked' in record)
        record.revoked = boolToInt(record.revoked as boolean)
    } else if (table === 'settings') {
      if ('auto_sign_messages' in record)
        record.auto_sign_messages = boolToInt(
          record.auto_sign_messages as boolean
        )
      if ('prefer_inline_pgp' in record)
        record.prefer_inline_pgp = boolToInt(
          record.prefer_inline_pgp as boolean
        )
      if ('copy_decrypted_to_clipboard' in record)
        record.copy_decrypted_to_clipboard = boolToInt(
          record.copy_decrypted_to_clipboard as boolean
        )
    }

    const setPairs: string[] = []
    const params: SqlValue[] = []

    for (const [key, val] of Object.entries(record)) {
      if (key === 'id') continue // Don't update id
      setPairs.push(`${key} = ?`)
      params.push(val as SqlValue)
    }

    params.push(where.value as SqlValue)

    const sql = `UPDATE ${table} SET ${setPairs.join(', ')} WHERE ${String(where.key)} = ?`
    this.runSql(sql, params)
  }

  public delete<T extends keyof Schema>(
    table: T,
    where: {
      key: T extends 'settings' ? keyof Settings : keyof Keypair | keyof Contact
      value: unknown
    }
  ): void {
    if (table === 'settings') {
      throw new Error('Cannot delete settings row')
    }

    const sql = `DELETE FROM ${table} WHERE ${String(where.key)} = ?`
    this.runSql(sql, [where.value as SqlValue])
  }

  public close(): void {
    this.save()
    this.db.close()
    dbInstance = null
  }
}
