import React, { useState, useCallback, useEffect } from 'react';
import { parseLRC, formatLRCTime } from '../utils/lrcParser';
import { parseFilenameToSearchTerms } from '../utils/filenameSearch';

export default function LyricsEditor({ fileId, currentMetadata, onSaved }) {
  const [plainLyrics, setPlainLyrics] = useState(currentMetadata?.lyrics || '');
  const [syncedLyrics, setSyncedLyrics] = useState(currentMetadata?.lyrics_synced || '');
  const [romajiLyrics, setRomajiLyrics] = useState(currentMetadata?.lyrics_romaji || '');
  const [activeTab, setActiveTab] = useState('plain');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [parsedPreview, setParsedPreview] = useState([]);
  const [searchQuery, setSearchQuery] = useState(() => {
    const fromMeta = {
      track: currentMetadata?.title || '',
      artist: currentMetadata?.artist || '',
      album: currentMetadata?.album || '',
    };
    if (fromMeta.track || fromMeta.artist) return fromMeta;
    return parseFilenameToSearchTerms(currentMetadata?.name || '');
  });
  const [freeQuery, setFreeQuery] = useState(() => {
    const title = currentMetadata?.title || currentMetadata?.display_name || '';
    if (title) return title;
    return parseFilenameToSearchTerms(currentMetadata?.name || '').track || '';
  });
  const [lastSearchedBy, setLastSearchedBy] = useState(null);

  useEffect(() => {
    if (syncedLyrics) {
      setParsedPreview(parseLRC(syncedLyrics));
    } else {
      setParsedPreview([]);
    }
  }, [syncedLyrics]);

  const hasMetadata = searchQuery.track || searchQuery.artist;
  const canSearch = hasMetadata || freeQuery.trim().length > 0;

  // Single search: sends the free-text query (auto-filled title) AND the
  // metadata fields. The backend prefers the free-text query when present and
  // falls back to metadata, so one button covers both search modes.
  const handleSearch = useCallback(async () => {
    if (!canSearch) return;
    setSearching(true);
    setLastSearchedBy(freeQuery.trim() ? 'query' : 'metadata');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const params = new URLSearchParams({
        track: searchQuery.track,
        artist: searchQuery.artist,
        album: searchQuery.album,
      });
      if (currentMetadata?.duration) params.set('duration', String(currentMetadata.duration));
      if (freeQuery.trim()) params.set('q', freeQuery.trim());

      const res = await fetch(`/api/metadata/lyrics/search?${params}`, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Lyrics search failed:', err);
    } finally {
      clearTimeout(timer);
      setSearching(false);
    }
  }, [searchQuery, currentMetadata?.duration, canSearch, freeQuery]);

  const handleApplyResult = useCallback((result) => {
    setPlainLyrics(result.plainLyrics || '');
    setSyncedLyrics(result.syncedLyrics || '');
    setRomajiLyrics(result.romajiLyrics || '');
    if (result.syncedLyrics) {
      setActiveTab('synced');
    } else if (result.romajiLyrics) {
      setActiveTab('romaji');
    }
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/metadata/${fileId}/lyrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plainLyrics, syncedLyrics, romajiLyrics }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        onSaved?.();
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setSaveError(err.error || 'Gagal menyimpan');
      }
    } catch (err) {
      setSaveError('Gagal terhubung ke server');
    } finally {
      setSaving(false);
    }
  }, [fileId, plainLyrics, syncedLyrics, romajiLyrics, onSaved]);

  return (
    <div className="space-y-4">
      {/* Optional metadata refinement (used to score/sort results) */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Track"
            value={searchQuery.track}
            onChange={e => setSearchQuery(q => ({ ...q, track: e.target.value }))}
            className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          />
          <input
            type="text"
            placeholder="Artist"
            value={searchQuery.artist}
            onChange={e => setSearchQuery(q => ({ ...q, artist: e.target.value }))}
            className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Album (opsional)"
            value={searchQuery.album}
            onChange={e => setSearchQuery(q => ({ ...q, album: e.target.value }))}
            className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      <div className="border-t border-white/5" />

      {/* Single search: the title is pre-filled, but editable. One button. */}
      <div>
        <label className="block text-xs text-white/50 mb-1.5">Search Query / Song Name</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Cth: YOASOBI Idol, Hoshimachi Suisei Stellar Stellar, ..."
            value={freeQuery}
            onChange={e => setFreeQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !canSearch}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
          >
            {searching && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {searching ? 'Mencari...' : 'Cari'}
          </button>
        </div>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto overscroll-contain">
          {searchResults.map((result, idx) => (
            <button
              key={idx}
              onClick={() => handleApplyResult(result)}
              className="w-full p-2 bg-neutral-800/50 rounded-lg text-left hover:bg-neutral-700/50 transition-colors"
            >
              <p className="text-xs text-white/70">{result.artistName} — {result.trackName}</p>
              <p className="text-[10px] text-white/40">
                {result.syncedLyrics ? 'Synced LRC' : 'Plain text'}
                {result.romajiLyrics ? ' • Romaji' : ''}
                {result.source ? ` • ${result.source}` : ''}
                {result.albumName ? ` • ${result.albumName}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {searchResults.length === 0 && lastSearchedBy && !searching && (
        <p className="text-center text-white/30 text-xs">Tidak ditemukan. Coba kata kunci lain.</p>
      )}

      {searchResults.length === 0 && !lastSearchedBy && !searching && (
        <p className="text-center text-white/30 text-xs">Klik Cari untuk mencari lirik berdasarkan judul</p>
      )}

      {/* Tabs */}
      <div className="flex bg-neutral-800 rounded-lg p-0.5">
        <button
          onClick={() => setActiveTab('plain')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === 'plain' ? 'bg-neutral-700 text-white' : 'text-white/50'
          }`}
        >
          Plain Text
        </button>
        <button
          onClick={() => setActiveTab('synced')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === 'synced' ? 'bg-neutral-700 text-white' : 'text-white/50'
          }`}
        >
          Synced LRC
        </button>
        <button
          onClick={() => setActiveTab('romaji')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === 'romaji' ? 'bg-neutral-700 text-white' : 'text-white/50'
          }`}
        >
          Romaji
        </button>
      </div>

      {/* Editor */}
      {activeTab === 'plain' ? (
        <textarea
          value={plainLyrics}
          onChange={e => setPlainLyrics(e.target.value)}
          placeholder="Tempel lirik di sini..."
          className="w-full h-40 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500"
        />
      ) : activeTab === 'romaji' ? (
        <textarea
          value={romajiLyrics}
          onChange={e => setRomajiLyrics(e.target.value)}
          placeholder="Romaji lyrics..."
          className="w-full h-40 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500"
        />
      ) : (
        <div className="space-y-2">
          <textarea
            value={syncedLyrics}
            onChange={e => setSyncedLyrics(e.target.value)}
            placeholder="[00:12.34]Lirik synced di sini&#10;[00:15.67]Baris berikutnya"
            className="w-full h-40 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono resize-none focus:outline-none focus:border-purple-500"
          />
          {parsedPreview.length > 0 && (
            <div className="max-h-32 overflow-y-auto overscroll-contain bg-neutral-800/50 rounded-lg p-2">
              <p className="text-[10px] text-white/40 mb-1">Preview ({parsedPreview.length} baris)</p>
              {parsedPreview.slice(0, 10).map((line, idx) => (
                <p key={idx} className="text-xs text-white/60 break-words">
                  <span className="text-purple-400 whitespace-nowrap">{formatLRCTime(line.time)}</span> {line.text}
                </p>
              ))}
              {parsedPreview.length > 10 && (
                <p className="text-[10px] text-white/30">...dan {parsedPreview.length - 10} baris lagi</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save */}
      {saveError && (
        <p className="text-red-400 text-xs text-center">{saveError}</p>
      )}
      {saveSuccess && (
        <p className="text-green-400 text-xs text-center">Tersimpan ✓</p>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full py-2 text-white text-sm rounded-lg transition-colors disabled:opacity-50 ${saveSuccess ? 'bg-green-600 hover:bg-green-500' : 'bg-purple-600 hover:bg-purple-500'}`}
      >
        {saving ? 'Menyimpan...' : saveSuccess ? 'Tersimpan' : 'Simpan Lirik'}
      </button>
    </div>
  );
}
