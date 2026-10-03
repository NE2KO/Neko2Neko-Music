import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.argv[2] || join(__dirname, '..', '..', 'data', 'media.db');
const send = (msg) => { if (process.send) process.send(msg); else console.log(JSON.stringify(msg)); };

const CHUNK = 10000;

function rebuildFts(db) {
  const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'").get();

  if (!ftsExists) {
    db.exec(`CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1')`);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
      END;
      CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
      END;
      CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
        INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
      END;
    `);
  }

  const total = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
  const ftsCount = db.prepare('SELECT COUNT(*) as cnt FROM files_fts').get().cnt;

  if (total === 0) {
    if (ftsCount > 0) db.exec('DELETE FROM files_fts');
    send({ type: 'done', ok: true, reason: 'empty', count: 0 });
    return;
  }

  if (total === ftsCount) {
    const missing = db.prepare(
      `SELECT COUNT(*) as cnt FROM files f WHERE f.rowid NOT IN (SELECT rowid FROM files_fts)`
    ).get().cnt;
    if (missing === 0) {
      send({ type: 'done', ok: true, reason: 'in-sync', count: ftsCount });
      return;
    }
  }

  const insertStmt = db.prepare(
    `INSERT INTO files_fts(rowid, name) SELECT f.rowid, f.name FROM files f WHERE f.rowid NOT IN (SELECT rowid FROM files_fts)`
  );

  let inserted = 0;
  while (true) {
    const result = insertStmt.run();
    inserted += result.changes;
    if (result.changes < CHUNK) break;
    send({ type: 'progress', done: Math.min(inserted, total - ftsCount), total: total - ftsCount });
  }

  const orphanCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)`
  ).get().cnt;

  if (orphanCount > 0) {
    db.prepare(`DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)`).run();
  }

  const finalCount = db.prepare('SELECT COUNT(*) as cnt FROM files_fts').get().cnt;
  send({ type: 'done', ok: true, reason: 'delta-sync', count: finalCount, inserted, cleaned: orphanCount });
}

try {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -200000');

  const tx = db.transaction(() => rebuildFts(db));
  tx();

  db.close();
  process.exit(0);
} catch (e) {
  try {
    console.error('[fts-worker] Error:', e.message);
    send({ type: 'done', ok: false, error: e.message });
  } catch {}
  process.exit(1);
}
