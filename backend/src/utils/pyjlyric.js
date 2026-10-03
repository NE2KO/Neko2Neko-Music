import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, 'pyjlyric_search.py');

function runScript(query, maxResults = 5) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 20000);
    execFile('python3', [SCRIPT_PATH, query, '--max', String(maxResults)], 
      { timeout: 18000, maxBuffer: 1024 * 1024 }, 
      (err, stdout) => {
        clearTimeout(timeout);
        if (err) return resolve([]);
        try {
          const results = JSON.parse(stdout);
          resolve(Array.isArray(results) ? results : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

export async function searchPyjlyric(query) {
  if (!query || !query.trim()) return [];
  const results = await runScript(query.trim(), 5);
  return results.map(r => ({
    id: null,
    trackName: r.trackName || '',
    artistName: r.artistName || '',
    albumName: '',
    duration: 0,
    plainLyrics: r.plainLyrics || null,
    syncedLyrics: null,
    instrumental: false,
    source: r.source || 'pyjlyric',
  }));
}
