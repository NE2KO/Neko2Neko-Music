import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import VideoIcon from './icons/VideoIcon';
import AudioIcon from './icons/AudioIcon';
import ImageIcon from './icons/ImageIcon';
import { Heart } from 'lucide-react';
import { getGroupLabel } from '../utils/grouping';

import { useIsFavorite } from '../store/favoritesStore';


// Thumbnail strip item sizing. `lg` is used by the dedicated Music UI so the
// carousel reads as a big, tappable track list (vs the compact media-vault strip).
const ITEM_SIZES = {
  sm: 'w-12 h-12 md:w-14 md:h-14',
  lg: 'w-20 h-20 md:w-24 md:h-24',
};

// Virtualization layout constants. They mirror the previous flex `gap-2` +
// `first:ml-1 last:mr-1` so the rendered spacing is identical:
//   GAP_PX = 8   (flex gap between items) -> implemented as item right-padding
//   LEAD   = 4   (first item left margin)
//   TRAIL  = 4   (last item right margin)
const GAP_PX = 8;
const LEAD = 4;
const TRAIL = 4;
const WINDOW_RADIUS = 12;   // ~25 nodes mounted around the active item initially
const SCROLL_BUFFER = 8;    // extra nodes kept mounted beyond the viewport
const INCLUDE_ACTIVE_MARGIN = 4; // keep the active item mounted near the window edge
const DRAG_THRESHOLD = 4;   // pointer movement before it becomes a drag-scroll
const HYDRATE_STEP = 8;     // scroll distance before the next prefetch window fires
const JUMP_THRESHOLD = 200; // index delta that counts as a large scrollbar jump
const JUMP_RADIUS = 200;    // prefetch radius used right after a large jump
const SCROLL_RADIUS = 60;   // prefetch radius used during normal incremental scroll
const RECENTER_IDLE_MS = 30000; // with lock ON, re-center to the active item after this much idleness
const DEFAULT_PITCH = { sm: 56, lg: 104 }; // item width + gap estimates (md+)

const estimateDividerWidth = (node) => {
  const text = node.folderName || node.label || '';
  return text.length * 7 + 40;
};

