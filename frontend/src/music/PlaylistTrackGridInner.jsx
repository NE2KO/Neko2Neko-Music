import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { VariableSizeList as List } from 'react-window';
import PlaylistRow from './PlaylistRow';

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;

export default function PlaylistTrackGridInner({
  height, width, gridItems, onSelect, selectedForDelete, deletingTrackIds, selectMode, playingFileId, isPlayingActive, onProbeVisibleItems,
}) {
  const listRef = useRef(null);

  const { cols, IW, CH } = useMemo(() => {
    const effectiveWidth = Math.min(width || 0, CONTAINER_MAX);
    const iw = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effectiveWidth * 0.10)));
    const ch = iw + 44;
    const c = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((effectiveWidth - GUTTER) / (iw + GUTTER))));
    return { cols: c, IW: iw, CH: ch };
  }, [width]);

  const rows = useMemo(() => {
    const r = [];
    let currentRow = { items: [] };
    for (let i = 0; i < gridItems.length; i++) {
      currentRow.items.push(gridItems[i]);
      if (currentRow.items.length === cols) { r.push(currentRow); currentRow = { items: [] }; }
    }
    if (currentRow.items.length > 0) r.push(currentRow);
    return r;
  }, [gridItems, cols]);

  const slideMap = useMemo(() => {
    if (!gridItems.some(it => it._leaving)) return null;
    const rowWidth = width || 0;
    const centerOffset = (c) => c <= 0 ? 0 : (rowWidth - (c * IW + (c - 1) * GUTTER)) / 2;
    const fullRowsOld = Math.floor(gridItems.length / cols);
    const lastCountOld = gridItems.length % cols === 0 ? cols : gridItems.length % cols;
    const leavingBefore = [];
    let removed = 0;
    for (let i = 0; i < gridItems.length; i++) {
      leavingBefore[i] = removed;
      if (gridItems[i]._leaving) removed++;
    }
    const remaining = gridItems.length - removed;
    const fullRowsNew = Math.floor(remaining / cols);
    const lastCountNew = remaining % cols === 0 ? cols : remaining % cols;
    const map = {};
    for (let i = 0; i < gridItems.length; i++) {
      const it = gridItems[i];
      if (it._leaving) continue;
      const oldRow = Math.floor(i / cols);
      const oldCol = i % cols;
      const oldCount = oldRow < fullRowsOld ? cols : lastCountOld;
      const newIndex = i - leavingBefore[i];
      const newRow = Math.floor(newIndex / cols);
      const newCol = newIndex % cols;
      const newCount = newRow < fullRowsNew ? cols : lastCountNew;
      const oldLeft = centerOffset(oldCount) + oldCol * (IW + GUTTER);
      const newLeft = centerOffset(newCount) + newCol * (IW + GUTTER);
      map[it._trackId] = {
        dx: Math.round(newLeft - oldLeft),
        dy: (newRow - oldRow) * (CH + GUTTER),
      };
    }
    return map;
  }, [gridItems, cols, IW, CH, width]);

  const gridData = useMemo(() => ({
    rows, onSelect, itemWidth: IW, cardHeight: CH, columnCount: cols, selectedForDelete, deletingTrackIds, selectMode, slideMap, playingFileId, isPlayingActive,
  }), [rows, onSelect, IW, CH, cols, selectedForDelete, deletingTrackIds, selectMode, slideMap, playingFileId, isPlayingActive]);

  const itemSize = useCallback(() => CH + GUTTER, [CH]);

  useEffect(() => {
    listRef.current?.resetAfterIndex(0);
  }, [CH, cols]);

  if (!height || !width || height <= 0 || width <= 0) return null;
  const gridHeight = Math.max(0, height - GUTTER);
  return (
    <List
      ref={listRef}
      key="track-grid"
      height={gridHeight}
      width={width}
      itemCount={rows.length}
      itemSize={itemSize}
      overscanCount={3}
      className="sidebar-scroll"
      itemData={gridData}
      onItemsRendered={({ overscanStartIndex, overscanStopIndex }) => {
        if (!onProbeVisibleItems) return;
        const ids = [];
        for (let r = overscanStartIndex; r <= overscanStopIndex && r < rows.length; r++) {
          for (const it of rows[r].items) {
            const id = it._file_id || it._track?.file_id || it._trackId;
            if (id) ids.push(id);
          }
        }
        onProbeVisibleItems(ids);
      }}
    >
      {PlaylistRow}
    </List>
  );
}
