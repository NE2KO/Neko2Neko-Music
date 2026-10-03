import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';

const DB_DIR = '/home/CATIAA/WEB/db/Music';
mkdirSync(DB_DIR, { recursive: true });

const src = new Database(`${DB_DIR}/media.db`);

function createTarget(name, schemaSql) {
  const db = new Database(`${DB_DIR}/${name}.db`);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -80000');
  db.pragma('mmap_size = 4294967296');
  db.pragma('page_size = 32768');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function migrateTable(srcDb, targetDb, table) {
  const cols = srcDb.prepare(`PRAGMA table_info(${table})`).all();
  const colNames = cols.map(c => c.name);
  const rows = srcDb.prepare(`SELECT ${colNames.join(',')} FROM ${table}`).all();
  if (rows.length === 0) return 0;
  const placeholders = colNames.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${colNames.join(',')}) VALUES (${placeholders})`;
  const stmt = targetDb.prepare(sql);
  const tx = targetDb.transaction(() => {
    for (const row of rows) stmt.run(...cols.map(c => row[c.name]));
  });
  tx();
  return rows.length;
}

// Music DB schema
const musicSchema = `
CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, parent_id INTEGER, depth INTEGER DEFAULT 0, file_count INTEGER DEFAULT 0, total_size INTEGER DEFAULT 0, last_scanned INTEGER, last_updated INTEGER, recursive_file_count INTEGER, recursive_total_size INTEGER);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, dir_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, ext TEXT, size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0, duration REAL DEFAULT 0, has_thumb INTEGER DEFAULT 0, thumb_cache_path TEXT, last_accessed INTEGER DEFAULT 0, access_count INTEGER DEFAULT 0, last_verified INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, codec_info TEXT, is_stream_compatible INTEGER DEFAULT 0, youtube_id TEXT, video_offset REAL DEFAULT 0, faststart_state INTEGER DEFAULT NULL, created_at_embedded INTEGER, modified_at_fs INTEGER, uploaded_at INTEGER, metadata_source TEXT, checksum TEXT, title TEXT, artist TEXT, album TEXT, genre TEXT, lyrics TEXT, lyrics_synced TEXT, lyrics_romaji TEXT, cover_source TEXT, is_favorite INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0, uploader_metadata TEXT);
CREATE TABLE IF NOT EXISTS folder_generation (folder_id INTEGER PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0);
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1');
CREATE TABLE IF NOT EXISTS media_visibility (file_id TEXT NOT NULL, web_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PRESENT', updated_at INTEGER NOT NULL, PRIMARY KEY (file_id, web_id));
CREATE TABLE IF NOT EXISTS media_changes (change_id TEXT PRIMARY KEY, web_id TEXT NOT NULL, file_id TEXT, operation TEXT NOT NULL, previous_state TEXT NOT NULL, new_state TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL, applied_at INTEGER);
CREATE TABLE IF NOT EXISTS media_changesets (changeset_id TEXT PRIMARY KEY, web_id TEXT NOT NULL, name TEXT, description TEXT, state TEXT NOT NULL DEFAULT 'DRAFT', created_at INTEGER NOT NULL, finalized_at INTEGER, applied_at INTEGER, applied_by TEXT, promotion_source TEXT, promotion_target TEXT);
CREATE TABLE IF NOT EXISTS media_changeset_items (id INTEGER PRIMARY KEY AUTOINCREMENT, changeset_id TEXT NOT NULL, change_id TEXT NOT NULL, added_at INTEGER NOT NULL, FOREIGN KEY (changeset_id) REFERENCES media_changesets(changeset_id));
CREATE INDEX IF NOT EXISTS idx_files_favorite ON files(is_favorite DESC, id);
CREATE INDEX IF NOT EXISTS idx_files_locked ON files(is_locked DESC, id);
CREATE INDEX IF NOT EXISTS idx_files_cursor ON files(dir_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(dir_id, name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(dir_id, mtime DESC, id);
CREATE INDEX IF NOT EXISTS idx_files_size ON files(dir_id, size DESC, id);
CREATE INDEX IF NOT EXISTS idx_media_changes_web ON media_changes(web_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changeset_items_changeset ON media_changeset_items(changeset_id);
CREATE TRIGGER IF NOT EXISTS folder_gen_ai AFTER INSERT ON files BEGIN INSERT INTO folder_generation(folder_id) VALUES (NEW.dir_id) ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1; END;
CREATE TRIGGER IF NOT EXISTS folder_gen_ad AFTER DELETE ON files BEGIN INSERT INTO folder_generation(folder_id) VALUES (OLD.dir_id) ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1; END;
CREATE TRIGGER IF NOT EXISTS folder_gen_au AFTER UPDATE ON files BEGIN INSERT INTO folder_generation(folder_id) VALUES (NEW.dir_id) ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1; INSERT INTO folder_generation(folder_id) SELECT NEW.dir_id WHERE OLD.dir_id != NEW.dir_id ON CONFLICT(folder_id) DO UPDATE SET generation = generation + 1; END;
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name); END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name); END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name); INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name); END;
`;

const playlistSchema = `
CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL DEFAULT '', creator TEXT DEFAULT '', annotation TEXT, info TEXT, image TEXT, track_count INTEGER DEFAULT 0, total_duration INTEGER DEFAULT 0, total_size INTEGER DEFAULT 0, available_tracks INTEGER DEFAULT 0, missing_tracks INTEGER DEFAULT 0, last_scanned INTEGER, last_updated INTEGER, created_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS playlist_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER NOT NULL, track_index INTEGER NOT NULL, location TEXT NOT NULL, resolved_path TEXT, title TEXT DEFAULT '', artist TEXT DEFAULT '', album TEXT DEFAULT '', duration INTEGER, artwork TEXT, track_num INTEGER, file_exists INTEGER DEFAULT 0, file_size INTEGER DEFAULT 0, file_mtime INTEGER, FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_index ON playlist_tracks(playlist_id, track_index);
CREATE INDEX IF NOT EXISTS idx_playlists_deleted ON playlists(deleted_at);
`;

const leaderboardSchema = `
CREATE TABLE IF NOT EXISTS listening_stats (trackId TEXT PRIMARY KEY, playCount INTEGER NOT NULL DEFAULT 0, listenedSeconds INTEGER NOT NULL DEFAULT 0, lastPlayedAt INTEGER, displayName TEXT, updatedAt INTEGER);
CREATE INDEX IF NOT EXISTS idx_listening_stats_updated ON listening_stats(updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_listening_stats_plays ON listening_stats(playCount DESC);
CREATE INDEX IF NOT EXISTS idx_listening_stats_listened ON listening_stats(listenedSeconds DESC);
CREATE TABLE IF NOT EXISTS listening_sessions (sessionId TEXT PRIMARY KEY, trackId TEXT NOT NULL, playDelta INTEGER NOT NULL DEFAULT 0, listenedDelta INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
`;

const settingsSchema = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'string', category TEXT NOT NULL DEFAULT 'general', label TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '', options TEXT, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings_history (id INTEGER PRIMARY KEY AUTOINCREMENT, setting_key TEXT NOT NULL, old_value TEXT, new_value TEXT, type TEXT NOT NULL DEFAULT 'string', action TEXT NOT NULL DEFAULT 'update', timestamp INTEGER NOT NULL);
`;

const socialSchema = `
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, local_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New Chat', pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_conversations_local_id ON conversations(local_id);
CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(pinned);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tool_calls TEXT, tool_results TEXT, created_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id ASC);
CREATE TABLE IF NOT EXISTS ai_provider_status (provider_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'disconnected', last_verified_at INTEGER, latency_ms INTEGER, models_json TEXT DEFAULT '[]', models_cached_at INTEGER, error_message TEXT);
CREATE TABLE IF NOT EXISTS ai_conversation_settings (conversation_id INTEGER PRIMARY KEY, model TEXT, temperature REAL, max_tokens INTEGER, system_prompt TEXT, web_search INTEGER DEFAULT 0, vision INTEGER DEFAULT 0, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS ai_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER, content TEXT NOT NULL, confidence REAL DEFAULT 0.5, pinned INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, tags TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_memories_conversation ON ai_memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_enabled ON ai_memories(enabled, pinned DESC);
CREATE TABLE IF NOT EXISTS ai_context_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, summary TEXT NOT NULL, message_range_start INTEGER, message_range_end INTEGER, created_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON ai_context_summaries(conversation_id);
CREATE TABLE IF NOT EXISTS ai_pinned_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, message_id INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE, UNIQUE(conversation_id, message_id));
CREATE INDEX IF NOT EXISTS idx_pinned_conversation ON ai_pinned_messages(conversation_id);
CREATE TABLE IF NOT EXISTS ai_model_preferences (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, favorited INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, last_used_at INTEGER, UNIQUE(provider_id, model_id));
CREATE TABLE IF NOT EXISTS send_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, hold_until INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, debug INTEGER NOT NULL DEFAULT 0, caption TEXT NOT NULL DEFAULT '', sort_order INTEGER, scheduled_at INTEGER, processing_started_at INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, attempt_log TEXT, pinned INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status);
CREATE TABLE IF NOT EXISTS send_counters (id INTEGER PRIMARY KEY CHECK (id = 1), telegram_count INTEGER NOT NULL DEFAULT 0, whatsapp_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS send_rate_limit (id INTEGER PRIMARY KEY CHECK (id = 1), date TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, last_send_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS send_settings (id INTEGER PRIMARY KEY CHECK (id = 1), tick_enabled INTEGER NOT NULL DEFAULT 1, debug_mode INTEGER NOT NULL DEFAULT 0, per_day INTEGER NOT NULL DEFAULT 3, share_only_target TEXT);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, filename TEXT NOT NULL, target_path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', uploaded INTEGER NOT NULL DEFAULT 0, error TEXT, checksum TEXT, type TEXT, ext TEXT, started_at INTEGER, completed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_allowed_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_bot_tasks (user_msg_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, queued_msg_id INTEGER, task_ids TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, cleaned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS telegram_task_link (task_id INTEGER PRIMARY KEY, user_msg_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_ephemeral (msg_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, delete_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_processed (msg_id INTEGER PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_audio_bot_tasks (user_msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, queued_msg_id TEXT, task_ids TEXT, total INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, cleaned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS telegram_audio_task_link (task_id TEXT NOT NULL, user_msg_id TEXT NOT NULL, PRIMARY KEY (task_id));
CREATE TABLE IF NOT EXISTS telegram_audio_processed (msg_id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_audio_ephemeral (msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, delete_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_audio_links (task_id TEXT NOT NULL, user_msg_id TEXT NOT NULL, PRIMARY KEY (task_id));
CREATE INDEX IF NOT EXISTS idx_telegram_audio_links_user_msg ON telegram_audio_links(user_msg_id);
`;

const uploadsSchema = `
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, filename TEXT NOT NULL, target_path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', uploaded INTEGER NOT NULL DEFAULT 0, error TEXT, checksum TEXT, type TEXT, ext TEXT, started_at INTEGER, completed_at INTEGER, created_at INTEGER NOT NULL);
`;

const musicDb = createTarget('music', musicSchema);
const playlistDb = createTarget('playlist', playlistSchema);
const leaderboardDb = createTarget('leaderboard', leaderboardSchema);
const settingsDb = createTarget('settings', settingsSchema);
const socialDb = createTarget('social', socialSchema);
const uploadsDb = createTarget('uploads', uploadsSchema);

// Migrate data
const musicTables = ['folders', 'files', 'media_visibility', 'media_changes', 'media_changesets', 'media_changeset_items'];
const playlistTables = ['playlists', 'playlist_tracks'];
const leaderboardTables = ['listening_stats', 'listening_sessions'];
const settingsTables = ['settings', 'settings_history'];
const socialTables = ['conversations', 'messages', 'ai_provider_status', 'ai_conversation_settings', 'ai_memories', 'ai_context_summaries', 'ai_pinned_messages', 'ai_model_preferences', 'send_queue', 'send_counters', 'send_rate_limit', 'send_settings', 'uploads', 'telegram_allowed_chats', 'telegram_bot_tasks', 'telegram_task_link', 'telegram_ephemeral', 'telegram_processed', 'telegram_audio_bot_tasks', 'telegram_audio_task_link', 'telegram_audio_processed', 'telegram_audio_ephemeral', 'telegram_audio_links'];
const uploadsTables = ['uploads'];

function migrateGroup(targetDb, tables, groupName) {
  for (const table of tables) {
    const cols = src.prepare(`PRAGMA table_info(${table})`).all();
    const colNames = cols.map(c => c.name);
    const rows = src.prepare(`SELECT ${colNames.join(',')} FROM ${table}`).all();
    if (rows.length === 0) continue;
    const placeholders = colNames.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${colNames.join(',')}) VALUES (${placeholders})`;
    const stmt = targetDb.prepare(sql);
    const tx = targetDb.transaction(() => {
      for (const row of rows) stmt.run(...cols.map(c => row[c.name]));
    });
    tx();
    console.log(`  ${groupName}.${table}: ${rows.length} rows`);
  }
}

console.log('Migrating music.db...');
migrateGroup(musicDb, musicTables, 'music');
console.log('Migrating playlist.db...');
migrateGroup(playlistDb, playlistTables, 'playlist');
console.log('Migrating leaderboard.db...');
migrateGroup(leaderboardDb, leaderboardTables, 'leaderboard');
console.log('Migrating settings.db...');
migrateGroup(settingsDb, settingsTables, 'settings');
console.log('Migrating social.db...');
migrateGroup(socialDb, socialTables, 'social');
console.log('Migrating uploads.db...');
migrateGroup(uploadsDb, uploadsTables, 'uploads');

console.log('\nMigration complete!');
src.close();
musicDb.close();
playlistDb.close();
leaderboardDb.close();
settingsDb.close();
socialDb.close();
uploadsDb.close();
