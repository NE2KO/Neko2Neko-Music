import { Router } from 'express';
import { listsDb } from '../db.js';

const router = Router();

// POST /api/listening/sync — delta per 5s, idempoten via sessionId
router.post('/sync', (req, res) => {
  try {
    const { sessionId, trackId, playCountDelta = 0, listenedSecondsDelta = 0, displayName } = req.body || {};
    if (!trackId) return res.status(400).json({ error: 'trackId required' });

    const sid = sessionId || `${trackId}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const playDelta = Math.max(0, parseInt(playCountDelta, 10) || 0);
    const listenDelta = Math.max(0, Math.round(Number(listenedSecondsDelta) || 0));
    if (playDelta === 0 && listenDelta === 0 && !displayName) {
      return res.json({ ok: true, noop: true });
    }

    // Idempotency: ignore duplicate sessionId
    const existing = listsDb.prepare('SELECT sessionId FROM listening_sessions WHERE sessionId = ?').get(sid);
    if (existing) {
      return res.json({ ok: true, deduped: true });
    }

    const now = Date.now();
    const tx = listsDb.transaction(() => {
      listsDb.prepare('INSERT INTO listening_sessions (sessionId, trackId, playDelta, listenedDelta, createdAt) VALUES (?,?,?,?,?)').run(sid, trackId, playDelta, listenDelta, now);
      const cur = listsDb.prepare('SELECT playCount, listenedSeconds FROM listening_stats WHERE trackId = ?').get(trackId);
      if (!cur) {
        listsDb.prepare('INSERT INTO listening_stats (trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt) VALUES (?,?,?,?,?,?)').run(trackId, playDelta, listenDelta, now, displayName || null, now);
      } else {
        listsDb.prepare('UPDATE listening_stats SET playCount = playCount + ?, listenedSeconds = listenedSeconds + ?, lastPlayedAt = ?, displayName = COALESCE(?, displayName), updatedAt = ? WHERE trackId = ?').run(playDelta, listenDelta, now, displayName || null, now, trackId);
      }
    });
    tx();

    res.json({ ok: true });
  } catch (err) {
    console.error('[listening/sync]', err);
    res.status(500).json({ error: 'sync failed' });
  }
});

// POST /api/listening/migrate — bulk legacy
router.post('/migrate', (req, res) => {
  try {
    const { stats } = req.body || {};
    if (!stats || typeof stats !== 'object') return res.status(400).json({ error: 'stats required' });
    let migrated = 0;
    const tx = listsDb.transaction(() => {
      for (const [trackId, data] of Object.entries(stats)) {
        const playCount = Math.max(0, parseInt(data.playCount, 10) || 0);
        const listenedSeconds = Math.max(0, Math.round(Number(data.listenedSeconds) || 0));
        if (playCount === 0 && listenedSeconds === 0) continue;
        const existing = listsDb.prepare('SELECT trackId FROM listening_stats WHERE trackId = ?').get(trackId);
        if (!existing) {
          listsDb.prepare('INSERT INTO listening_stats (trackId, playCount, listenedSeconds, lastPlayedAt, displayName, updatedAt) VALUES (?,?,?,?,?,?)').run(trackId, playCount, listenedSeconds, data.lastPlayedAt || Date.now(), data.displayName || null, Date.now());
        } else {
          const cur = listsDb.prepare('SELECT playCount, listenedSeconds FROM listening_stats WHERE trackId = ?').get(trackId);
          const newPlay = Math.max(cur.playCount, playCount);
          const newListened = Math.max(cur.listenedSeconds, listenedSeconds);
          listsDb.prepare('UPDATE listening_stats SET playCount = ?, listenedSeconds = ?, lastPlayedAt = ?, displayName = COALESCE(?, displayName), updatedAt = ? WHERE trackId = ?').run(newPlay, newListened, data.lastPlayedAt || Date.now(), data.displayName || null, Date.now(), trackId);
        }
        migrated++;
      }
    });
    tx();
    res.json({ ok: true, migrated });
  } catch (err) {
    console.error('[listening/migrate]', err);
    res.status(500).json({ error: 'migrate failed' });
  }
});

// GET /api/listening/stats?trackId=xxx — per track
router.get('/stats', (req, res) => {
  const { trackId } = req.query;
  if (trackId) {
    const row = listsDb.prepare('SELECT * FROM listening_stats WHERE trackId = ?').get(trackId);
    return res.json({ stats: row || null });
  }
  const rows = listsDb.prepare('SELECT * FROM listening_stats ORDER BY updatedAt DESC LIMIT 100').all();
  res.json({ stats: rows });
});

// GET /api/listening/leaderboard?metric=plays|listened&limit=10
router.get('/leaderboard', (req, res) => {
  const metric = req.query.metric === 'listened' ? 'listened' : 'plays';
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
  const orderCol = metric === 'listened' ? 'listenedSeconds DESC' : 'playCount DESC';
  const rows = listsDb.prepare(`SELECT trackId, displayName, playCount, listenedSeconds, lastPlayedAt, updatedAt FROM listening_stats WHERE playCount>0 OR listenedSeconds>0 ORDER BY ${orderCol} LIMIT ?`).all(limit);
  const total = listsDb.prepare('SELECT COUNT(*) as c, COALESCE(SUM(playCount),0) as plays, COALESCE(SUM(listenedSeconds),0) as listened FROM listening_stats').get();
  res.json({ leaderboard: rows, total: { tracks: total.c, plays: total.plays, listened: total.listened }, metric });
});

// GET /api/listening/recent?limit=20
router.get('/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const rows = listsDb.prepare('SELECT file_id as trackId, played_at as lastPlayedAt, session_id FROM recently_played ORDER BY played_at DESC LIMIT ?').all(limit);
  res.json({ leaderboard: rows, metric: 'recent' });
});

export default router;
