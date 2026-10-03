import React, { useState, useEffect, useCallback, useRef } from 'react';
import usePlaybackStore from '../store/playbackStore';
import './MediaControls.css';

function LoopIcon({ loopMode }) {
  if (loopMode === 'one') return (
    <div className="relative">
    <svg className="w-5 h-5 text-[#8892E6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
    <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-[#8892E6] text-white rounded-full w-3 h-3 flex items-center justify-center">1</span>
    </div>
  );
  if (loopMode === 'all') return <svg className="w-5 h-5 text-[#8892E6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>;
  return <svg className="w-5 h-5 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
  <path d="M17 1l4 4-4 4" />
  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
  <path d="M7 23l-4-4 4-4" />
  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>;
}

export default function MediaControls({
  mediaRef,
  type = 'video',
  folderFiles = [],
  currentFile = null,
  onFileChange,
  onNext,
  onPrevious,
  onNextEnd,
  onPreviousEnd,
  playlistMode = false,
  repo = null,
  onSeek,
  onSeekStart,
  onSeekChange,
  visualizer = null,
}) {
  const {
    isPlaying: audioPlaying,
    togglePlay,
    play: audioPlay,
    pause: audioPause,
    setVideoPlaying,
    videoPlaying,
    next: storeNext,
    previous: storePrevious,
    shuffle: storeShuffle,
    loopMode: storeLoopMode,
    setShuffle,
    setLoopMode: storeSetLoopMode,
  } = usePlaybackStore();

  // Video and audio share this control surface but must NOT share the global
  // `isPlaying` flag — otherwise playing a vault video flips the audio player's
  // play state and makes the MiniPlayer (shared audio element) start a track on
  // its own. Use a dedicated `videoPlaying` slice for video.
  const isAudio = type === 'audio';
  const isPlaying = isAudio ? audioPlaying : videoPlaying;
  const doPlay = isAudio ? audioPlay : () => setVideoPlaying(true);
  const doPause = isAudio ? audioPause : () => setVideoPlaying(false);
  const shuffle = storeShuffle;
  const loopMode = storeLoopMode;
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(() => {
    try { return Math.round((mediaRef?.current?.volume ?? 0.8) * 100); } catch { return 80; }
  });
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const prevVolumeRef = useRef(80);
  const isSeekingRef = useRef(false);
  const volumeWrapRef = useRef(null);
  const stateRef = useRef({ shuffle, loopMode, folderFiles, currentFile, isPlaying, playlistMode });
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const rafRef = useRef(null);
  const progressBarRef = useRef(null);
  const progressFillRef = useRef(null);
  const currentTimeRef = useRef(null);
  const shuffleOrderRef = useRef([]);
  const shufflePosRef = useRef(0);

  // Reset shuffle order when the folder contents change (navigated to a different folder)
  useEffect(() => {
    shuffleOrderRef.current = [];
    shufflePosRef.current = 0;
  }, [folderFiles]);

  useEffect(() => {
    stateRef.current = { shuffle, loopMode, folderFiles, currentFile, isPlaying, playlistMode };
  }, [shuffle, loopMode, folderFiles, currentFile, isPlaying, mediaRef, playlistMode]);

  // Keep shuffle position in sync when the active file changes externally
  // (e.g. user clicks a different item in the carousel while shuffle is on).
  useEffect(() => {
    if (!shuffle || !shuffleOrderRef.current.length || !currentFile) return;
    const pos = shuffleOrderRef.current.findIndex(f => f.id === currentFile.id);
    if (pos >= 0) shufflePosRef.current = pos;
  }, [shuffle, currentFile?.id]);

  useEffect(() => {
    const media = mediaRef?.current;
    if (!media) return;
    const sync = () => {
      setVolume(Math.round((media.volume ?? 0.8) * 100));
      setIsMuted(media.muted);
    };
    media.addEventListener('volumechange', sync);
    sync();
    return () => media.removeEventListener('volumechange', sync);
  }, [mediaRef]);

  useEffect(() => {
    const media = mediaRef?.current;
    if (media) {
      const v = Math.round((media.volume ?? 0.8) * 100);
      setVolume(v);
      setIsMuted(media.muted);
      if (v > 0) prevVolumeRef.current = v;
    }
  }, [mediaRef]);

  // Push the current playback position into the progress UI (fill width, time
  // label, range value) WITHOUT any state or scheduling. Safe to call from both
  // the RAF loop and the native `timeupdate` event, and it guards against
  // NaN/Infinity durations (e.g. HLS/blob streams) that would otherwise pin the
  // bar at 0% or set an invalid range max.
  const syncProgressUI = useCallback((media) => {
    if (!media) return;
    const time = media.currentTime;
    const rawDur = media.duration;
    const dur = (Number.isFinite(rawDur) && rawDur > 0) ? rawDur : 0;

    if (progressFillRef.current && dur > 0) {
      progressFillRef.current.style.width = `${Math.min(100, (time / dur) * 100)}%`;
    }

    if (currentTimeRef.current) {
      const mins = Math.floor(time / 60);
      const secs = Math.floor(time % 60);
      currentTimeRef.current.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    if (progressBarRef.current) {
      progressBarRef.current.max = (Number.isFinite(dur) && dur > 0) ? dur : 0;
      progressBarRef.current.value = time;
    }
  }, []);

  const updateTime = useCallback(() => {
    const media = mediaRef.current;
    if (media && !isSeekingRef.current && !media.paused) {
      syncProgressUI(media);
    }
    // Always reschedule the next frame. Previously this returned early when
    // paused/seeking and the whole loop died on a transient pause, leaving the
    // bar frozen for good even after playback resumed.
    rafRef.current = requestAnimationFrame(updateTime);
  }, [mediaRef, syncProgressUI]);

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVolumeChange = useCallback((val) => {
    const media = mediaRef.current;
    if (!media) return;
    const v = Math.max(0, Math.min(100, val));
    media.volume = v / 100;
    media.muted = v === 0;
    setVolume(v);
    setIsMuted(v === 0);
    if (v > 0) prevVolumeRef.current = v;
  }, [mediaRef]);

  // Mouse-wheel volume control. Attached natively (non-passive) so we can
  // preventDefault and stop the page from scrolling while adjusting volume.
  useEffect(() => {
    const el = volumeWrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const media = mediaRef?.current;
      const current = media ? Math.round((media.volume ?? 0.8) * 100) : (volume || 80);
      const step = 5;
      const next = Math.max(0, Math.min(100, current - Math.sign(e.deltaY) * step));
      handleVolumeChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [handleVolumeChange, mediaRef, volume]);

    const toggleMute = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      if (isMuted || volume === 0) {
        const restore = prevVolumeRef.current || 80;
        media.volume = restore / 100;
        media.muted = false;
        setVolume(restore);
        setIsMuted(false);
      } else {
        prevVolumeRef.current = volume;
        media.volume = 0;
        media.muted = true;
        setVolume(0);
        setIsMuted(true);
      }
    }, [mediaRef, isMuted, volume]);

    const getVolumeIcon = (level, muted) => {
      if (muted || level === 0) {
        return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
        </svg>;
      }
      if (level < 33) {
        return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>;
      }
      return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>;
    };

    const skip = useCallback((seconds) => {
      const media = mediaRef.current;
      if (!media) return;
      media.currentTime += seconds;
      // Re-anchor the synced video (if any) right away so it follows the audio
      // jump without waiting for the throttled timeupdate round-trip — otherwise
      // the video visibly lags behind the audio on skip. onSeek is a no-op for
      // pure-audio playback and gated on play state for the video.
      if (onSeek) onSeek(media.currentTime);
      // Update the progress UI immediately. The RAF loop is stopped while
      // paused, so without this the bar would stay frozen after a seek.
      if (media.duration) {
        const dur = (Number.isFinite(media.duration) && media.duration > 0) ? media.duration : 0;
        if (progressFillRef.current && dur > 0) {
          progressFillRef.current.style.width = `${Math.min(100, (media.currentTime / dur) * 100)}%`;
        }
        if (currentTimeRef.current) {
          const mins = Math.floor(media.currentTime / 60);
          const secs = Math.floor(media.currentTime % 60);
          currentTimeRef.current.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        if (progressBarRef.current) progressBarRef.current.value = media.currentTime;
      }
    }, [mediaRef, onSeek]);

    const handleAdvance = useCallback((autoEnded = false, isManual = false) => {
      const { shuffle, loopMode, folderFiles, currentFile, playlistMode } = stateRef.current;
      if (!folderFiles.length || !currentFile) return false;
      const media = mediaRef.current;

      if (autoEnded && loopMode === 'one') {
        if (media) {
          media.currentTime = 0;
          media.play().catch(() => {});
          if (progressFillRef.current) {
            progressFillRef.current.style.width = '0%';
          }
          if (currentTimeRef.current) {
            currentTimeRef.current.textContent = '00:00';
          }
        }
        return true;
      }

      if (autoEnded && loopMode === 'off' && !isManual) {
        doPause();
        if (progressFillRef.current) {
          progressFillRef.current.style.width = '0%';
        }
        if (currentTimeRef.current) {
          currentTimeRef.current.textContent = '00:00';
        }
        if (progressBarRef.current) {
          progressBarRef.current.value = 0;
        }
        return false;
      }

      if (playlistMode) {
        storeNext();
        return true;
      }

      if (shuffle) {
        const order = shuffleOrderRef.current;
        if (order.length > 0) {
          let pos = shufflePosRef.current + 1;
          if (pos >= order.length) {
            if (loopMode === 'all' || isManual) {
              pos = 0;
            } else {
              return false;
            }
          }
          shufflePosRef.current = pos;
          onFileChange(order[pos]);
          return true;
        }
      }

      const curIdx = folderFiles.findIndex(f => f.id === currentFile.id);
      let nextIdx = curIdx + 1;

      if (nextIdx >= folderFiles.length) {
        if (loopMode === 'all' || isManual) {
          nextIdx = 0;
        } else {
          return false;
        }
      }

      onFileChange(folderFiles[nextIdx]);
      return true;
    }, [onFileChange, storeNext]);

    const handlePlayNext = useCallback(() => {
      if (onNext) return onNext();
      if (playlistMode) {
        storeNext();
        return;
      }
const repo = repoRef.current;
      const repoCur = stateRef.current.currentFile;
      // Only short-circuit through the repository when the current item is
      // actually resolvable in its index. If the index isn't loaded yet (or the
      // item lives outside the folder scope, e.g. search), fall through to the
      // array path so a press never silently no-ops or jumps to a wrapped end.
       if (repo && repoCur?.id && repo.findIndex(repoCur.id) >= 0) {
         const nid = stateRef.current.shuffle ? repo.shuffledNext(repoCur.id) : repo.nextId(repoCur.id);
         if (nid == null) {
           if (stateRef.current.shuffle) {
             const fallback = repo.nextId(repoCur.id);
             if (fallback == null) return;
             repo.prefetchWindow(repo.findIndex(fallback), 12);
             repo.getOrHydrate(fallback).then((obj) => {
               if (obj && onFileChange) onFileChange(obj);
             });
             return;
           }
           return;
         }
         repo.prefetchWindow(repo.findIndex(nid), 12);
         repo.getOrHydrate(nid).then((obj) => {
           if (obj && onFileChange) onFileChange(obj);
         });
         return;
       }
      if (mediaRef.current) mediaRef.current.pause();
      const { loopMode, folderFiles, currentFile } = stateRef.current;
      if (!folderFiles.length || !currentFile) return;
      const curIdx = folderFiles.findIndex(f => f.id === currentFile.id);
      if (curIdx >= folderFiles.length - 1 && onNextEnd && (loopMode === 'all' || usePlaybackStore.getState().loopMode === 'all')) {
        onNextEnd((firstNewItem) => {
          if (firstNewItem) {
            shuffleOrderRef.current = [...shuffleOrderRef.current, firstNewItem];
            onFileChange(firstNewItem);
          }
        });
        return;
      }
      handleAdvance(false, true);
    }, [handleAdvance, mediaRef, onNext, playlistMode, storeNext, onNextEnd]);

    const handlePlayPrevious = useCallback(async () => {
      if (onPrevious) return onPrevious();
      if (playlistMode) {
        storePrevious();
        return;
      }
      const repo = repoRef.current;
      const repoCur = stateRef.current.currentFile;
      // Same guard as next: only use the repo when the item is in its index.
       if (repo && repoCur?.id && repo.findIndex(repoCur.id) >= 0) {
         const pid = stateRef.current.shuffle ? repo.shuffledPrev(repoCur.id) : repo.prevId(repoCur.id);
         if (pid == null) {
           if (stateRef.current.shuffle) {
             const fallback = repo.prevId(repoCur.id);
             if (fallback == null) return;
             repo.prefetchWindow(repo.findIndex(fallback), 12);
             const obj = await repo.getOrHydrate(fallback);
             if (obj && onFileChange) onFileChange(obj);
             return;
           }
           return;
         }
         repo.prefetchWindow(repo.findIndex(pid), 12);
         const obj = await repo.getOrHydrate(pid);
         if (obj && onFileChange) onFileChange(obj);
         return;
       }
      if (mediaRef.current) mediaRef.current.pause();
      const { shuffle, loopMode, folderFiles, currentFile } = stateRef.current;
      if (!folderFiles.length || !currentFile) return;
      if (shuffle) {
        const order = shuffleOrderRef.current;
        if (order.length > 0) {
          let pos = shufflePosRef.current - 1;
          if (pos < 0) {
            if (loopMode === 'all') {
              pos = order.length - 1;
            } else {
              return;
            }
          }
          shufflePosRef.current = pos;
          onFileChange(order[pos]);
          return;
        }
      }

      const curIdx = folderFiles.findIndex(f => f.id === currentFile.id);
      let prevIdx = curIdx - 1;

      if (prevIdx < 0) {
        if (onPreviousEnd) {
          const fetched = await onPreviousEnd((newestPrevItem) => {
            if (newestPrevItem) {
              shuffleOrderRef.current = [newestPrevItem, ...shuffleOrderRef.current];
              onFileChange(newestPrevItem);
            }
          });
          if (fetched) return;
        }
        if (loopMode === 'all' || loopMode === 'one') {
          prevIdx = folderFiles.length - 1;
        } else {
          return;
        }
      }
      onFileChange(folderFiles[prevIdx]);
    }, [onFileChange, onPrevious, playlistMode, storePrevious, onPreviousEnd]);

    useEffect(() => {
      const media = mediaRef.current;
      if (!media) return;

      setCurrentTime(0);
      setDuration(0);
      doPause();
      if (currentTimeRef.current) currentTimeRef.current.textContent = '00:00';
      if (progressBarRef.current) progressBarRef.current.value = 0;
      if (progressFillRef.current) progressFillRef.current.style.width = '0%';

      const startLoop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateTime);
      };
      const stopLoop = () => {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      };

      const onPlay = () => { doPlay(); startLoop(); };
      const onPause = () => { doPause(); stopLoop(); };
      const onLoadedMetadata = () => setDuration(media.duration);
      const onDurationChange = () => setDuration(media.duration);
      const onSeeked = () => { if (!media.paused) startLoop(); };
const onEnded = () => {
        // Repository mode (vault): walk the whole index on the repo-advance,
        // matching the manual M/N keys, instead of handleAdvance's wrapped
        // `folderFiles` array (which previously cycled just the hydrated 1..100
        // pool). Loop "one" still replays via handleAdvance; loop "off" stops
        // at the true end of the folder.
        if (playlistMode || stateRef.current.loopMode === 'one') {
          handleAdvance(true);
          return;
        }
        const repo = repoRef.current;
        const cur = stateRef.current.currentFile;
        if (repo && cur?.id && repo.findIndex(cur.id) >= 0) {
          const wrapped = !stateRef.current.shuffle && (repo.findIndex(cur.id) + 1 >= repo.total());
          if (wrapped && stateRef.current.loopMode === 'off') {
            if (progressFillRef.current) progressFillRef.current.style.width = '0%';
            if (currentTimeRef.current) currentTimeRef.current.textContent = '00:00';
            if (progressBarRef.current) progressBarRef.current.value = 0;
            doPause();
            return;
          }
          const nid = stateRef.current.shuffle ? repo.shuffledNext(cur.id) : repo.nextId(cur.id);
          if (nid == null) return;
          repo.prefetchWindow(repo.findIndex(nid), 12);
          repo.getOrHydrate(nid).then((obj) => {
            if (obj && onFileChange) onFileChange(obj);
          });
          return;
        }
        handleAdvance(true);
      };
      // Native timeupdate fallback: the browser fires this ~4x/sec during
      // playback regardless of our RAF loop, so the bar keeps advancing even if
      // the RAF chain ever dies (or was killed before it started).
      const onTimeUpdate = () => { if (!isSeekingRef.current) syncProgressUI(media); };

      media.addEventListener('play', onPlay);
      media.addEventListener('pause', onPause);
      media.addEventListener('loadedmetadata', onLoadedMetadata);
      media.addEventListener('durationchange', onDurationChange);
      media.addEventListener('seeked', onSeeked);
      media.addEventListener('timeupdate', onTimeUpdate);
      // Only auto-advance/loop for video. Audio 'ended' is handled by the shared
      // playback store (App.jsx) to avoid double-advance on the music player.
      if (type === 'video') media.addEventListener('ended', onEnded);

      if (media.duration) setDuration(media.duration);
      if (!media.paused) { doPlay(); startLoop(); }

      return () => {
        stopLoop();
        media.removeEventListener('play', onPlay);
        media.removeEventListener('pause', onPause);
        media.removeEventListener('loadedmetadata', onLoadedMetadata);
        media.removeEventListener('durationchange', onDurationChange);
        media.removeEventListener('seeked', onSeeked);
        media.removeEventListener('timeupdate', onTimeUpdate);
        if (type === 'video') media.removeEventListener('ended', onEnded);
      };
    }, [mediaRef, handleAdvance, updateTime, syncProgressUI, currentFile?.id, type, onFileChange]);

    const handleSeekStart = () => {
      setIsSeeking(true);
      isSeekingRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (onSeekStart) onSeekStart();
    };

    const handleSeek = (e) => {
      const val = parseFloat(e.target.value);
      if (mediaRef.current) {
        mediaRef.current.currentTime = val;
      }
      if (onSeekChange) onSeekChange(val);
      const sdur = (Number.isFinite(duration) && duration > 0) ? duration : 0;
      if (progressFillRef.current && sdur > 0) {
        const percentage = ((val / sdur) * 100);
        progressFillRef.current.style.width = `${Math.min(100, percentage)}%`;
      }
      if (currentTimeRef.current) {
        const mins = Math.floor(val / 60);
        const secs = Math.floor(val % 60);
        currentTimeRef.current.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
    };

    const handleSeekEnd = (e) => {
      const val = parseFloat(e.target.value);
      if (onSeek) onSeek(val);
      setIsSeeking(false);
      isSeekingRef.current = false;
      if (stateRef.current.isPlaying) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateTime);
      }
    };

    // Toggle shuffle. In repository mode (vault) this flips a full-index
    // Fisher-Yates order in the repo; otherwise it shuffles the current list.
    // Shared by the on-screen button AND the B key so both stay in sync.
    const toggleShuffleMode = useCallback(() => {
      const newVal = !shuffle;
      const repo = repoRef.current;
      if (repo && currentFile?.id) {
        repo.setShuffle(newVal, currentFile.id);
      }
      if (newVal) {
        const list = [...(folderFiles || [])];
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
        const curIdx = list.findIndex(f => f.id === currentFile?.id);
        if (curIdx > 0) {
          const [cur] = list.splice(curIdx, 1);
          list.unshift(cur);
        }
        shuffleOrderRef.current = list;
        shufflePosRef.current = 0;
      } else {
        shuffleOrderRef.current = [];
        shufflePosRef.current = 0;
      }
      stateRef.current = { ...stateRef.current, shuffle: newVal };
      setShuffle(newVal);
    }, [shuffle, playlistMode, setShuffle, folderFiles, currentFile]);

    // Cycle loop mode off → all → one. Mirrors the on-screen loop button so the
    // J key and the button behave identically.
    const toggleLoopMode = useCallback(() => {
      const modes = ['off', 'all', 'one'];
      const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
      stateRef.current = { ...stateRef.current, loopMode: next };
      if (mediaRef.current) {
        // Do NOT use the element's native `loop` — native looping repeats the
        // media internally, never fires `ended`, and resets setSinkId to default.
        // App.jsx's `ended` handler does manual loop-one (which re-fires `play`
        // and re-applies the chosen output device).
        mediaRef.current.loop = false;
      }
      storeSetLoopMode(next);
    }, [loopMode, mediaRef, storeSetLoopMode]);

    // Listen for global keyboard bindings from App-level handler.
    // NOTE: this must live BEFORE the return statement — previously it was
    // placed after `return (...)`, making it unreachable dead code, so n/m
    // keys (and toggle-shuffle/skip) silently did nothing from this cluster.
    useEffect(() => {
      const handler = (e) => {
        if (e.type === 'global-media-next') {
          handlePlayNext();
        } else if (e.type === 'global-media-previous') {
          handlePlayPrevious();
        } else if (e.type === 'global-media-toggle-shuffle') {
          toggleShuffleMode();
        } else if (e.type === 'global-media-toggle-loop') {
          toggleLoopMode();
        } else if (e.type === 'global-media-skip-minus5') {
          if (mediaRef.current) mediaRef.current.currentTime = Math.max(0, mediaRef.current.currentTime - 5);
        } else if (e.type === 'global-media-skip-plus5') {
          if (mediaRef.current) mediaRef.current.currentTime = Math.min(mediaRef.current.duration || 0, mediaRef.current.currentTime + 5);
        }
      };
      const events = ['global-media-next', 'global-media-previous', 'global-media-toggle-shuffle', 'global-media-toggle-loop', 'global-media-skip-minus5', 'global-media-skip-plus5'];
      events.forEach((evt) => window.addEventListener(evt, handler));
      return () => events.forEach((evt) => window.removeEventListener(evt, handler));
    }, [handlePlayNext, handlePlayPrevious, toggleShuffleMode, toggleLoopMode, mediaRef]);

    const containerClasses = type === 'video'
      ? 'relative w-full px-4 pb-4 mt-2 transition-all duration-300'
      : 'relative w-full px-4 pb-6 mt-2';

    return (
      <div data-debug-id="1.1.9.5" data-debug-name="MediaControls" data-debug-type="player" className={containerClasses}>
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
      {visualizer && type === 'audio' && (
        <div className="relative w-full pointer-events-none" style={{ height: '28px', zIndex: 20 }}>
          {visualizer}
        </div>
      )}
      <div
      className="relative w-full h-1.5 bg-white/20 rounded-lg cursor-pointer"
      onMouseDown={handleSeekStart}
      onTouchStart={handleSeekStart}
      >
      <div ref={progressFillRef} className="absolute top-0 left-0 h-full rounded-lg" style={{ width: '0%', background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }} />
      <input
      ref={progressBarRef}
      type="range"
      min="0"
      max={(Number.isFinite(duration) && duration > 0) ? duration : 0}
      onChange={handleSeek}
      onMouseUp={handleSeekEnd}
      onTouchEnd={handleSeekEnd}
      className="absolute inset-0 w-full opacity-0 cursor-pointer"
      />
      </div>
      <div className="flex justify-between text-[10px] font-medium text-white/50 tracking-wider">
      <span ref={currentTimeRef}>00:00</span>
      <span>{formatTime(duration)}</span>
      </div>
      </div>

      <div className="bg-neutral-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-3 flex items-center relative shadow-2xl" style={{ minHeight: '80px' }}>
      <div className="flex items-center">
      <button
      onClick={toggleShuffleMode}
      className={`p-2 rounded-xl transition-all active:scale-90 ${shuffle ? 'text-[#8892E6]' : 'text-neutral-500 hover:text-neutral-300'}`}
      title="Shuffle"
      >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M16 3h5v5" />
      <path d="M4 20L21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
      </svg>
      </button>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 md:gap-6">
      <button onClick={handlePlayPrevious} className="p-2 text-white hover:bg-white/10 rounded-full transition-all active:scale-75 focus:outline-none focus:ring-0" tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M15 17l-5-5 5-5" />
      </svg>
      </button>

      <button onClick={() => skip(-5)} className="p-2 text-white hover:bg-white/10 rounded-full transition-all active:scale-75 focus:outline-none focus:ring-0" tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
      </svg>
      </button>

<button
  onClick={() => {
    const media = mediaRef?.current;
    if (media) {
      if (media.paused) {
        doPlay();
        media.play().catch(() => {});
      } else {
        doPause();
        media.pause();
      }
    } else {
      togglePlay();
    }
  }}
  className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-90 transition-all duration-200 focus:outline-none focus:ring-0"
  style={{ background: '#fff', color: '#000' }}
  tabIndex={-1}
  onMouseDown={(e) => e.preventDefault()}
  >
      {isPlaying ? (
        <svg key="pause" className="w-7 h-7 fill-current" viewBox="0 0 24 24">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
        </svg>
      ) : (
        <svg key="play" className="w-7 h-7 fill-current translate-x-0.5" viewBox="0 0 24 24">
        <path d="M5 3l14 9-14 9V3z" />
        </svg>
      )}
      </button>

      <button onClick={() => skip(5)} className="p-2 text-white hover:bg-white/10 rounded-full transition-all active:scale-75 focus:outline-none focus:ring-0" tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
      </svg>
      </button>

      <button onClick={handlePlayNext} className="p-2 text-white hover:bg-white/10 rounded-full transition-all active:scale-75 focus:outline-none focus:ring-0" tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M9 17l5-5-5-5" />
      </svg>
      </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
      <div ref={volumeWrapRef} className="relative hidden md:flex items-center" style={{ width: '120px' }}>
      <div
      className="absolute"
      style={{
        left: '40px',
        width: '80px',
        top: 'calc(50% - 3px)',
        opacity: showVolumeSlider ? 1 : 0,
        pointerEvents: showVolumeSlider ? 'auto' : 'none',
        transition: 'opacity 0.2s ease',
      }}
      >
      <div className="relative w-full h-1.5 flex items-center">
      <div className="absolute inset-0 flex items-center pointer-events-none">
      <div className="w-full h-full rounded-full overflow-hidden" style={{ background: '#262626' }}>
      <div
      className="h-full rounded-full transition-all duration-75"
      style={{ width: `${isMuted ? 0 : volume}%`, background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }}
      />
      </div>
      </div>
      <input
      type="range"
      min="0"
      max="100"
      value={isMuted ? 0 : volume}
      onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
      className="absolute inset-0 w-full opacity-0 cursor-pointer"
      title={`Volume: ${volume}%`}
      />
      </div>
      </div>
      <button
      onClick={() => setShowVolumeSlider(v => !v)}
      onContextMenu={(e) => {
        e.preventDefault();
        toggleMute();
      }}
      className={`relative z-10 p-2 rounded-xl transition-all active:scale-90 ${
        isMuted ? 'text-red-400' : 'text-neutral-400'
      }`}
      style={{
        transform: showVolumeSlider ? 'translateX(0)' : 'translateX(80px)',
        transition: 'transform 0.2s ease',
      }}
      title={`Volume: ${volume}% (right-click to ${isMuted ? 'unmute' : 'mute'})`}
      >
      {getVolumeIcon(volume, isMuted)}
      </button>
      </div>
      </div>

      <button
      onClick={toggleLoopMode}
      className="p-2 rounded-xl transition-all active:scale-90"
      title={`Loop: ${loopMode}`}
      >
      <LoopIcon loopMode={loopMode} />
</button>
      </div>
      </div>
      </div>
    );
}

