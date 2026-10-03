import { createDbEngine } from '@homelab/db-engine';

export function createVideoCacheEngine() {
    return createDbEngine({
        dbPath: '/home/CATIAA/WEB/db/Music/videocache.db',
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
                name: 'video-cache',
                ddl: `
                    CREATE TABLE IF NOT EXISTS video_cache (
                        youtube_id TEXT PRIMARY KEY,
                        format TEXT NOT NULL DEFAULT 'mp4',
                        codec TEXT NOT NULL DEFAULT 'h264',
                        resolution TEXT NOT NULL DEFAULT '720',
                        size INTEGER NOT NULL DEFAULT 0,
                        hit_count INTEGER NOT NULL DEFAULT 0,
                        is_seekable INTEGER DEFAULT 0,
                        source_url TEXT,
                        cached_at INTEGER NOT NULL,
                        last_accessed INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_video_cache_accessed ON video_cache(last_accessed DESC);
                `,
            },
        ],
    });
}
