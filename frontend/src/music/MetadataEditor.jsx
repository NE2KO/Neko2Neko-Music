import React, { useState, useEffect, useRef, useCallback } from 'react';
import CoverArtSearch from './CoverArtSearch';
import LyricsEditor from './LyricsEditor';
import ConfirmModal from '../shared/ConfirmModal';
import { parseFilenameToSearchTerms } from '../utils/filenameSearch';

function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

const OFFSET_MIN = -60;
const OFFSET_MAX = 60;

export default function MetadataEditor({ fileId, onClose, onSaved, onCoverChanged }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [videoStatus, setVideoStatus] = useState('not_cached');
  const [downloading, setDownloading] = useState(false);
  const [formats, setFormats] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [formatError, setFormatError] = useState(null);
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [videoSearchResults, setVideoSearchResults] = useState([]);
  const [videoSearching, setVideoSearching] = useState(false);
  const [pickedVideoId, setPickedVideoId] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    title: '',
    artist: '',
    album: '',
    genre: '',
    youtube_id: '',
    video_offset: 0,
  });
  const [offsetLocal, setOffsetLocal] = useState(0);

  useEffect(() => {
    if (!fileId) return;
    setLoading(true);
    fetch(`/api/metadata/${fileId}`)
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(data => {
        setMetadata(data);
        setForm({
          title: data.title || '',
          artist: data.artist || '',
          album: data.album || '',
          genre: data.genre || '',
          youtube_id: data.youtube_id || '',
          video_offset: Number(data.video_offset) || 0,
        });
        // Pre-fill the YouTube search box with the full filename (without
        // extension) so the query includes both artist and track, not just
        // whatever is currently stored in the title field.
        const fallbackTitle = data.title || data.display_name || '';
        const q = data.name ? data.name.replace(/\.[^.]+$/, '') : fallbackTitle;
        if (q && !videoSearchQuery) setVideoSearchQuery(q);
      })
      .catch(err => {
        console.error('[MetadataEditor] Load failed:', err);
        setMetadata({ error: err.message });
      })
      .finally(() => setLoading(false));
  }, [fileId]);

  // Keep the slider's live value in sync when video_offset changes elsewhere
  // (metadata load, +/- buttons, reset).
  useEffect(() => {
    setOffsetLocal(form.video_offset);
  }, [form.video_offset]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    let youtubeId = form.youtube_id.trim();
    const urlMatch = youtubeId.match(/(?:https?:\/\/(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (urlMatch) youtubeId = urlMatch[1];
    try {
      await fetch(`/api/metadata/${fileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, youtube_id: youtubeId }),
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [fileId, form, onSaved, onClose]);

  // In-app YouTube search (no need to switch to a browser tab). Picking a
  // result fills the YouTube ID field; the video-tab auto-save effect then
  // persists it to the DB.
  const handleVideoSearch = useCallback(async () => {
    if (!videoSearchQuery.trim()) return;
    setVideoSearching(true);
    setPickedVideoId(null);
    try {
      const res = await fetch('/api/video-cache/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: videoSearchQuery.trim() }),
      });
      const data = await res.json();
      setVideoSearchResults(Array.isArray(data) ? data : []);
    } catch {
      setVideoSearchResults([]);
    } finally {
      setVideoSearching(false);
    }
  }, [videoSearchQuery]);

  const handlePickVideo = useCallback((vid) => {
    setForm(f => ({ ...f, youtube_id: vid.id, title: vid.title || f.title }));
    setPickedVideoId(vid.id);
  }, []);

  const saveYoutubeId = useCallback(async () => {
    let youtubeId = form.youtube_id.trim();
    const urlMatch = youtubeId.match(/(?:https?:\/\/(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (urlMatch) youtubeId = urlMatch[1];
    if (!youtubeId) return;
    await fetch(`/api/video-cache/save-id/${fileId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeId, video_offset: form.video_offset || 0 }),
    });
  }, [fileId, form.youtube_id, form.video_offset]);

  const handleCoverApplied = useCallback(async () => {
    try {
      const res = await fetch(`/api/metadata/${fileId}`);
      if (res.ok) {
        const data = await res.json();
        setMetadata(data);
      }
    } catch (err) {
      console.error('[MetadataEditor] Failed to refresh metadata:', err);
    }
    onCoverChanged?.();
  }, [fileId, onCoverChanged]);

  const handleLyricsSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/metadata/${fileId}`);
      if (res.ok) {
        const data = await res.json();
        setMetadata(data);
      }
    } catch (err) {
      console.error('[MetadataEditor] Failed to refresh metadata:', err);
    }
    onSaved?.();
  }, [fileId, onSaved]);

   // Auto-save video offset / youtube_id as they change on the Video tab.
   // Immediate (no debounce) and never aborted on unmount, so closing the
   // editor right after a change never drops the save. The first run (initial
   // load / tab open) is skipped to avoid re-PUTting untouched data.
   const autoSaveSkippedRef = useRef(true);
   useEffect(() => {
     if (activeTab !== 'video') return;
     if (autoSaveSkippedRef.current) {
       autoSaveSkippedRef.current = false;
       return;
     }
     let youtubeId = form.youtube_id.trim();
     const urlMatch = youtubeId.match(/(?:https?:\/\/(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
     if (urlMatch) youtubeId = urlMatch[1];

     fetch(`/api/metadata/${fileId}`, {
       method: 'PUT',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ...form, youtube_id: youtubeId }),
     })
       .then(() => { onSaved?.(); })
       .catch(err => console.error('[MetadataEditor] Auto-save failed:', err));
   }, [activeTab, fileId, form, onSaved]);

   // Check video cache status when video tab opens or youtube_id changes
  useEffect(() => {
    if (activeTab === 'video' && form.youtube_id) {
      fetch(`/api/video-cache/progress/${form.youtube_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setVideoStatus(data.status === 'cached' ? 'cached' : 'not_cached');
          }
        })
        .catch(() => setVideoStatus('error'));
    }
  }, [activeTab, form.youtube_id]);

  // Reset detected formats whenever the YouTube ID changes
  useEffect(() => {
    setFormats(null);
    setSelectedFormat('');
    setFormatError(null);
  }, [form.youtube_id]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-neutral-900 rounded-2xl p-8" onClick={e => e.stopPropagation()}>
          <div className="w-6 h-6 border-2 border-white/20 border-t-purple-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (metadata?.error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-neutral-900 border border-white/10 rounded-2xl p-6 max-w-sm" onClick={e => e.stopPropagation()}>
          <p className="text-red-400 text-sm text-center mb-4">{metadata.error}</p>
          <p className="text-white/40 text-xs text-center mb-4">ID: {fileId}</p>
          <button onClick={onClose} className="w-full py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors">
            Tutup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-debug-id="1.1.9.6" data-debug-name="MetadataEditor" data-debug-type="panel" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-white font-semibold">Edit Metadata</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {[
            { id: 'info', label: 'Info' },
            { id: 'cover', label: 'Cover' },
            { id: 'lyrics', label: 'Lirik' },
            { id: 'video', label: 'Video' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-purple-400 border-b-2 border-purple-400'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          {activeTab === 'info' && (
            <div className="space-y-4">
              {[
                { key: 'title', label: 'Title' },
                { key: 'artist', label: 'Artist' },
                { key: 'album', label: 'Album' },
                { key: 'genre', label: 'Genre' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-white/50 mb-1.5">{field.label}</label>
                  <input
                    type="text"
                    value={form[field.key]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
              ))}
              {metadata?.name && (
                <div className="p-3 bg-neutral-800/50 rounded-lg">
                  <p className="text-xs text-white/40">File</p>
                  <p className="text-sm text-white/70 truncate">{metadata.name}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'cover' && (
            <CoverArtSearch
              fileId={fileId}
              currentMetadata={metadata}
              onApplied={handleCoverApplied}
            />
          )}

          {activeTab === 'lyrics' && (
            <LyricsEditor
              fileId={fileId}
              currentMetadata={metadata}
              onSaved={handleLyricsSaved}
            />
          )}

          {activeTab === 'video' && (
            <div className="space-y-4">
              {/* In-app YouTube search */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Cari Video di YouTube</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Judul lagu / artis"
                    value={videoSearchQuery}
                    onChange={e => setVideoSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleVideoSearch(); }}
                    className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={handleVideoSearch}
                    disabled={videoSearching || !videoSearchQuery.trim()}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
                  >
                    {videoSearching && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    {videoSearching ? 'Mencari...' : 'Cari'}
                  </button>
                </div>

                {/* Results */}
                {videoSearching && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                    {[0,1,2,3,4].map(i => (
                      <div key={i} className="bg-neutral-800 rounded-lg aspect-video animate-pulse" />
                    ))}
                  </div>
                )}

                {!videoSearching && videoSearchResults.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                    {videoSearchResults.map(vid => {
                      const selected = pickedVideoId === vid.id || (!pickedVideoId && form.youtube_id === vid.id);
                      return (
                        <button
                          key={vid.id}
                          onClick={() => handlePickVideo(vid)}
                          className={`relative bg-neutral-800 rounded-lg overflow-hidden border-2 transition-colors text-left ${
                            selected ? 'border-purple-500' : 'border-white/10 hover:border-purple-500/60'
                          }`}
                        >
                          <div className="relative">
                            <img src={vid.thumbnail} alt={vid.title} className="w-full aspect-video object-cover" />
                            {vid.duration ? (
                              <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/75 text-[9px] font-medium text-white/90">
                                {formatDuration(vid.duration)}
                              </span>
                            ) : null}
                            {selected && (
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-purple-600 text-[8px] font-bold uppercase text-white">Terpilih</span>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-[11px] text-white/80 leading-tight line-clamp-2">{vid.title}</p>
                            {vid.channel && <p className="text-[10px] text-white/40 truncate mt-0.5">{vid.channel}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!videoSearching && videoSearchResults.length === 0 && videoSearchQuery.trim() && (
                  <p className="text-center text-white/30 text-xs mt-3">Tidak ditemukan. Coba kata kunci lain.</p>
                )}
              </div>

              <div className="border-t border-white/5" />

               <div>
                 <label className="block text-xs text-white/50 mb-1.5">
                   YouTube URL / ID
                   {videoStatus === 'cached' && (
                     <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-green-500/20 text-green-400 border border-green-500/30">Cached</span>
                   )}
                 </label>
                 <input
                   type="text"
                   value={form.youtube_id}
                   onChange={e => {
                     const val = e.target.value.trim();
                     const match = val.match(/(?:https?:\/\/(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
                     const id = match ? match[1] : val;
                     setForm(f => ({ ...f, youtube_id: id }));
                   }}
                   placeholder="YouTube video ID (dQw4w9WgXcQ) atau URL"
                   readOnly={videoStatus === 'cached'}
                   className={`w-full rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-purple-500 ${
                     videoStatus === 'cached'
                       ? 'bg-neutral-800/50 border border-green-500/50 text-green-400'
                       : 'bg-neutral-800 border border-white/10'
                   }`}
                 />
               </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Video Offset (detik)</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, video_offset: Math.max(OFFSET_MIN, Math.round((f.video_offset - 0.5) * 10) / 10) }))}
                    className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white rounded bg-neutral-700/50 hover:bg-neutral-600/50"
                  >-</button>
                  <input
                    type="range"
                    min={OFFSET_MIN}
                    max={OFFSET_MAX}
                    step={0.1}
                    value={offsetLocal}
                    onChange={(e) => setOffsetLocal(Number(e.target.value))}
                    onPointerUp={(e) => setForm(f => ({ ...f, video_offset: Number(e.target.value) }))}
                    onKeyUp={(e) => setForm(f => ({ ...f, video_offset: Number(e.target.value) }))}
                    className="flex-1 accent-purple-500 cursor-pointer"
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, video_offset: Math.min(OFFSET_MAX, Math.round((f.video_offset + 0.5) * 10) / 10) }))}
                    className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white rounded bg-neutral-700/50 hover:bg-neutral-600/50"
                  >+</button>
                  <span className="text-sm text-white/80 font-mono w-16 text-center">{offsetLocal > 0 ? '+' : ''}{Number(offsetLocal).toFixed(1)}s</span>
                </div>
                <span className="text-[10px] text-white/30">{OFFSET_MIN.toFixed(1)}s … +{OFFSET_MAX.toFixed(1)}s</span>
              </div>

              {/* Format detection + selector */}
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    if (!form.youtube_id) return;
                    setDetecting(true);
                    setFormats(null);
                    setFormatError(null);
                    setSelectedFormat('');
                    try {
                      const res = await fetch('/api/download/formats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: `https://youtube.com/watch?v=${form.youtube_id}`, category: 'youtube' }),
                      });
                      const data = await res.json();
                      if (!res.ok || data.error) {
                        setFormatError(data.error || 'Gagal mendeteksi format');
                      } else {
                        setFormats(data);
                      }
                    } catch (e) {
                      setFormatError('Gagal mendeteksi format');
                    } finally {
                      setDetecting(false);
                    }
                  }}
                  disabled={detecting || !form.youtube_id}
                  className="w-full py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {detecting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Mendeteksi...
                    </>
                  ) : 'Detect Format'}
                </button>

                {formatError && (
                  <p className="text-xs text-red-400">{formatError}</p>
                )}

                {formats && formats.video && (
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Format Video</label>
                    <select
                      value={selectedFormat}
                      onChange={e => setSelectedFormat(e.target.value)}
                      className="w-full bg-neutral-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    >
                      <option value="">Default (best ≤1080p)</option>
                      {Object.entries(formats.video).map(([res, list]) => {
                        const best = list.find(f => f.best) || list[0];
                        const label = [
                          res,
                          best.vcodec ? best.vcodec.replace(/^avc1/, 'avc1') : '',
                          best.filesize || best.tbr,
                          best.fps ? `${best.fps}fps` : '',
                          best.hdr ? 'HDR' : '',
                        ].filter(Boolean).join(' · ');
                        return (
                          <option key={res} value={best.selector}>{label}</option>
                        );
                      })}
                    </select>
                    {formats.title && (
                      <p className="text-[10px] text-white/30 mt-1 truncate">{formats.title}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3 bg-neutral-800/50 rounded-lg min-h-[60px]">
                <p className="text-xs text-white/40 mb-1">Status</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    videoStatus === 'cached' ? 'bg-green-500' : 
                    videoStatus === 'downloading' ? 'bg-yellow-500 animate-pulse' : 
                    videoStatus === 'error' ? 'bg-red-500' : 'bg-neutral-500'
                  }`} />
                  <span className="text-white text-sm capitalize">{videoStatus}</span>
                </div>
              </div>

               <button
                 onClick={async () => {
                   if (!form.youtube_id) return;
                   setDownloading(true);
                   setVideoStatus('downloading');
                   try {
                     const res = await fetch(`/api/video-cache/download/${form.youtube_id}?force=true`, {
                       method: 'POST',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ format: selectedFormat }),
                     });
                     const data = await res.json();

                     if (data.status === 'cached') {
                       setVideoStatus('cached');
                       await saveYoutubeId();
                     } else {
                       // Poll for progress
                       let pollInterval = setInterval(async () => {
                         try {
                           const prog = await fetch(`/api/video-cache/progress/${form.youtube_id}`).then(r => r.json());
                           if (prog.status === 'cached') {
                             setVideoStatus('cached');
                             clearInterval(pollInterval);
                             await saveYoutubeId();
                           } else if (prog.status === 'error') {
                             setVideoStatus('error');
                             clearInterval(pollInterval);
                           }
                         } catch {}
                       }, 1000);

                       setTimeout(() => {
                         clearInterval(pollInterval);
                         setDownloading(false);
                       }, 60000);
                     }
                   } catch (e) {
                     setVideoStatus('error');
                   } finally {
                     setTimeout(() => setDownloading(false), 500);
                   }
                 }}
                 disabled={downloading || !form.youtube_id}
                 className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {downloading ? 'Downloading...' : (videoStatus === 'cached' ? 'Redownload Video' : 'Download Video')}
               </button>

              {videoStatus === 'cached' && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  className="w-full py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Menghapus...' : 'Hapus Video'}
                </button>
              )}
            </div>
          )}

          <ConfirmModal
            open={confirmDelete}
            title="Hapus Video?"
            message="Video yang di-cache untuk track ini akan dihapus dan YouTube ID-nya akan direset. Tindakan ini tidak bisa dibatalkan."
            confirmLabel="Hapus"
            cancelLabel="Batal"
            danger
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              setDeleting(true);
              try {
                await fetch(`/api/video-cache/${form.youtube_id}`, { method: 'DELETE' });
                await fetch(`/api/video-cache/save-id/${fileId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ youtubeId: '' }),
                });
                setVideoStatus('not_cached');
                setForm(f => ({ ...f, youtube_id: '' }));
                setFormats(null);
                setSelectedFormat('');
                setFormatError(null);
              } catch (e) {
                // ignore
              } finally {
                setDeleting(false);
                setConfirmDelete(false);
              }
            }}
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          {activeTab === 'info' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/50 hover:text-white rounded-lg transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
