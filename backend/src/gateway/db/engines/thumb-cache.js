import { createDbEngine } from '@homelab/db-engine';

export function createThumbCacheEngine() {
    return createDbEngine({
        dbPath: '/home/CATIAA/WEB/db/Music/thumbcache.db',
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
                name: 'thumb-cache',
                ddl: `
                    CREATE TABLE IF NOT EXISTS thumbnail_cache (
                        file_id TEXT PRIMARY KEY,
                        size TEXT NOT NULL DEFAULT 'full',
                        path TEXT NOT NULL,
                        generated_at INTEGER NOT NULL,
                        file_size INTEGER DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS thumbnail_queue (
                        file_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL DEFAULT 'pending',
                        priority INTEGER DEFAULT 0,
                        attempts INTEGER DEFAULT 0,
                        last_error TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_thumb_queue_status ON thumbnail_queue(status);
                `,
            },
        ],
    });
}
