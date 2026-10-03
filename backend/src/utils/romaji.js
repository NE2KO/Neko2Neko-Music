import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, 'romaji_convert.py');

export function hasJapanese(text) {
  if (!text) return false;
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
}

function convertBatch(lines) {
  return new Promise((resolve) => {
    const input = lines.join('\n');
    const timeout = setTimeout(() => resolve(lines), 15000);
    execFile('python3', [SCRIPT_PATH, input],
      { timeout: 12000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        clearTimeout(timeout);
        if (err) return resolve(lines);
        const output = stdout.trim().split('\n');
        // Ensure same length as input
        while (output.length < lines.length) output.push('');
        resolve(output.slice(0, lines.length));
      }
    );
  });
}

export async function generateRomajiLyrics(plainLyrics, syncedLyrics) {
  if (!plainLyrics && !syncedLyrics) return null;

  if (syncedLyrics) {
    const lines = syncedLyrics.split('\n');
    const textLines = lines.map(line => {
      const match = line.match(/^(\[[\d:.]+\])(.*)$/);
      return match ? match[2] : line;
    });
    const romajiLines = await convertBatch(textLines);
    return lines.map((line, i) => {
      const match = line.match(/^(\[[\d:.]+\])(.*)$/);
      if (match) return match[1] + romajiLines[i];
      return romajiLines[i];
    }).join('\n');
  }

  const lines = plainLyrics.split('\n');
  const romajiLines = await convertBatch(lines);
  return romajiLines.join('\n');
}
