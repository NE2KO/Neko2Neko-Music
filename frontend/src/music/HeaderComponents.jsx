import React from 'react';
import { List, Plus, Upload, RefreshCw, Grid, Check, Trash2, X, ArrowLeft, SlidersHorizontal } from 'lucide-react';

function PlaylistListHeader({
  playlistCount = 0,
  selectionMode = false,
  selectedCount = 0,
  onToggleSelect,
  onSelectAll,
  onDeleteSelected,
  onCancelSelect,
  onImport,
  onRefresh,
  onToggleView,
  displayMode = 'grid',
  isImporting = false,
  fileInputRef,
  onImportFile,
  onCreate,
  onMenuOpen,
  sortBy = null,
  sortOrder = 'asc',
  onOpenFilters,
  onToggleOrder,
}) {
  return (
    <div className="flex-shrink-0">
      {/* Normal Header */}
      {!selectionMode && (
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800 bg-neutral-900">
          {/* Left: menu + title */}
          <div className="flex items-center gap-2 min-w-0">
            {onMenuOpen && (
              <button onClick={onMenuOpen} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors flex-shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-neutral-100 truncate">Music</h1>
              <p className="text-[10px] text-neutral-500 leading-tight">
                {playlistCount} playlist{playlistCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Right: action buttons - horizontal scroll on overflow */}
          <div className="flex items-center gap-1.5 flex-shrink-0 overflow-x-auto ml-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <input ref={fileInputRef} type="file" accept=".xspf" onChange={onImportFile} className="hidden" />
            {onOpenFilters && (
              <button onClick={onOpenFilters} className={`w-8 h-8 rounded-lg border border-neutral-700/60 bg-neutral-800/80 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors flex items-center justify-center flex-shrink-0 ${sortBy ? 'border-sky-500/40 text-sky-400' : ''}`} title="Filters">
                <SlidersHorizontal size={15} />
              </button>
            )}
            <button onClick={onToggleSelect} className="h-8 px-2.5 rounded-lg text-[11px] font-medium border border-neutral-700/60 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors flex items-center gap-1 flex-shrink-0">
              <Check size={12} />
              <span className="hidden sm:inline">Select</span>
            </button>
            <button onClick={onCreate} className="w-8 h-8 rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-colors flex items-center justify-center flex-shrink-0" title="Add">
              <Plus size={15} />
            </button>
            <button onClick={() => fileInputRef?.current?.click()} disabled={isImporting} className="h-8 px-2.5 rounded-lg text-[11px] font-medium border border-neutral-700/60 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors flex items-center gap-1 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              <Upload size={12} />
              <span className="hidden sm:inline">{isImporting ? '...' : 'Import'}</span>
            </button>
            {onRefresh && (
              <button onClick={onRefresh} className="w-8 h-8 rounded-lg border border-neutral-700/60 bg-neutral-800/80 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors flex items-center justify-center flex-shrink-0" title="Refresh">
                <RefreshCw size={13} />
              </button>
            )}
            <button onClick={onToggleView} className="w-8 h-8 rounded-lg border border-neutral-700/60 bg-neutral-800/80 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors flex items-center justify-center flex-shrink-0" title="Toggle view">
              {displayMode === 'grid' ? <List size={13} /> : <Grid size={13} />}
            </button>
          </div>
        </div>
      )}

      {/* Selection Mode Header */}
      {selectionMode && (
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800 bg-neutral-900 animate-[slideDown_0.15s_ease-out]">
          <div className="flex items-center gap-2.5">
            <button onClick={onSelectAll} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedCount === playlistCount ? 'bg-sky-500 border-sky-500' : 'border-neutral-500 bg-transparent'}`}>
              {selectedCount === playlistCount && <Check size={12} className="text-white" />}
            </button>
            <span className="text-xs font-medium text-neutral-200">
              {selectedCount === playlistCount ? 'All selected' : `${selectedCount} selected`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onDeleteSelected} disabled={selectedCount === 0} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 size={12} />
              Delete ({selectedCount})
            </button>
            <button onClick={onCancelSelect} className="h-8 px-2.5 rounded-lg text-[11px] font-medium border border-neutral-700/60 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors flex items-center gap-1 flex-shrink-0">
              <X size={12} />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaylistDetailHeader({
  selectionMode = false,
  selectedCount = 0,
  trackCount = 0,
  onSelectAll,
  onDeleteSelected,
  onCancelSelect,
}) {
  if (!selectionMode) return null;
  return (
    <div className="flex-shrink-0 animate-[slideDown_0.15s_ease-out]">
      {/* Selection Mode Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-2.5">
          <button onClick={onSelectAll} className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedCount === trackCount ? 'bg-sky-500 border-sky-500' : 'border-neutral-500 bg-transparent'}`}>
            {selectedCount === trackCount && <Check size={12} className="text-white" />}
          </button>
          <span className="text-xs font-medium text-neutral-200">
            {selectedCount === trackCount ? 'All selected' : `${selectedCount} selected`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onDeleteSelected} disabled={selectedCount === 0} className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-1 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
            <Trash2 size={12} />
            Delete ({selectedCount})
          </button>
          <button onClick={onCancelSelect} className="h-8 px-2.5 rounded-lg text-[11px] font-medium border border-neutral-700/60 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors flex items-center gap-1 flex-shrink-0">
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { PlaylistListHeader, PlaylistDetailHeader };