const CarouselItem = React.memo(React.forwardRef(function CarouselItem({ file, currentFileId, onClick, cacheBust, onToggleFavorite, itemSize = 'sm' }, ref) {
  const isActive = file.id === currentFileId;
  const [imgFailed, setImgFailed] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const fileId = file.file_id || file.id;
  const isFav = useIsFavorite(fileId, file.is_favorite ? 1 : 0);
  // All types (video / audio / image) use the lightweight 200px thumbnail the
  // backend generates — previously images loaded the full original file here,
  // which is what made the strip heavy when browsing an image gallery.
  const thumbUrl = fileId ? `/thumbnails/list/${fileId}.jpg?v=${cacheBust}` : null;

  const handleFavoriteClick = useCallback((e) => {
    e.stopPropagation();
    if (isToggling) return;
    setIsToggling(true);
    onToggleFavorite(file).finally(() => setIsToggling(false));
  }, [isToggling, onToggleFavorite, file]);

  const typeIcon = { video: <VideoIcon className="w-5 h-5 text-neutral-600" />, audio: <AudioIcon className="w-5 h-5 text-purple-400" />, image: <ImageIcon className="w-5 h-5 text-neutral-600" /> }[file.type] || <VideoIcon className="w-5 h-5 text-neutral-600" />;

  const itemButton = (
      <button
        onClick={onClick}
        draggable={false}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        className={`${ITEM_SIZES[itemSize] || ITEM_SIZES.sm} rounded-lg overflow-hidden relative block border-2 ${
          isActive ? 'border-[#8C98ED]/70' : 'border-transparent'
        }`}
        style={{
          transform: isActive ? 'scale(1)' : 'scale(0.82)',
          opacity: isActive ? 1 : 0.55,
          transition: 'transform 200ms ease, opacity 200ms ease',
        }}
      >
        {thumbUrl && !imgFailed ? (
          <img
            src={thumbUrl}
            alt={file.name}
            loading={isActive ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            className="w-full h-full object-cover"
            style={{ WebkitUserDrag: 'none', userSelect: 'none' }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-neutral-800">
            {typeIcon}
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60">
          <p className="text-[8px] truncate text-white/70">{file.display_name || file.name}</p>
        </div>
      </button>
  );

  return (
      <div
        ref={ref}
        className="relative flex-shrink-0 select-none"
        style={{ paddingRight: GAP_PX }}
      >
      {itemButton}
      {onToggleFavorite && (
        <span
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={handleFavoriteClick}
          className={`absolute top-0.5 right-0.5 p-1 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10 ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={12} className={isFav ? 'text-red-500 fill-red-500' : 'text-white/80'} />
        </span>
      )}
    </div>
  );
}));

export function Carousel({ files, currentFile, onSelect, sortBy = null, sortOrder = 'asc', cacheBust = '', onToggleFavorite = null, autoHide = false, hidden = false, onToggleHidden = () => {}, itemSize = 'sm', restoreScrollKey = null, slide = false, repo = null, onActivity = null, lockEnabled = true }) {
  const currentFileId = currentFile?.id;
  const scrollRef = useRef(null);
  const itemRefs = useRef(new Map());
  const tweenRafRef = useRef(null);
  const scrollSettleRef = useRef(null);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const SCROLL_STORAGE_KEY = `mv_carousel_scroll_${restoreScrollKey || 'default'}`;
  const scrollRestoredRef = useRef(false);
  const isFirstCenterRef = useRef(true);
  const activeWindowedRef = useRef(false);

  // Virtual (repository-backed) mode: the list is "infinite" — an ordered ID
  // index lives in the MediaRepository and items are hydrated on demand, so the
  // carousel never materializes the whole folder in React. Only the visible
  // window (+ buffer) mounts. When `repo` is absent (search etc.) we keep the
  // plain array behaviour.
  const virtualTotal = repo ? repo.total() : 0;
  const virtual = !!repo && virtualTotal > 0;
  const virtualRef = useRef(virtual);
  virtualRef.current = virtual;
  const virtualTotalRef = useRef(virtualTotal);
  virtualTotalRef.current = virtualTotal;

  const showFolderLabels = !virtual && files?.length > 1 && files.some(f => f.dir_path !== files[0]?.dir_path);

  const getGroupLabelShared = useCallback((item) => getGroupLabel(item, sortBy), [sortBy]);

  const metadataGroupedNodes = useMemo(() => {
    if (virtual) return null;
    if (!sortBy || sortBy === 'size') return null;
    const nodes = [];
    let lastLabel = null;
    for (const file of files) {
      const label = getGroupLabelShared(file);
      if (label !== lastLabel) {
        lastLabel = label;
        nodes.push({ type: 'divider', label });
      }
      nodes.push({ type: 'item', file });
    }
    return nodes;
  }, [files, sortBy, getGroupLabelShared]);

  const grouped = useMemo(() => {
    if (virtual) return null;
    if (!showFolderLabels) return null;
    const groups = [];
    let currentGroup = null;
    for (const file of files) {
      const path = file.dir_path || '/';
      if (!currentGroup || currentGroup.path !== path) {
        currentGroup = { path, files: [] };
        groups.push(currentGroup);
      }
      currentGroup.files.push(file);
    }
    return groups;
  }, [files, showFolderLabels]);

  // Flat node list: items + dividers (metadata labels or folder labels).
  const nodes = useMemo(() => {
    if (virtual) return [];
    if (metadataGroupedNodes) return metadataGroupedNodes;
    if (showFolderLabels && grouped) {
      const flat = [];
      for (let gi = 0; gi < grouped.length; gi++) {
        const g = grouped[gi];
        if (gi > 0) flat.push({ type: 'divider', folderName: g.path.split('/').pop() });
        for (const f of g.files) flat.push({ type: 'item', file: f });
      }
      return flat;
    }
    return (files || []).map((f) => ({ type: 'item', file: f }));
  }, [metadataGroupedNodes, showFolderLabels, grouped, files]);

  const [win, setWin] = useState({ start: 0, end: 25 });
  const [pitch, setPitch] = useState(() => DEFAULT_PITCH[itemSize] || 56);
  const [dividerWidths, setDividerWidths] = useState({});
  const [hydrateTick, setHydrateTick] = useState(0);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const winRef = useRef(win);
  winRef.current = win;
  const lastPrefetchRef = useRef(-1);
  const lastHydrationCenterRef = useRef(-1); // last prefetch center, for jump detection
  const abortControllerRef = useRef(null);   // cancels in-flight carousel prefetch

  // Virtual-only: keep a hydration window around the active item and funnel
  // loaded objects into a local re-render tick (the repo has no subscription,
  // so we re-read its cache after each fetch settles).
  useEffect(() => {
    if (!virtual) return;
    let on = true;
const ai = repo.findIndex(currentFileId);
      if (ai >= 0) {
        // Hydrate a generous radius around the active item so the user can walk
        // forward/back several screens without ever reaching an un-hydrated slot.
        // Without this, the hydrated region lagged behind and the carousel showed
        // empty placeholder blocks until you physically reached the boundary item.
        repo.prefetchWindow(ai, 120, undefined).then(() => {
          if (on) setHydrateTick((t) => t + 1);
        });
      }
    return () => { on = false; };
  }, [currentFileId, virtual, virtualTotal, repo]);
  const filesIdRef = useRef(files?.length ?? 0);
  const filesVersionRef = useRef(0);
  if ((files?.length ?? 0) !== filesIdRef.current) {
    filesIdRef.current = files?.length ?? 0;
    filesVersionRef.current += 1;
  }
  // The (rare) window that actually mounts: visible items + scroll buffer. In
  // virtual mode we also allow items already hydrated in the repo's object cache
  // to count toward the version bump, so new loads re-render the strip.
  if (virtual) {
    filesVersionRef.current += 1;
  }

  // Prefix sums of node widths: prefix[i] = total width of nodes [0, i). A node's
  // laid-out left edge is LEAD + prefix[i], which is deterministic regardless of
  // which window is mounted — so re-windowing never shifts the visible content.
  // In virtual mode every node is an item of uniform `pitch`, so prefix is the
  // trivial arithmetic sequence (built without materializing the folder).
  const prefix = useMemo(() => {
    const total = virtual ? virtualTotal : nodes.length;
    const arr = new Array(total + 1);
    arr[0] = 0;
    if (virtual) {
      for (let i = 1; i <= total; i++) arr[i] = i * pitch;
      return arr;
    }
    for (let i = 0; i < total; i++) {
      const n = nodes[i];
      const w = n.type === 'item'
        ? pitch
        : (dividerWidths[n.folderName || n.label] || estimateDividerWidth(n));
      arr[i + 1] = arr[i] + w;
    }
    return arr;
  }, [nodes, virtual, virtualTotal, pitch, dividerWidths]);
  const prefixRef = useRef(prefix);
  prefixRef.current = prefix;

  // id -> node index, so the active item lookup is O(1) instead of a scan.
  // In virtual mode the repo's index maps id -> position directly (no dividers).
  const nodeIndexById = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'item' && n.file && n.file.id != null && !m.has(n.file.id)) {
        m.set(n.file.id, i);
      }
    }
    return m;
  }, [nodes]);

  const findActiveIndex = useCallback(() => {
    if (!currentFileId) return -1;
    if (virtual) {
      // Guard: if the repo index hasn't been loaded yet, don't pretend the
      // active item is missing — just return -1 so the carousel stays quiet
      // instead of blanking or centering on nothing.
      const rec = repo.current?.();
      if (!rec || rec.total === 0) return -1;
      return repo.findIndex(currentFileId);
    }
    const i = nodeIndexById.get(currentFileId);
    return i == null ? -1 : i;
  }, [currentFileId, nodeIndexById, virtual, repo]);

  // Count of nodes entirely to the left of a horizontal position.
  const countLeft = useCallback((arr, pos) => {
    const target = pos - LEAD;
    if (target < 0) return 0;
    let lo = 0, hi = arr.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }, []);

  // Recompute the mounted window. Default mode covers whatever is visible at the
  // current scrollLeft (+ buffer) — it never re-centers on the active item, so
  // unrelated parent re-renders can't yank the window away from where the user
  // is scrolled (that was the "blank strip until you nudge" glitch). The active
  // item is kept mounted when it sits near the window edge so its marker +
  // centering stay resolvable. centerOnActive mode is used only by the centering
  // effect to bring a far-away active item into the window before scrolling to it.
  const recomputeWindow = useCallback((centerOnActive = false) => {
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;
    const arr = prefixRef.current;
    const total = virtualRef.current ? virtualTotalRef.current : nodesRef.current.length;
    if (total === 0) { setWin({ start: 0, end: 0 }); return; }
    const ai = findActiveIndex();
    let s, e;
    if (centerOnActive && ai >= 0) {
      s = Math.max(0, ai - WINDOW_RADIUS);
      e = Math.min(total, ai + WINDOW_RADIUS + 1);
    } else {
      const x = container.scrollLeft;
      const right = x + container.clientWidth;
      const firstVisible = Math.min(total - 1, countLeft(arr, x));
      const lastVisible = Math.min(total - 1, countLeft(arr, right));
      s = Math.max(0, firstVisible - SCROLL_BUFFER);
      e = Math.min(total, lastVisible + SCROLL_BUFFER + 1);
      if (ai >= 0 && ai >= s - INCLUDE_ACTIVE_MARGIN && ai <= e + INCLUDE_ACTIVE_MARGIN) {
        s = Math.min(s, ai);
        e = Math.max(e, ai + 1);
      }
    }
    const cur = winRef.current;
    if (s !== cur.start || e !== cur.end) setWin({ start: s, end: e });
  }, [countLeft, findActiveIndex]);

  // Refs bridge the latest helpers into the tweens/effects WITHOUT making their
  // identities part of an effect's dependency array. Identity churn from parent
  // re-renders (SendQueue rebuilds `files` on every render) was re-triggering
  // the centering effect and yanking the strip back to the active item each time.
  const findActiveIndexRef = useRef(findActiveIndex);
  findActiveIndexRef.current = findActiveIndex;
  const recomputeWindowRef = useRef(recomputeWindow);
  recomputeWindowRef.current = recomputeWindow;
  const centerFileIdRef = useRef(currentFileId);
  centerFileIdRef.current = currentFileId;

  // Live target that centers the current item's visual button inside the scroll
  // viewport. Recomputed on demand so tween steps chase the item's REAL position
  // — correcting the small drift caused by divider widths being measured (and
  // the prefix sums updating) mid-animation, which left the active item slightly
  // off-center from the play/pause button.
  const computeCenterTarget = useCallback((container, el) => {
    if (!container || !el) return null;
    const cWidth = container.clientWidth;
    if (cWidth === 0) return null;
    const cRect = container.getBoundingClientRect();
    const btn = el.firstElementChild || el;
    const eRect = btn.getBoundingClientRect();
    const eCenter = (eRect.left - cRect.left) + eRect.width / 2;
    const delta = eCenter - cWidth / 2;
    const maxScroll = container.scrollWidth - container.clientWidth;
    return Math.max(0, Math.min(maxScroll, container.scrollLeft + delta));
  }, []);

  // Recompute from the live scroll position whenever the list, measured sizes
  // or visibility change (no scroll event fires in those cases). This removes
  // the "blank until you nudge" glitch and the empty strip after an unhide.
  // `virtualTotal` is included so the window is recalculated as soon as the
  // async repo hydration settles — without waiting for the user to scroll.
  useEffect(() => {
    recomputeWindow(false);
  }, [nodes, pitch, dividerWidths, hidden, virtualTotal, recomputeWindow]);

  // Measure the real item pitch once items render (and re-measure on the
  // md breakpoint via ResizeObserver). Item width = button width + GAP_PX.
  useLayoutEffect(() => {
    const first = itemRefs.current.values().next().value;
    if (!first) return;
    const w = first.offsetWidth;
    if (w > 0 && Math.abs(w - pitch) > 0.5) setPitch(w);
  }, [win, nodes, pitch]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const first = itemRefs.current.values().next().value;
      if (first) {
        const w = first.offsetWidth;
        if (w > 0) setPitch(w);
      }
      recomputeWindow(false);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [recomputeWindow]);

  // Follow the scroll position: mount a small window around what is visible so
  // the whole list can be scrolled without rendering everything. Because node
  // positions are deterministic (LEAD + prefix[i]), no scrollLeft correction is
  // needed — the content stays put while the window slides.
  const scrollRafRef = useRef(null);
const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      recomputeWindow(false);
      // Keep auto-hide honest: scrolling is user activity, so ping the cluster's
      // idle timer (prevents controls fading out mid-scroll).
      onActivityRef.current?.();
      // Virtual-only: hydrate the newly visible region so scrolling never hits a
      // "wall". Throttled by a movement threshold + settle debounce so we don't
      // fire batches of network requests and re-renders on every scroll frame.
      if (virtualRef.current) {
        const c = winRef.current;
        // Center the prefetch window on the MIDDLE of the visible range (not just
        // the trailing edge). This makes the hydration bidirectional, so scrolling
        // backwards after a large jump never drops into a blind cache gap. A large
        // delta from the last hydration center is treated as a jump and uses a
        // bigger radius to pre-fill the entire new region in one shot.
        const center = Math.max(0, Math.min(virtualTotalRef.current - 1, Math.floor((c.start + c.end) / 2)));
        const isJump = Math.abs(center - lastHydrationCenterRef.current) >= JUMP_THRESHOLD;
        lastHydrationCenterRef.current = center;
        if (center >= 0 && Math.abs(center - lastPrefetchRef.current) >= HYDRATE_STEP) {
          lastPrefetchRef.current = center;
          const radius = isJump ? JUMP_RADIUS : SCROLL_RADIUS;
          // Cancel any in-flight carousel prefetch so a stale request can't
          // overwrite the latest target after a rapid jump. Navigation
          // (MediaModal) uses its own signal-free hydration and is never aborted.
          if (abortControllerRef.current) abortControllerRef.current.abort();
          const controller = new AbortController();
          abortControllerRef.current = controller;
          repo.prefetchWindow(center, radius, controller.signal);
        }
        if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
        scrollSettleRef.current = setTimeout(() => {
          scrollSettleRef.current = null;
          setHydrateTick((t) => t + 1);
        }, 160);
      }
      // Lock-gated idle re-center: with lock ON, once the strip has been idle
      // for RECENTER_IDLE_MS it smoothly returns to the current item. With lock
      // OFF (or while the user keeps scrolling) the timer keeps resetting/never
      // fires, so the strip stays exactly where it is.
      if (centerLockRef.current) {
        if (recenterTimerRef.current) clearTimeout(recenterTimerRef.current);
        recenterTimerRef.current = setTimeout(() => {
          recenterTimerRef.current = null;
          if (centerLockRef.current) centerToActiveRef.current();
        }, RECENTER_IDLE_MS);
      } else if (recenterTimerRef.current) {
        clearTimeout(recenterTimerRef.current);
        recenterTimerRef.current = null;
      }
    });
  }, [recomputeWindow]);

  const setItemRef = useCallback((id) => (el) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const renderItem = useCallback((item) => {
    return (
      <CarouselItem
        key={item.id}
        file={item}
        currentFileId={currentFileId}
        onClick={() => onSelect(item)}
        cacheBust={cacheBust}
        onToggleFavorite={onToggleFavorite}
        itemSize={itemSize}
        ref={setItemRef(item.id)}
      />
    );
  }, [currentFileId, onSelect, cacheBust, onToggleFavorite, setItemRef, itemSize]);

  const setDividerRef = useCallback((key) => (el) => {
    if (!el) return;
    const isFolder = el.dataset.folder === '1';
    const inner = el.firstElementChild;
    const innerW = inner ? inner.getBoundingClientRect().width : el.getBoundingClientRect().width;
    const margin = isFolder ? 12 : 24; // mx-1.5 (6+6) / mx-3 (12+12)
    const w = innerW + margin;
    setDividerWidths((prev) => {
      if (Math.abs((prev[key] || 0) - w) < 0.5) return prev;
      return { ...prev, [key]: w };
    });
  }, []);

  const easeToTarget = useCallback(() => {
    const container = scrollRef.current;
    const el = centerFileIdRef.current ? itemRefs.current.get(centerFileIdRef.current) : null;
    if (!container || !el) {
      tweenRafRef.current = null;
      return;
    }
    // Live target: chase the item's real position each frame so the active item
    // lands exactly centered even while divider prefix-sums settle.
    const target = computeCenterTarget(container, el);
    if (target == null) {
      tweenRafRef.current = null;
      return;
    }
    const diff = target - container.scrollLeft;
    if (Math.abs(diff) < 0.5) {
      container.scrollLeft = target;
      tweenRafRef.current = null;
      return;
    }
    // Instant jump for large distances (e.g., jumping from one end to the other
    // after next/previous). Small drifts still animate smoothly.
    if (Math.abs(diff) > container.clientWidth * 0.5) {
      container.scrollLeft = target;
      tweenRafRef.current = null;
      return;
    }
    container.scrollLeft += diff * 0.12;
    tweenRafRef.current = requestAnimationFrame(easeToTarget);
  }, [computeCenterTarget]);

  const slideRafRef = useRef(null);

  const animateSlide = useCallback((container) => {
    if (slideRafRef.current != null) {
      cancelAnimationFrame(slideRafRef.current);
      slideRafRef.current = null;
    }
    const step = () => {
      const el = centerFileIdRef.current ? itemRefs.current.get(centerFileIdRef.current) : null;
      if (!container || !el) {
        slideRafRef.current = null;
        return;
      }
      const target = computeCenterTarget(container, el);
      if (target == null) {
        slideRafRef.current = null;
        return;
      }
      const diff = target - container.scrollLeft;
      if (Math.abs(diff) < 0.5) {
        container.scrollLeft = target;
        slideRafRef.current = null;
        return;
      }
      // Instant jump for large distances (e.g., jumping from one end to the other).
      if (Math.abs(diff) > container.clientWidth * 0.5) {
        container.scrollLeft = target;
        slideRafRef.current = null;
        return;
      }
      container.scrollLeft += diff * 0.14;
      slideRafRef.current = requestAnimationFrame(step);
    };
    slideRafRef.current = requestAnimationFrame(step);
  }, [computeCenterTarget]);

  // Refs bridge the latest values into the centering helpers/effects WITHOUT
  // putting them in dependency arrays (their identities churn every render),
  // which is what used to re-trigger centering and yank the strip away.
  const currentFileIdRef = useRef(currentFileId);
  currentFileIdRef.current = currentFileId;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const easeToTargetRef = useRef(easeToTarget);
  easeToTargetRef.current = easeToTarget;
  const animateSlideRef = useRef(animateSlide);
  animateSlideRef.current = animateSlide;
  const computeCenterTargetRef = useRef(computeCenterTarget);
  computeCenterTargetRef.current = computeCenterTarget;
  const centerLockRef = useRef(lockEnabled);
  centerLockRef.current = lockEnabled;
  const recenterTimerRef = useRef(null);

  // Center the active item inside the viewport via animation. Returns a cleanup
  // that cancels all scheduled frames. Safe to call repeatedly (idle recenter,
  // on item open) — it just no-ops once the item is settled mid-center.
  const centerToActive = useCallback(() => {
    const currentId = currentFileIdRef.current;
    const container = scrollRef.current;
    if (!container || !currentId) return () => {};
    let retryRaf = null;
    let frames = 0;
    activeWindowedRef.current = false;
    centerFileIdRef.current = currentId;
    const computeTarget = () => {
      const cid = currentFileIdRef.current;
      if (frames++ > 100) { retryRaf = null; return; }
      if (dragRef.current != null) { retryRaf = requestAnimationFrame(computeTarget); return; }
      const cont = scrollRef.current;
      if (!cont || cont.clientWidth === 0) { retryRaf = requestAnimationFrame(computeTarget); return; }
      if (findActiveIndexRef.current() < 0) return; // active item not in this list — nothing to center
      const el = itemRefs.current.get(cid);
      if (!el) {
        // Not mounted yet (user scrolled away). Bring it into the window once,
        // then keep retrying until it mounts.
        if (!activeWindowedRef.current) {
          activeWindowedRef.current = true;
          recomputeWindowRef.current(true);
        }
        retryRaf = requestAnimationFrame(computeTarget);
        return;
      }
      const target = computeCenterTargetRef.current(cont, el);
      if (target == null) return;
      const cRect = cont.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      if (!(eRect.right > cRect.left && eRect.left < cRect.right)) {
        cont.scrollLeft = target;
        return;
      }
      if (slideRef.current) {
        animateSlideRef.current(cont);
      } else {
        const diff = target - cont.scrollLeft;
        if (Math.abs(diff) < 1) return;
        if (tweenRafRef.current == null) {
          tweenRafRef.current = requestAnimationFrame(easeToTargetRef.current);
        }
      }
    };
    const rafId = requestAnimationFrame(() => requestAnimationFrame(computeTarget));
    return () => {
      cancelAnimationFrame(rafId);
      if (retryRaf != null) cancelAnimationFrame(retryRaf);
      if (slideRafRef.current != null) cancelAnimationFrame(slideRafRef.current);
    };
  }, []);
  const centerToActiveRef = useRef(centerToActive);
  centerToActiveRef.current = centerToActive;

  // Center on OPEN / NAVIGATION — but only when the strip is LOCKED ("Ikuti").
  // With lock OFF ("Bebas") the strip never yanks itself back to the current
  // item: it stays exactly where you scrolled and you move it yourself. The very
  // first open always centers so the player's active item is in view. The 30s
  // idle, lock-gated re-center lives in handleScroll.
  useEffect(() => {
    const thisIsFirst = isFirstCenterRef.current;
    if (thisIsFirst) {
      isFirstCenterRef.current = false;
      if (restoreScrollKey) {
        try {
          const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
          const pos = parseFloat(saved);
          if (!isNaN(pos) && pos > 0) return; // let scroll restoration keep the position
        } catch {}
      }
    }
    if (!thisIsFirst && !centerLockRef.current) return;
    const cleanup = centerToActive();
    return cleanup;
  }, [currentFileId, isFirstCenterRef, restoreScrollKey, SCROLL_STORAGE_KEY, centerToActive]);

  useEffect(() => () => {
    if (recenterTimerRef.current) clearTimeout(recenterTimerRef.current);
    if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
  }, []);

  // Scroll restoration: on mount, restore the last scroll position from
  // localStorage so that a tab reload doesn't snap the carousel back to the
  // active item — which causes a long jump when the user was scrolled far away.
  // After restoring, if the active item is not visible, center it.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !restoreScrollKey) return;
    if (scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    try {
      const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
      if (saved != null) {
        const pos = parseFloat(saved);
        if (!isNaN(pos) && pos > 0) {
          container.scrollLeft = pos;
        }
      }
    } catch {}

    let retryRaf = null;
    let frames = 0;
    const tryCenter = () => {
      if (frames++ > 120) { retryRaf = null; return; }
      const el = currentFileId ? itemRefs.current.get(currentFileId) : null;
      if (!el || !container) {
        retryRaf = requestAnimationFrame(tryCenter);
        return;
      }
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const isVisible = eRect.right > cRect.left && eRect.left < cRect.right;
      if (!isVisible) {
        const target = computeCenterTarget(container, el);
        if (target != null) {
          container.scrollLeft = target;
        }
      }
      retryRaf = null;
    };
    retryRaf = requestAnimationFrame(tryCenter);
    return () => { if (retryRaf != null) cancelAnimationFrame(retryRaf); };
  }, [restoreScrollKey, SCROLL_STORAGE_KEY, currentFileId, computeCenterTarget]);

  // Persist scroll position to localStorage on unmount so it can be restored
  // on the next mount (e.g. after a tab reload).
  useEffect(() => {
    if (!restoreScrollKey) return;
    const container = scrollRef.current;
    if (!container) return;
    const save = () => {
      try {
        localStorage.setItem(SCROLL_STORAGE_KEY, String(container.scrollLeft));
      } catch {}
    };
    container.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      container.removeEventListener('scroll', save);
    };
  }, [restoreScrollKey, SCROLL_STORAGE_KEY]);

  // ---- Grab-to-scroll (mouse / pen). Touch keeps native pan-x scrolling so the
  // mobile feel is unchanged; this only fixes desktop drag (hidden scrollbar +
  // native image drag) and long-press. A real drag suppresses the item click.
  // NOTE: no setPointerCapture here — capturing the container retargets the
  // subsequent `click` event to the container, which would break item taps.
  // We listen on `window` during the drag instead.
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const stopAllTweens = useCallback(() => {
    if (tweenRafRef.current != null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
    if (slideRafRef.current != null) {
      cancelAnimationFrame(slideRafRef.current);
      slideRafRef.current = null;
    }
  }, []);

  const handlePointerMove = useCallback((e) => {
    const state = dragRef.current;
    const container = scrollRef.current;
    if (!state || !container || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    if (!state.moved && Math.abs(dx) > DRAG_THRESHOLD) state.moved = true;
    if (state.moved) container.scrollLeft = state.startScrollLeft - dx;
  }, []);

  const handlePointerEnd = useCallback((e) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.moved) suppressClickRef.current = true;
    dragRef.current = null;
    const container = scrollRef.current;
    if (container) container.classList.remove('cursor-grabbing');
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove]);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const container = scrollRef.current;
    if (!container) return;
    suppressClickRef.current = false;
    stopAllTweens();
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startScrollLeft: container.scrollLeft, moved: false };
    container.classList.add('cursor-grabbing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove, handlePointerEnd, stopAllTweens]);

  const handleClickCapture = useCallback((e) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }, []);

  const handleDragStart = useCallback((e) => { e.preventDefault(); }, []);
  const handleContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove, handlePointerEnd]);

  // Virtual mode renders from the repo even when the initial object window
  // (files prop) is still empty — the index alone defines the scroll length.
  if (!virtual && (!files || files.length < 1)) return null;

  const total = virtual ? virtualTotal : nodes.length;
  const start = Math.max(0, Math.min(win.start, total));
  const end = Math.max(start, Math.min(win.end, total));
  const leadingW = LEAD + prefix[start];
  const trailingW = (prefix[total] - prefix[end]) + TRAIL;
  const windowNodes = virtual
    ? (() => {
        const out = new Array(end - start);
        for (let k = start; k < end; k++) {
          const id = repo.idAt(k);
          out[k - start] = { type: 'item', id, index: k, file: id ? repo.get(id) : undefined };
        }
        return out;
      })()
    : nodes.slice(start, end);

  return (
    <div
      data-debug-id="1.1.9.1"
      data-debug-name="Carousel"
      data-debug-type="player"
      className="transition-all duration-300 ease-out"
    >
      <div className="bg-neutral-950/90 backdrop-blur-sm border-t border-white/10 px-2 pt-3 pb-1.5">
        <div
          ref={scrollRef}
          className={`flex overflow-x-auto items-stretch py-1 justify-start cursor-grab select-none`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
          onPointerDown={handlePointerDown}
          onClickCapture={handleClickCapture}
          onDragStart={handleDragStart}
          onContextMenu={handleContextMenu}
          onScroll={handleScroll}
        >
          {leadingW > 0 && <div aria-hidden="true" style={{ width: leadingW }} className="flex-shrink-0" />}
          {windowNodes.map((node, i) => {
            const nodeIdx = start + i;
            if (node.type === 'divider') {
              const key = node.folderName || node.label;
              if (node.folderName) {
                return (
                  <div key={`div-${nodeIdx}`} ref={setDividerRef(key)} data-folder="1" className="flex items-center flex-shrink-0 mx-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none">
                      <svg className="w-3 h-3 text-neutral-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      {node.folderName}
                    </div>
                  </div>
                );
              }
              return (
                <div key={`div-${nodeIdx}`} ref={setDividerRef(key)} className="flex items-center flex-shrink-0 mx-3">
                  <div className="px-2.5 py-0.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none bg-neutral-900 border border-neutral-700 rounded">
                    {node.label}
                  </div>
                </div>
              );
            }
            if (virtual && !node.file) {
              // Silently reserve the slot while the surrounding window hydrates.
              return (
                <div
                  key={`virt-${node.index}`}
                  className="flex-shrink-0 animate-pulse bg-neutral-900/60 rounded"
                  style={{ width: pitch, height: pitch, margin: 2 }}
                />
              );
            }
            return renderItem(node.file);
          })}
          {trailingW > 0 && <div aria-hidden="true" style={{ width: trailingW }} className="flex-shrink-0" />}
        </div>
      </div>
    </div>
  );
}

export default Carousel;
