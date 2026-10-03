import { createDbEngine } from '@homelab/db-engine';

export function createPlaylistEngine() {
    return createDbEngine({
        dbPath: '/home/CATIAA/WEB/db/Music/playlist.db',
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
                name: 'playlist',
                ddl: `
                    CREATE TABLE IF NOT EXISTS playlists (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        path TEXT UNIQUE NOT NULL,
                        title TEXT NOT NULL DEFAULT '',
                        creator TEXT DEFAULT '',
                        annotation TEXT,
                        info TEXT,
                        image TEXT,
                        track_count INTEGER DEFAULT 0,
                        total_duration INTEGER DEFAULT 0,
                        total_size INTEGER DEFAULT 0,
                        available_tracks INTEGER DEFAULT 0,
                        missing_tracks INTEGER DEFAULT 0,
                        last_scanned INTEGER,
                        last_updated INTEGER,
                        created_at INTEGER NOT NULL DEFAULT 0,
                        deleted_at INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS playlist_tracks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        playlist_id INTEGER NOT NULL,
                        track_index INTEGER NOT NULL,
                        location TEXT NOT NULL,
                        resolved_path TEXT,
                        title TEXT DEFAULT '',
                        artist TEXT DEFAULT '',
                        album TEXT DEFAULT '',
                        duration INTEGER,
                        artwork TEXT,
                        track_num INTEGER,
                        file_exists INTEGER DEFAULT 0,
                        file_size INTEGER DEFAULT 0,
                        file_mtime INTEGER,
                        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
                    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_index ON playlist_tracks(playlist_id, track_index);
                `,
            },
        ],
    });
}
