import { createDbEngine } from '@homelab/db-engine';

export function createListsEngine() {
    return createDbEngine({
        dbPath: '/home/CATIAA/WEB/db/Music/lists.db',
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
                name: 'lists',
                ddl: `
                    CREATE TABLE IF NOT EXISTS listening_stats (
                        trackId TEXT PRIMARY KEY,
                        playCount INTEGER NOT NULL DEFAULT 0,
                        listenedSeconds INTEGER NOT NULL DEFAULT 0,
                        lastPlayedAt INTEGER,
                        displayName TEXT,
                        updatedAt INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS listening_sessions (
                        sessionId TEXT PRIMARY KEY,
                        trackId TEXT NOT NULL,
                        playDelta INTEGER NOT NULL DEFAULT 0,
                        listenedDelta INTEGER NOT NULL DEFAULT 0,
                        createdAt INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS favorites (
                        file_id TEXT PRIMARY KEY,
                        created_at INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS most_played (
                        file_id TEXT PRIMARY KEY,
                        play_count INTEGER NOT NULL DEFAULT 0,
                        last_played_at INTEGER
                    );
                    CREATE TABLE IF NOT EXISTS recently_played (
                        file_id TEXT NOT NULL,
                        played_at INTEGER NOT NULL,
                        session_id TEXT,
                        PRIMARY KEY (file_id, played_at)
                    );
                    CREATE INDEX IF NOT EXISTS idx_most_played_count ON most_played(play_count DESC);
                    CREATE INDEX IF NOT EXISTS idx_recently_played_at ON recently_played(played_at DESC);
                `,
            },
        ],
    });
}
