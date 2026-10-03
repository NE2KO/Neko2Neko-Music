import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Search, ChevronDown, Music, Check } from 'lucide-react';
import { searchAvailableTracks, addTracksToPlaylist } from '../utils/playlistApi';
import { useToast } from '../shared/Toast';
import { formatBytes as formatSize } from '../utils/format.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

function ThumbImg({ fileId, colorClass, size = 48 }) {
   const [src, setSrc] = useState(fileId ? `${API_BASE}/thumbnails/list/${fileId}.jpg` : null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(!fileId);

  useEffect(() => {
    if (fileId) {
       setSrc(`${API_BASE}/thumbnails/list/${fileId}.jpg`);
      setLoaded(false);
      setErr(false);
    } else {
      setSrc(null);
      setErr(true);
    }
  }, [fileId]);

  if (err || !src) {
    return (
      <div className={`rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}
        style={{ width: size, height: size }}>
        <Music className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="relative rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden bg-neutral-800"
      style={{ width: size, height: size }}>
      {!loaded && <Music className="w-6 h-6 text-neutral-600 absolute pointer-events-none" />}
      <img src={src} alt="" className={`w-full h-full object-cover ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)} onError={() => setErr(true)} />
    </div>
  );
}

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'ext', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'mtime', label: 'Modified' },
  { key: 'created_at', label: 'Created' },
];

const TYPE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'flac', label: 'FLAC' },
  { key: 'mp3', label: 'MP3' },
  { key: 'm4a', label: 'M4A' },
  { key: 'opus', label: 'OPUS' },
  { key: 'aac', label: 'AAC' },
  { key: 'wav', label: 'WAV' },
  { key: 'ogg', label: 'OGG' },
  { key: 'wma', label: 'WMA' },
  { key: 'webm', label: 'WEBM' },
];

const TYPE_COLORS = {
  '.flac': 'text-yellow-400 bg-yellow-500/15',
  '.mp3': 'text-purple-400 bg-purple-500/15',
  '.m4a': 'text-pink-400 bg-pink-500/15',
  '.opus': 'text-slate-300 bg-slate-500/15',
  '.aac': 'text-green-400 bg-green-500/15',
  '.wav': 'text-cyan-400 bg-cyan-500/15',
  '.ogg': 'text-orange-400 bg-orange-500/15',
  '.wma': 'text-blue-400 bg-blue-500/15',
  '.webm': 'text-emerald-400 bg-emerald-500/15',
};

const STORAGE_KEY = 'addMusicPanelPrefs';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

