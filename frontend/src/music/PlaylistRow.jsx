import React, { memo, useMemo } from 'react';
import { PlaylistGridCard } from './PlaylistGridCard';

const GUTTER = 8;

const PlaylistRow = memo(({ index, style, data }) => {
  const { rows, onSelect, onDelete, itemWidth, cardHeight, columnCount, selectedForDelete, deletingTrackIds, selectMode, slideMap, playingFileId } = data;
  const row = rows[index];

  const cardItems = useMemo(() => {
    return row.items.map(item => {
      const slide = slideMap?.[item._trackId];
      return {
        key: item.id,
        itemObj: {
          title: item._cardTitle,
          subtitle: item._cardSubtitle,
          thumbnailUrl: item._cardThumbnail,
          hasImage: item._cardHasImage,
          isFavorite: item._is_favorite,
        },
        rawItem: item,
        slideX: slide?.dx ?? 0,
        slideY: slide?.dy ?? 0,
      };
    });
  }, [row, slideMap]);

  return (
    <div style={{
      ...style,
      padding: `${GUTTER / 2}px 0`,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, ${itemWidth}px)`,
        gap: GUTTER,
        justifyContent: 'center',
      }}>
        {cardItems.map(({ key, itemObj, rawItem, slideX, slideY }) => (
          <PlaylistGridCard
            key={key}
            item={itemObj}
            typeLabel={rawItem._typeLabel}
            itemWidth={itemWidth}
            cardHeight={cardHeight}
            onSelect={onSelect}
            onDelete={onDelete}
            _rawItem={rawItem}
            isSelected={selectedForDelete?.has(rawItem._trackId ?? rawItem.id)}
            isDeleting={deletingTrackIds?.has(rawItem._trackId ?? rawItem.id)}
            isLeaving={rawItem._leaving}
            isEntering={rawItem._entering}
            slideX={slideX}
            slideY={slideY}
            selectMode={selectMode}
            isPlaying={rawItem._file_id && playingFileId && String(rawItem._file_id) === String(playingFileId)}
          />
        ))}
      </div>
    </div>
  );
});

PlaylistRow.displayName = 'PlaylistRow';

export default PlaylistRow;
