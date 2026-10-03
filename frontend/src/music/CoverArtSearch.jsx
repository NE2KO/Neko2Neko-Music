import React, { useState, useCallback } from 'react';
import { parseFilenameToSearchTerms } from '../utils/filenameSearch';
import CropTool from './CropTool';

export default function CoverArtSearch({ fileId, currentMetadata, onApplied }) {
  const [query, setQuery] = useState(() => {
    const fromName = parseFilenameToSearchTerms(currentMetadata?.name || '');
    if (fromName.artist || fromName.track) return fromName;
    const fromMeta = {
      track: currentMetadata?.display_name || currentMetadata?.title || '',
      artist: currentMetadata?.artist || '',
      album: currentMetadata?.album || '',
    };
    return fromMeta;
  });
  const [freeQuery, setFreeQuery] = useState(() => {
    const fromName = currentMetadata?.name ? currentMetadata.name.replace(/\.[^.]+$/, '') : '';
    if (fromName) return fromName;
    const title = currentMetadata?.title || currentMetadata?.display_name || '';
    if (title) return title;
    return parseFilenameToSearchTerms(currentMetadata?.name || '').track || '';
  });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(null);
  const [appliedId, setAppliedId] = useState(null);
  const [lastSearchedBy, setLastSearchedBy] = useState(null);
  const [cropTarget, setCropTarget] = useState(null);

  const getBestImageUrl = useCallback((cover) => {
    const thumbs = cover.thumbnails || {};
    return thumbs['3000'] || thumbs['2000'] || thumbs['1200'] || thumbs['500'] || thumbs['250'] || cover.image;
  }, []);

  const hasMetadata = query.artist || query.album || query.track;
  const canSearch = hasMetadata || freeQuery.trim().length > 0;

  // Single search: sends the free-text query (auto-filled title) AND the
  // metadata fields. The backend prefers the free-text query when present and
  // falls back to metadata, so one button covers both search modes.
  const handleSearch = useCallback(async () => {
    if (!canSearch) return;
    setLoading(true);
    setLastSearchedBy(freeQuery.trim() ? 'query' : 'metadata');
    try {
      const params = new URLSearchParams();
      if (freeQuery.trim()) params.set('q', freeQuery.trim());
      if (query.artist) params.set('artist', query.artist);
      if (query.album) params.set('album', query.album);
      if (query.track) params.set('track', query.track);
      const res = await fetch(`/api/metadata/cover-art/search?${params}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [query, freeQuery, canSearch]);

  const handleApplyDirect = useCallback(async (imageUrl, coverId) => {
    setApplying(imageUrl);
    try {
      await fetch(`/api/metadata/${fileId}/cover`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, source: 'external' }),
      });
      setAppliedId(coverId);
      onApplied?.();
    } catch (err) {
      console.error('Apply failed:', err);
    } finally {
      setApplying(null);
    }
  }, [fileId, onApplied]);

  const handleCropSave = useCallback(async (blob) => {
    if (!cropTarget) return;
    setApplying(cropTarget.cover.image);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const formData = new FormData();
      formData.append('cover', blob, 'cover.jpg');
      const uploadRes = await fetch(`/api/metadata/${fileId}/cover/upload`, {
        method: 'PUT', body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!uploadRes.ok) throw new Error('Upload failed');
      setAppliedId(cropTarget.cover.id);
      setCropTarget(null);
      onApplied?.();
    } catch (err) {
      console.error('Apply failed:', err);
    } finally {
      clearTimeout(timeout);
      setApplying(null);
    }
  }, [fileId, cropTarget, onApplied]);

  return (
    <div className="space-y-4 min-h-[320px]">
      {/* Optional metadata refinement (used to score/sort results) */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Artist"
          value={query.artist}
          onChange={e => setQuery(q => ({ ...q, artist: e.target.value }))}
          className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
        />
        <input
          type="text"
          placeholder="Album"
          value={query.album}
          onChange={e => setQuery(q => ({ ...q, album: e.target.value }))}
          className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
        />
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Track"
          value={query.track}
          onChange={e => setQuery(q => ({ ...q, track: e.target.value }))}
          className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
        />
      </div>

      <div className="border-t border-white/5" />

      {/* Single search: the title is pre-filled, but editable. One button. */}
      <div>
        <label className="block text-xs text-white/50 mb-1.5">Search Query / Song Name</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Cth: YOASOBI Idol, Blue Archive Constant Moderato, ..."
            value={freeQuery}
            onChange={e => setFreeQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !canSearch}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
          >
            {loading && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? 'Mencari...' : 'Cari'}
          </button>
        </div>
      </div>

        {/* Results — no inner scroll: the modal is the single scroll container */}
        <div className="min-h-[260px]">
        {loading && (
          <div className="flex items-center justify-center h-[260px]">
            <div className="w-6 h-6 border-2 border-sky-600/20 border-t-sky-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {results.map((result, idx) => {
              const isYoutube = result.source === 'YouTube';
              const imageUrl = getBestImageUrl(result.cover);
              console.log('[CoverArtSearch] Result', idx, {
                source: result.source,
                hasImage: !!imageUrl,
                hasCover: !!result.cover,
                title: result.release?.title,
              });
              return (
                <div
                  key={idx}
                  onClick={() => isYoutube
                    ? setCropTarget(result)
                    : handleApplyDirect(getBestImageUrl(result.cover), result.cover.id)}
                  className={`bg-neutral-800 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
                    isYoutube ? 'border-red-500/40 hover:border-red-500/70' : 'border-white/10 hover:border-purple-500/60'
                  }`}
                >
                  <div className="relative">
                    <img
                      src={imageUrl}
                      alt={result.release.title}
                      className="w-full aspect-video object-cover"
                      onError={(e) => {
                        console.error('[CoverArtSearch] Image load failed:', imageUrl);
                        e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23333" width="100" height="100"/><text fill="%23666" x="50%" y="50%" text-anchor="middle">No Image</text></svg>';
                      }}
                    />
                    {result.source && (
                      <span className={`absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide pointer-events-none ${
                        result.source === 'Deezer' ? 'text-sky-300 bg-sky-500/40'
                        : result.source === 'iTunes' ? 'text-pink-300 bg-pink-500/30'
                        : result.source === 'MusicBrainz' ? 'text-purple-300 bg-purple-500/30'
                        : result.source === 'YouTube' ? 'text-red-300 bg-red-500/40'
                        : 'text-white/80 bg-black/60'
                      }`}>
                        {result.source}
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-white/70 truncate">{result.release.title}</p>
                    <p className="text-[10px] text-white/40 truncate">{result.release.artist}</p>
                    {isYoutube ? (
                      <div className="mt-1.5 flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('[CoverArtSearch] Crop clicked for YouTube result');
                            setCropTarget(result);
                          }}
                          disabled={applying !== null}
                          className="flex-1 py-1.5 text-[10px] font-medium bg-red-600/30 text-red-300 rounded hover:bg-red-600/50 transition-colors disabled:opacity-50"
                        >
                          Crop & Apply
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('[CoverArtSearch] Apply clicked:', imageUrl);
                          handleApplyDirect(imageUrl, result.cover.id);
                        }}
                        disabled={applying === result.cover.image || appliedId === result.cover.id}
                        className="mt-1.5 w-full py-1.5 text-[10px] font-medium bg-purple-600/30 text-purple-300 rounded hover:bg-purple-600/50 transition-colors disabled:opacity-50"
                      >
                        {appliedId === result.cover.id ? '✓ Terpasang' : applying === result.cover.image ? '⏳...' : 'Pasang'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && results.length === 0 && lastSearchedBy && (
          <p className="text-center text-white/30 text-sm h-[80px] flex items-center justify-center">
            Tidak ditemukan. Coba kata kunci lain.
          </p>
        )}

        {!loading && results.length === 0 && !lastSearchedBy && (
          <p className="text-center text-white/30 text-sm h-[80px] flex items-center justify-center">
            Klik Cari untuk mencari cover berdasarkan judul
          </p>
        )}
      </div>

      {/* Crop Tool Modal */}
      {cropTarget && (
        <CropTool
          imageUrl={getBestImageUrl(cropTarget.cover)}
          title={cropTarget.release.title}
          onSave={handleCropSave}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </div>
  );
}
