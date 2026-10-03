import React, { useState } from 'react';
import { Music, Plus, ArrowLeft } from 'lucide-react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { PlaylistListHeader, PlaylistDetailHeader } from './HeaderComponents';
import PlaylistListRow, { injectPlaylistListRowStyles } from './PlaylistListRow';
import PlaylistTrackGridInner from './PlaylistTrackGridInner';
import MusicHome from './MusicHome';
import { useToast } from '../shared/Toast';
import { deletePlaylist } from '../utils/api';

injectPlaylistListRowStyles();

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;

export default function PlaylistMiddleModule({
  selectedPlaylist,
  loadingTracks,
  displayMode,
  setDisplayMode,
  playerOpen,
  handlePlay,
  handlePlayShuffle,
  handlePlayTrack,
  handlePlayPlaylist,
  handleSelectPlaylist,
  handleBackToList,
  handleBulkDelete,
  handleCancelDeleteMode,
  handleOpenPlaylistFilters,
  handleOpenTrackFilters,
  handleImportXSPF,
  handleRefresh,
  handleCreateManualPlaylist,
  fileInputRef,
  coverInputRef,
  playlistSort,
  trackSort,
  trackFilterType,
  playlistSortOptions,
  trackSortOptions,
  trackFilterOptions,
  onPlaylistSortChange,
  onTrackSortChange,
  onTrackFilterTypeChange,
  onFilterApply,
  showFilterPanel,
  setShowFilterPanel,
  filterPanelType,
  setFilterPanelType,
  deleteMode,
  setDeleteMode,
  selectedForDelete,
  selectAllForDelete,
  deletingTrackIds,
  playlistDeleteMode,
  selectedPlaylistIds,
  isImporting,
  loading,
  playlists,
  sortedPlaylists,
  displayTracks,
  sortedTracks,
  totalDurationSeconds,
  listItemSize,
  gridItems,
  leavingTrackIds,
  enteringTrackIds,
  shiftAbove,
  playingFileId,
  isPlayingActive,
  detailScrollRef,
  trackCount,
  isLoved,
  showAddMusicPanel,
  setShowAddMusicPanel,
  showCreateModal,
  setShowCreateModal,
  createTitle,
  setCreateTitle,
  isCreating,
  onMenuOpen,
  onToggleOrder,
  toggleSelectForDelete,
  handleRemoveTrack,
  handleListItemsRendered,
  handleGridItemsRendered,
  handleTrackGridSelect,
  PlaylistHeroHeader,
  PlaylistToolbar,
  favorites,
  rawOnPlayTrack,
}) {
  const { showToast } = useToast();

  const handleDeleteSelected = async () => {
    if (selectedPlaylistIds.size === 0) return;
    for (const id of selectedPlaylistIds) {
      try { await deletePlaylist(id); } catch {}
    }
    showToast(`${selectedPlaylistIds.size} playlist(s) deleted`, 'success');
    setSelectedPlaylistIds(new Set());
    setPlaylistDeleteMode(false);
  };

  const handleToggleSelect = () => {
    setPlaylistDeleteMode(true);
    setSelectedPlaylistIds(new Set());
  };

  const handleSelectAll = () => {
    if ((Array.isArray(playlists) ? playlists : []).length === selectedPlaylistIds.size) {
      setSelectedPlaylistIds(new Set());
    } else {
      setSelectedPlaylistIds(new Set((Array.isArray(playlists) ? playlists : []).map(p => p.id)));
    }
  };

  return (
    <div style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: '#121212', borderRadius: 12, overflow: 'hidden' }}>
      {/* Shared full-width header layer */}
      {!selectedPlaylist ? (
        <div style={{ position: 'relative', zIndex: 2, width: '100%', flexShrink: 0 }}>
          <div style={{ position: 'relative', width: '100%', padding: '16px 24px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.text.secondary, marginBottom: 4 }}>
                  Playlist
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && handleSelectPlaylist) {
                        handleSelectPlaylist({ id: e.target.value, title: e.target.options[e.target.selectedIndex].text });
                      }
                    }}
                    style={{
                      background: COLORS.bg.secondary,
                      border: `1px solid ${COLORS.border.primary}`,
                      borderRadius: 8,
                      color: COLORS.text.primary,
                      padding: '8px 32px 8px 12px',
                      fontSize: 13,
                      appearance: 'none',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 10px center',
                      cursor: 'pointer',
                      minWidth: 180,
                    }}
                  >
                    <option value="">Select playlist...</option>
                    {(Array.isArray(playlists) ? playlists : []).map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowCreateModal?.(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: `1px solid ${COLORS.border.primary}`,
                      background: `linear-gradient(135deg, ${COLORS.accent}, #8892E6)`,
                      color: '#000',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={14} />
                    Add Playlist
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : handleBackToList ? (
        <div style={{ position: 'relative', zIndex: 2, width: '100%', flexShrink: 0 }}>
          <div style={{ position: 'relative', width: '100%', padding: '16px 24px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: 'transparent' }}>.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={handleBackToList}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'transparent',
                      border: 'none',
                      color: '#a3a3a3',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                      padding: '8px 14px',
                      borderRadius: 8,
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#a3a3a3'}
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

       {/* Content Boundary */}
       <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
         {!selectedPlaylist ? (
           <div style={{
             flex: 1,
             minHeight: 0,
             display: 'flex',
             flexDirection: 'column',
             width: '100%',
             padding: '0 24px 16px',
             position: 'relative',
           }}>
             <MusicHome
               playlists={playlists}
               onPlayPlaylist={handlePlayPlaylist}
               onPlayTrack={rawOnPlayTrack || handlePlayTrack}
               onSelectPlaylist={handleSelectPlaylist}
               favorites={favorites}
             />
           </div>
        ) : (
          <div ref={detailScrollRef} data-debug-id="5.1" data-debug-name="PlaylistView" data-debug-type="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#121212' }}>
            <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'relative', width: '100%', padding: '16px 24px 0' }}>
                  <PlaylistDetailHeader
                    selectionMode={deleteMode}
                    selectedCount={selectedForDelete?.size || 0}
                    trackCount={trackCount}
                    onSelectAll={() => {
                      setSelectAllForDelete?.(true);
                      setSelectedForDelete?.(new Set());
                    }}
                    onDeleteSelected={handleBulkDelete}
                    onCancelSelect={handleCancelDeleteMode}
                  />
                  <PlaylistHeroHeader
                    playlist={selectedPlaylist}
                    isLoved={isLoved}
                    trackCount={trackCount}
                    totalDurationSeconds={totalDurationSeconds}
                    onCoverChange={() => coverInputRef?.current?.click()}
                    selectionMode={deleteMode}
                  />
                  <div style={{ position: 'relative', padding: '20px 0 0' }}>
                    <PlaylistToolbar
                      playlist={selectedPlaylist}
                      onPlay={handlePlay}
                      onShuffle={handlePlayShuffle}
                      onFilter={handleOpenTrackFilters}
                      filterType={trackFilterType}
                      onToggleView={() => setDisplayMode?.(d => d === 'grid' ? 'list' : 'grid')}
                      displayMode={displayMode}
                      onAdd={() => setShowAddMusicPanel?.(true)}
                      onEnterSelectMode={() => setDeleteMode?.(true)}
                    />
                  </div>
                  <div style={{ position: 'relative', padding: '18px 0 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                      {isLoved ? 'Loved' : (selectedPlaylist?.title || '')}
                    </div>
                    <div style={{ marginTop: 10, height: 1, background: COLORS.border.primary }} />
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', padding: '0 24px 16px', position: 'relative', background: '#121212' }}>
                <div
                  key={`pv-content-${selectedPlaylist?.id}-${loadingTracks ? 'loading' : 'ready'}`}
                  className="animate-in fade-in duration-300"
                  style={{ flex: 1, minHeight: 0, padding: '0 0 8px', display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}
                >
                  {loadingTracks ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                      <div style={{ width: '32px', height: '32px', border: `2px solid ${COLORS.border.primary}`, borderTop: `2px solid ${COLORS.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    </div>
                  ) : displayTracks?.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: COLORS.text.secondary }}>
                      <Music size={48} style={{ marginBottom: '12px', opacity: 0.3 }} />
                      <p style={{ margin: 0, fontSize: '14px' }}>No tracks in this playlist</p>
                    </div>
                  ) : displayMode === 'list' ? (
                    <div data-debug-id="5.2.2" data-debug-name="TrackListView" data-debug-type="list" style={{ flex: 1, minHeight: 0 }}>
                      <AutoSizer>
                        {({ height, width }) => (
                          <div style={{ height, width, display: 'flex', justifyContent: 'center' }}>
                            <List
                              key={`track-list-${displayMode}`}
                              height={height}
                              width={width || 0}
                              itemCount={displayTracks.length}
                              itemSize={listItemSize}
                              overscanCount={5}
                              className="sidebar-scroll"
                              itemData={{ tracks: displayTracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, itemSize: 64, playingFileId, isPlayingActive, onSelect: (track, index) => { if (deleteMode) { toggleSelectForDelete?.(track.id); return; } if (track.file_id || track.id) handlePlayTrack(track, index); }, onRemove: handleRemoveTrack }}
                              onItemsRendered={handleListItemsRendered}
                            >
                              {PlaylistListRow}
                            </List>
                          </div>
                        )}
                      </AutoSizer>
                    </div>
                  ) : (
                    <div data-debug-id="5.2.3" data-debug-name="TrackGridView" data-debug-type="grid" style={{ flex: 1, minHeight: 0 }}>
                      <AutoSizer>
                        {({ height, width }) => {
                          const effW = Math.min(width || 0, CONTAINER_MAX);
                          const iw = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effW * 0.10)));
                          const ch = iw + 44;
                          const cols = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((effW - GUTTER) / (iw + GUTTER))));
                          return (
                            <PlaylistTrackGridInner
                              height={height}
                              width={width}
                              gridItems={gridItems}
                              onSelect={handleTrackGridSelect}
                              selectedForDelete={selectedForDelete}
                              deletingTrackIds={deletingTrackIds}
                              selectMode={deleteMode}
                              playingFileId={playingFileId}
                              isPlayingActive={isPlayingActive}
                              onProbeVisibleItems={handleGridItemsRendered}
                            />
                          );
                        }}
                      </AutoSizer>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
