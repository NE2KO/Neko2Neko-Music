import { createDbEngine } from '@homelab/db-engine';
import { createPlaylistEngine } from './engines/playlist.js';
import { createVideoCacheEngine } from './engines/video-cache.js';
import { createThumbCacheEngine } from './engines/thumb-cache.js';
import { createListsEngine } from './engines/lists.js';

function createMusicEngine() {
    return createDbEngine({
        dbPath: '/home/CATIAA/WEB/db/Music/music.db',
        pragmas: {
            journal_mode: 'WAL',
            synchronous: 'NORMAL',
            temp_store: 'MEMORY',
            cache_size: -80000,
            mmap_size: 4294967296,
            page_size: 32768,
            busy_timeout: 5000,
            foreign_keys: 'ON',
        },
        seeds: () => {},
        statements: [],
        schemas: [
            {
                name: 'music',
                ddl: `
                    CREATE TABLE IF NOT EXISTS folders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        path TEXT UNIQUE NOT NULL,
                        parent_id INTEGER,
                        depth INTEGER DEFAULT 0,
                        file_count INTEGER DEFAULT 0,
                        total_size INTEGER DEFAULT 0,
                        last_scanned INTEGER,
                        last_updated INTEGER,
                        recursive_file_count INTEGER,
                        recursive_total_size INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS files (
                        id TEXT PRIMARY KEY,
                        dir_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        type TEXT NOT NULL,
                        ext TEXT,
                        size INTEGER NOT NULL DEFAULT 0,
                        mtime INTEGER NOT NULL DEFAULT 0,
                        duration REAL DEFAULT 0,
                        last_verified INTEGER DEFAULT 0,
                        created_at INTEGER NOT NULL DEFAULT 0,
                        codec_info TEXT,
                        is_stream_compatible INTEGER DEFAULT 0,
                        youtube_id TEXT,
                        video_offset REAL DEFAULT 0,
                        faststart_state INTEGER DEFAULT NULL,
                        created_at_embedded INTEGER,
                        modified_at_fs INTEGER,
                        uploaded_at INTEGER,
                        metadata_source TEXT,
                        checksum TEXT,
                        title TEXT,
                        artist TEXT,
                        album TEXT,
                        genre TEXT,
                        lyrics TEXT,
                        lyrics_synced TEXT,
                        lyrics_romaji TEXT,
                        cover_source TEXT,
                        is_locked INTEGER DEFAULT 0,
                        uploader_metadata TEXT,
                        has_thumb INTEGER DEFAULT 0,
                        thumb_cache_path TEXT,
                        is_favorite INTEGER DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS folder_generation (
                        folder_id INTEGER PRIMARY KEY,
                        generation INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1');
                    CREATE TABLE IF NOT EXISTS media_visibility (
                        file_id TEXT NOT NULL, web_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PRESENT',
                        updated_at INTEGER NOT NULL, PRIMARY KEY (file_id, web_id)
                    );
                    CREATE TABLE IF NOT EXISTS media_changes (
                        change_id TEXT PRIMARY KEY, web_id TEXT NOT NULL, file_id TEXT, operation TEXT NOT NULL,
                        previous_state TEXT NOT NULL, new_state TEXT NOT NULL, payload TEXT,
                        created_at INTEGER NOT NULL, applied_at INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS media_changesets (
                        changeset_id TEXT PRIMARY KEY, web_id TEXT NOT NULL, name TEXT, description TEXT,
                        state TEXT NOT NULL DEFAULT 'DRAFT', created_at INTEGER NOT NULL,
                        finalized_at INTEGER, applied_at INTEGER, applied_by TEXT,
                        promotion_source TEXT, promotion_target TEXT
                    );
                    CREATE TABLE IF NOT EXISTS media_changeset_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, changeset_id TEXT NOT NULL,
                        change_id TEXT NOT NULL, added_at INTEGER NOT NULL,
                        FOREIGN KEY (changeset_id) REFERENCES media_changesets(changeset_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_files_locked ON files(is_locked DESC, id);
                    CREATE INDEX IF NOT EXISTS idx_files_cursor ON files(dir_id, created_at DESC, id DESC);
                    CREATE INDEX IF NOT EXISTS idx_files_name ON files(dir_id, name COLLATE NOCASE, id);
                    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(dir_id, mtime DESC, id);
                    CREATE INDEX IF NOT EXISTS idx_files_size ON files(dir_id, size DESC, id);
                    CREATE INDEX IF NOT EXISTS idx_media_changes_web ON media_changes(web_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_changeset_items_changeset ON media_changeset_items(changeset_id);
                `,
            },
        ],
    });
}

const musicEngine = createMusicEngine();
const playlistEngine = createPlaylistEngine();
const videoCacheEngine = createVideoCacheEngine();
const thumbCacheEngine = createThumbCacheEngine();
const listsEngine = createListsEngine();

export async function startDbGateway() {
    await Promise.all([
        musicEngine.start(),
        playlistEngine.start(),
        videoCacheEngine.start(),
        thumbCacheEngine.start(),
        listsEngine.start(),
    ]);

    return {
        music: musicEngine,
        playlist: playlistEngine,
        videoCache: videoCacheEngine,
        thumbCache: thumbCacheEngine,
        lists: listsEngine,
        health: async () => ({
            music: await musicEngine.health(),
            playlist: await playlistEngine.health(),
            videoCache: await videoCacheEngine.health(),
            thumbCache: await thumbCacheEngine.health(),
            lists: await listsEngine.health(),
        }),
    };
}

export { musicEngine, playlistEngine, videoCacheEngine, thumbCacheEngine, listsEngine };
