import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { requireNodeSqlite } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import type { PersonalMemoryCategory } from "./filter.js";

export type PersonalMemoryEntry = {
  id: string;
  subjectKey: string;
  category: PersonalMemoryCategory;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PersonalMemoryStoreOptions = {
  storePath: string;
  unsafeAllowPermissions?: boolean;
};

const SCHEMA_VERSION = 1;

type SqliteValue = string | number | null;

function nowIso(): string {
  return new Date().toISOString();
}

function statementAll<T>(stmt: StatementSync, ...values: SqliteValue[]): T[] {
  return stmt.all(...values) as T[];
}

function statementGet<T>(stmt: StatementSync, ...values: SqliteValue[]): T | undefined {
  return stmt.get(...values) as T | undefined;
}

function assertSafePath(storePath: string, unsafeAllowPermissions = false): void {
  if (!path.isAbsolute(storePath)) {
    throw new Error("personal-memory storePath must be absolute");
  }
  const parent = path.dirname(storePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory()) {
    throw new Error("personal-memory store parent is not a directory");
  }
  if (parentStat.isSymbolicLink()) {
    throw new Error("personal-memory store parent must not be a symlink");
  }
  if (!unsafeAllowPermissions && (parentStat.mode & 0o077) !== 0) {
    throw new Error("personal-memory store parent must be owner-only");
  }
  if (fs.existsSync(storePath)) {
    const dbStat = fs.lstatSync(storePath);
    if (dbStat.isSymbolicLink()) {
      throw new Error("personal-memory store db must not be a symlink");
    }
    if (!unsafeAllowPermissions && (dbStat.mode & 0o077) !== 0) {
      throw new Error("personal-memory store db must be owner-only");
    }
  }
}

function chmodOwnerOnly(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600);
  }
}

export class PersonalMemoryStore {
  private db: DatabaseSync;
  readonly storePath: string;

  constructor(options: PersonalMemoryStoreOptions) {
    assertSafePath(options.storePath, options.unsafeAllowPermissions);
    this.storePath = options.storePath;
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(options.storePath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
    chmodOwnerOnly(options.storePath);
    chmodOwnerOnly(`${options.storePath}-wal`);
    chmodOwnerOnly(`${options.storePath}-shm`);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version =
      statementGet<{ user_version: number }>(this.db.prepare("PRAGMA user_version"))
        ?.user_version ?? 0;
    if (version > SCHEMA_VERSION) {
      throw new Error("personal-memory schema is newer than this plugin");
    }
    if (version === SCHEMA_VERSION) {
      return;
    }
    this.db.exec("BEGIN EXCLUSIVE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS personal_memory_profiles (
          subject_key TEXT PRIMARY KEY,
          revision INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS personal_memory_entries (
          id TEXT PRIMARY KEY,
          subject_key TEXT NOT NULL,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY(subject_key) REFERENCES personal_memory_profiles(subject_key)
        );
        CREATE INDEX IF NOT EXISTS idx_personal_memory_entries_subject_active
          ON personal_memory_entries(subject_key, deleted_at, updated_at);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private ensureProfile(subjectKey: string): void {
    const now = nowIso();
    this.db
      .prepare(`
      INSERT INTO personal_memory_profiles(subject_key, revision, created_at, updated_at)
      VALUES (?, 0, ?, ?)
      ON CONFLICT(subject_key) DO NOTHING
    `)
      .run(subjectKey, now, now);
  }

  private bumpRevision(subjectKey: string): void {
    this.db
      .prepare(`
      UPDATE personal_memory_profiles
      SET revision = revision + 1, updated_at = ?
      WHERE subject_key = ?
    `)
      .run(nowIso(), subjectKey);
  }

  getRevision(subjectKey: string): number {
    return (
      statementGet<{ revision: number }>(
        this.db.prepare("SELECT revision FROM personal_memory_profiles WHERE subject_key = ?"),
        subjectKey,
      )?.revision ?? 0
    );
  }

  upsertEntry(input: {
    subjectKey: string;
    id?: string;
    category: PersonalMemoryCategory;
    content: string;
  }): PersonalMemoryEntry {
    const id = input.id ?? crypto.randomUUID();
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.ensureProfile(input.subjectKey);
      this.db
        .prepare(`
        INSERT INTO personal_memory_entries(id, subject_key, category, content, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          content = excluded.content,
          updated_at = excluded.updated_at,
          deleted_at = NULL
        WHERE personal_memory_entries.subject_key = excluded.subject_key
      `)
        .run(id, input.subjectKey, input.category, input.content, now, now);
      this.bumpRevision(input.subjectKey);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    const entry = this.getEntry(input.subjectKey, id);
    if (!entry) {
      throw new Error("personal-memory upsert failed");
    }
    return entry;
  }

  listEntries(
    subjectKey: string,
    options: { includeDeleted?: boolean; limit?: number } = {},
  ): PersonalMemoryEntry[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const where = options.includeDeleted
      ? "subject_key = ?"
      : "subject_key = ? AND deleted_at IS NULL";
    return statementAll<PersonalMemoryEntry>(
      this.db.prepare(`
        SELECT id, subject_key as subjectKey, category, content, created_at as createdAt,
          updated_at as updatedAt, deleted_at as deletedAt
        FROM personal_memory_entries
        WHERE ${where}
        ORDER BY updated_at DESC
        LIMIT ?
      `),
      subjectKey,
      limit,
    );
  }

  getEntry(subjectKey: string, id: string): PersonalMemoryEntry | null {
    return (
      statementGet<PersonalMemoryEntry>(
        this.db.prepare(`
        SELECT id, subject_key as subjectKey, category, content, created_at as createdAt,
          updated_at as updatedAt, deleted_at as deletedAt
        FROM personal_memory_entries
        WHERE subject_key = ? AND id = ?
      `),
        subjectKey,
        id,
      ) ?? null
    );
  }

  softDeleteEntry(subjectKey: string, id: string): boolean {
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(`
        UPDATE personal_memory_entries SET deleted_at = ?, updated_at = ?
        WHERE subject_key = ? AND id = ? AND deleted_at IS NULL
      `)
        .run(now, now, subjectKey, id);
      if (result.changes) {
        this.bumpRevision(subjectKey);
      }
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
