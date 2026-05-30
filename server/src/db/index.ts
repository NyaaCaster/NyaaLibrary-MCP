import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";

const DB_FILE = resolve(config.dataDir, "library.db");

if (!existsSync(config.dataDir)) {
  mkdirSync(config.dataDir, { recursive: true });
}

export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
sqliteVec.load(db);

// ---- Base schema -----------------------------------------------------------
// IDs for knowledge bases / documents are TEXT uuids. Chunks use an INTEGER
// primary key so its rowid can be the join key for both the sqlite-vec virtual
// table (dense) and the FTS5 virtual table (sparse).
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    chunk_size   INTEGER NOT NULL,
    chunk_overlap INTEGER NOT NULL,
    dense_top_k  INTEGER NOT NULL,
    sparse_top_k INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    kb_id       TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    ext         TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(kb_id);

  CREATE TABLE IF NOT EXISTS chunks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id      TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    content    TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    vector_id  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- FTS5 sparse index (trigram tokenizer handles CJK substrings well).
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    tokenize = 'trigram'
  );
`);

// ---- Lazy dense vector table -----------------------------------------------
// sqlite-vec virtual tables require a fixed dimension at creation time, which
// is only known once an embedding model is configured. We create it lazily and
// record the active dimension so retrieval can guard against a missing table.
export function getVecDim(): number | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'vec_dim'")
    .get() as { value: string } | undefined;
  return row ? Number(row.value) : null;
}

export function ensureVecTable(dim: number): void {
  const current = getVecDim();
  if (current === dim) return;
  if (current !== null && current !== dim) {
    // Dimension changed: drop and rebuild (existing vectors are invalidated).
    db.exec("DROP TABLE IF EXISTS vec_chunks;");
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}]);`,
  );
  db.prepare(
    "INSERT INTO settings(key, value) VALUES ('vec_dim', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(dim));
}

export function vecTableExists(): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'",
    )
    .get();
  return Boolean(row);
}