export default function AddMusicPanel({ isOpen, onClose, playlistId, playlistTitle, onTracksAdded, existingTrackIds = [] }) {
  const { showToast } = useToast();
  const savedPrefs = useRef(loadPrefs());
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [typeCounts, setTypeCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState(savedPrefs.current?.sortBy || 'name');
  const [sortOrder, setSortOrder] = useState(savedPrefs.current?.sortOrder || 'asc');
  const [typeFilter, setTypeFilter] = useState(savedPrefs.current?.typeFilter || 'all');
  const [selected, setSelected] = useState(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const searchTimerRef = useRef(null);

  const fetchFiles = useCallback(async () => {
    if (!playlistId) return;
    setLoading(true);
    try {
        const data = await searchAvailableTracks(playlistId, {
          sortBy,
          sortOrder,
          type: typeFilter,
          search: searchQuery,
        });
      const allFiles = data.files || [];
      const existingSet = new Set(existingTrackIds);
      let filtered = existingSet.size > 0
        ? allFiles.filter(f => !existingSet.has(f.id))
        : allFiles;
      // Defensive deduplication by ID
      const seen = new Set();
      filtered = filtered.filter(f => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
      setFiles(filtered);
      setTotal(filtered.length);
      // Recalculate type counts from filtered rows to keep UI in sync
      const newTypeCounts = {};
      for (const f of filtered) {
        if (f.ext) newTypeCounts[f.ext] = (newTypeCounts[f.ext] || 0) + 1;
      }
      setTypeCounts(newTypeCounts);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
    } finally {
      setLoading(false);
    }
  }, [playlistId, sortBy, sortOrder, typeFilter, searchQuery, existingTrackIds]);

  useEffect(() => {
    if (isOpen) {
      setVisibleCount(50);
      const timer = setTimeout(() => fetchFiles(), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, fetchFiles]);

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

  // Persist sort/type preferences
  useEffect(() => {
    savePrefs({ sortBy, sortOrder, typeFilter });
  }, [sortBy, sortOrder, typeFilter]);

  const handleSearch = useCallback((value) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
  }, []);

  const toggleSelect = useCallback((fileId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map(f => f.id)));
    }
  }, [selected.size, files]);

  const handleSort = useCallback((key) => {
    if (key === sortBy) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortOrder(key === 'name' ? 'asc' : 'desc');
    }
    setShowSortMenu(false);
  }, [sortBy]);

  const handleAdd = useCallback(async () => {
    if (selected.size === 0 || !playlistId) return;
    setIsAdding(true);
    try {
      const result = await addTracksToPlaylist(playlistId, Array.from(selected));
      const added = result.added || selected.size;
      const skipped = result.skipped || 0;
      if (skipped > 0) {
        showToast(`${added} added, ${skipped} already in playlist`, 'success');
      } else {
        showToast(`${added} track(s) added`, 'success');
      }
      setSelected(new Set());
      onTracksAdded?.(result.tracks);
      fetchFiles();
    } catch (err) {
      showToast('Failed to add tracks', 'error');
    } finally {
      setIsAdding(false);
    }
  }, [selected, playlistId, onTracksAdded, fetchFiles, showToast]);

  if (!isOpen) return null;

  const selectedSize = files.filter(f => selected.has(f.id)).reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <div data-debug-id="5.2.4" data-debug-name="AddMusicPanel" data-debug-type="panel" className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-[380px] max-w-[90vw] h-full bg-neutral-900 border-l border-neutral-700 flex flex-col shadow-2xl z-10"
        style={{ borderRadius: '24px 0 0 24px' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div>
            <h2 className="text-sm font-bold text-white">Add Music</h2>
            {playlistTitle && <p className="text-xs text-neutral-400 mt-0.5 truncate max-w-[250px]">{playlistTitle}</p>}
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sort + Type Filter Bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-800">
          {/* Sort dropdown */}
          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors">
              <span>{SORT_OPTIONS.find(s => s.key === sortBy)?.label || 'Name'}</span>
              <span className="text-neutral-500 text-[10px]">{sortOrder === 'asc' ? '↑' : '↓'}</span>
              <ChevronDown className="w-3 h-3 text-neutral-500" />
            </button>
            {showSortMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
                <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-20 py-1 min-w-[140px]">
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => handleSort(opt.key)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                        sortBy === opt.key ? 'text-sky-400 bg-sky-500/10' : 'text-neutral-300 hover:bg-neutral-700'
                      }`}>
                      <span>{opt.label}</span>
                      {sortBy === opt.key && <span className="text-[10px]">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Type filter pills */}
          <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
            {TYPE_OPTIONS.map(opt => {
              const count = opt.key === 'all' ? total : (typeCounts[`.${opt.key}`] || 0);
              return (
                <button key={opt.key} onClick={() => setTypeFilter(opt.key)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors ${
                    typeFilter === opt.key
                      ? 'bg-sky-600/20 text-sky-400'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'
                  }`}>
                  {opt.label}
                  {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-neutral-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
            <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search files..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 transition-colors" />
          </div>
        </div>

        {/* Select All */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-neutral-800/50">
          <button onClick={toggleSelectAll}
            className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors">
            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
              selected.size === files.length && files.length > 0 ? 'bg-sky-600 border-sky-600' : 'border-neutral-600'
            }`}>
              {selected.size === files.length && files.length > 0 && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            {selected.size > 0 ? `${selected.size}/${files.length} selected` : `Select all (${files.length})`}
          </button>
          <span className="text-[10px] text-neutral-500">{total} files</span>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-sky-600/20 border-t-sky-600 rounded-full animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-neutral-500">
              <Music className="w-8 h-8 mb-2 opacity-40" />
              <span className="text-xs">No files found</span>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1">
              {files.slice(0, visibleCount).map(file => {
                const isSelected = selected.has(file.id);
                const colorClass = TYPE_COLORS[file.ext] || 'text-neutral-400 bg-neutral-500/15';
                const extLabel = (file.ext || '').replace('.', '').toUpperCase();
                const displayName = (file.name || '').replace(/\.[^/.]+$/, '');
                return (
                  <div key={file.id} onClick={() => toggleSelect(file.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-600/10 border border-sky-500/30' : 'hover:bg-neutral-800 border border-transparent'
                    }`}>
                    {/* Cover */}
                    <ThumbImg fileId={file.has_thumb ? file.id : null} colorClass={colorClass} />

                    {/* Info (centered vertically) */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="text-xs font-medium text-neutral-200 truncate">{displayName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${colorClass}`}>{extLabel}</span>
                        <span className="text-[10px] text-neutral-500">{formatSize(file.size)}</span>
                      </div>
                    </div>

                    {/* Checkbox (right side) */}
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-sky-600 border-sky-600' : 'border-neutral-600'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                  </div>
                );
              })}
              {visibleCount < files.length && (
                <button
                  onClick={() => setVisibleCount(c => c + 100)}
                  className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  Show more ({files.length - visibleCount} remaining)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-neutral-800 bg-neutral-900/80">
          {selected.size > 0 && (
            <div className="text-[10px] text-neutral-400 text-center mb-2">
              <span className="text-sky-400 font-semibold">{selected.size}</span> file{selected.size !== 1 ? 's' : ''} selected
              <span className="mx-1.5 text-neutral-600">·</span>
              <span className="text-sky-400 font-semibold">{formatSize(selectedSize)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-neutral-700 text-neutral-400 text-xs font-medium hover:text-white hover:bg-neutral-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleAdd} disabled={selected.size === 0 || isAdding}
              className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {isAdding ? 'Adding...' : `Add ${selected.size || ''} Track${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
