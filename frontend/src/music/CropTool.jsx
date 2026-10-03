import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function CropTool({ imageUrl, title, onSave, onCancel }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const rafRef = useRef(null);

  const [containerSize, setContainerSize] = useState({ w: 400, h: 400 });
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [imgCss, setImgCss] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  const cropSize = Math.min(containerSize.w, containerSize.h);
  const centerX = (containerSize.w - imgCss.w) / 2;
  const centerY = (containerSize.h - imgCss.h) / 2;

  // Visual image position (accounts for transform-origin: center center)
  const imgVisualLeft = centerX + pan.x + (imgCss.w * (1 - zoom)) / 2;
  const imgVisualTop = centerY + pan.y + (imgCss.h * (1 - zoom)) / 2;
  const imgVisualW = imgCss.w * zoom;
  const imgVisualH = imgCss.h * zoom;

  // ── Resize observer ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setContainerSize({ w: Math.round(width), h: Math.round(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Image load ──
  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    setImgNatural({ w: nw, h: nh });

    const cw = containerRef.current?.clientWidth || 400;
    const ch = containerRef.current?.clientHeight || 400;
    const fit = Math.min(cw / nw, ch / nh);
    setImgCss({ w: Math.round(nw * fit), h: Math.round(nh * fit) });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgLoaded(true);
  }, []);

  // Reset state when imageUrl changes
  useEffect(() => {
    setImgLoaded(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgNatural({ w: 0, h: 0 });
    setImgCss({ w: 0, h: 0 });
  }, [imageUrl]);

  // Recalculate CSS size when container changes (but keep zoom/pan)
  useEffect(() => {
    if (!imgLoaded || imgNatural.w === 0) return;
    const cw = containerSize.w;
    const ch = containerSize.h;
    if (cw === 0 || ch === 0) return;
    const fit = Math.min(cw / imgNatural.w, ch / imgNatural.h);
    setImgCss({ w: Math.round(imgNatural.w * fit), h: Math.round(imgNatural.h * fit) });
  }, [containerSize, imgLoaded, imgNatural]);

  // ── Preview render via rAF ──
  const renderPreview = useCallback(() => {
    const pv = previewCanvasRef.current;
    if (!pv || !imgLoaded || imgNatural.w === 0) return;
    const pvSize = 240;

    const cropLeft = (containerSize.w - cropSize) / 2;
    const cropTop = (containerSize.h - cropSize) / 2;

    const srcX = (cropLeft - imgVisualLeft) / imgVisualW * imgNatural.w;
    const srcY = (cropTop - imgVisualTop) / imgVisualH * imgNatural.h;
    const srcW = cropSize / imgVisualW * imgNatural.w;
    const srcH = cropSize / imgVisualH * imgNatural.h;

    pv.width = pvSize;
    pv.height = pvSize;
    const ctx = pv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, pvSize, pvSize);
    try {
      ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, pvSize, pvSize);
    } catch (e) {
      // silently ignore (e.g. tainted canvas)
    }
  }, [containerSize, cropSize, imgVisualLeft, imgVisualTop, imgVisualW, imgVisualH, imgNatural, imgLoaded]);

  useEffect(() => {
    if (!imgLoaded) return;
    let running = true;
    const loop = () => {
      if (!running) return;
      renderPreview();
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [renderPreview, imgLoaded]);

  // ── Zoom via wheel ──
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(z => Math.max(1, Math.min(5, +(z + delta).toFixed(2))));
  }, []);

  // ── Pan via pointer ──
  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handlePointerUp = useCallback(() => setDragging(false), []);

  // ── Controls ──
  const handleZoomSlider = useCallback((e) => setZoom(parseFloat(e.target.value)), []);
  const handleReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const handleFit = useCallback(() => {
    // Fill the crop area
    if (imgCss.w === 0 || imgCss.h === 0 || cropSize === 0) return;
    const fill = Math.max(cropSize / imgCss.w, cropSize / imgCss.h);
    setZoom(Math.max(1, Math.min(5, +fill.toFixed(2))));
    setPan({ x: 0, y: 0 });
  }, [imgCss, cropSize]);

  // ── Save ──
  const handleSave = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    setSaving(true);

    const cropLeft = (containerSize.w - cropSize) / 2;
    const cropTop = (containerSize.h - cropSize) / 2;

    const srcX = (cropLeft - imgVisualLeft) / imgVisualW * imgNatural.w;
    const srcY = (cropTop - imgVisualTop) / imgVisualH * imgNatural.h;
    const srcW = cropSize / imgVisualW * imgNatural.w;
    const srcH = cropSize / imgVisualH * imgNatural.h;

    const outputSize = 600;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outputSize, outputSize);
    } catch (err) {
      console.error('[CropTool] drawImage error:', err);
      setSaving(false);
      return;
    }

    canvas.toBlob(async (blob) => {
      if (!blob) { setSaving(false); return; }
      try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Save timed out after 30s')), 30000));
        await Promise.race([onSave(blob), timeout]);
      } catch (err) {
        console.error('[CropTool] Save error:', err);
      } finally {
        setSaving(false);
      }
    }, 'image/jpeg', 0.95);
  }, [containerSize, cropSize, imgVisualLeft, imgVisualTop, imgVisualW, imgVisualH, imgNatural, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl m-4"
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-white font-semibold text-sm">Crop Cover</h2>
            <p className="text-xs text-white/40 truncate mt-0.5">{title || ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowGrid(g => !g)}
              className={`text-[10px] px-2.5 py-1 rounded-lg transition-colors ${showGrid ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}>
              Grid
            </button>
            <button onClick={onCancel} className="text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col md:flex-row gap-0 flex-1 min-h-0 overflow-y-auto">

          {/* ── Crop Area ── */}
          <div className="flex-1 flex items-center justify-center p-3 md:p-4 bg-neutral-950/50 min-w-0">
            <div
              ref={containerRef}
              className="relative w-full max-w-[75vh] aspect-square max-md:max-h-[55vh] rounded-xl overflow-hidden select-none bg-neutral-950"
              style={{ touchAction: 'none' }}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt=""
                crossOrigin="anonymous"
                onLoad={handleImgLoad}
                draggable={false}
                className="absolute pointer-events-none"
                style={{
                  left: 0,
                  top: 0,
                  width: imgCss.w || 'auto',
                  height: imgCss.h || 'auto',
                  transform: imgLoaded ? `translate(${centerX + pan.x}px, ${centerY + pan.y}px) scale(${zoom})` : 'none',
                  transformOrigin: 'center center',
                  imageRendering: 'auto',
                  willChange: 'transform',
                  opacity: imgLoaded ? 1 : 0,
                }}
              />

              {/* Dark overlay outside crop */}
              <div className="absolute inset-0 pointer-events-none"
                style={{
                  boxShadow: `inset 0 0 0 9999px rgba(0,0,0,0.55)`,
                  clipPath: `inset(${(containerSize.h - cropSize) / 2}px ${(containerSize.w - cropSize) / 2}px ${(containerSize.h - cropSize) / 2}px ${(containerSize.w - cropSize) / 2}px round 6px)`,
                }}
              />

              {/* Crop border */}
              <div className="absolute pointer-events-none"
                style={{
                  width: cropSize,
                  height: cropSize,
                  left: (containerSize.w - cropSize) / 2,
                  top: (containerSize.h - cropSize) / 2,
                  boxShadow: '0 0 0 2px rgba(255,255,255,0.85), 0 0 24px rgba(0,0,0,0.4)',
                  borderRadius: '8px',
                }}
              />

              {/* Grid */}
              {showGrid && cropSize > 60 && (
                <div className="absolute pointer-events-none"
                  style={{
                    width: cropSize,
                    height: cropSize,
                    left: (containerSize.w - cropSize) / 2,
                    top: (containerSize.h - cropSize) / 2,
                  }}>
                  <div className="absolute top-0 bottom-0 left-[33.33%] w-px bg-white/15" />
                  <div className="absolute top-0 bottom-0 left-[66.66%] w-px bg-white/15" />
                  <div className="absolute left-0 right-0 top-[33.33%] h-px bg-white/15" />
                  <div className="absolute left-0 right-0 top-[66.66%] h-px bg-white/15" />
                </div>
              )}

              {!dragging && imgLoaded && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none text-[10px] text-white/25 whitespace-nowrap">
                  Scroll zoom · Drag geser
                </div>
              )}
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="w-full md:w-[240px] shrink-0 flex flex-col gap-3 md:gap-4 p-3 md:p-4 md:border-l border-white/5 overflow-y-auto">

            {/* Preview */}
            <div>
              <p className="text-[10px] text-white/40 font-medium mb-2 text-center">Preview</p>
              <div className="rounded-xl overflow-hidden bg-neutral-950 border border-white/5 mx-auto w-[120px] h-[120px] sm:w-[160px] sm:h-[160px] md:w-[180px] md:h-[180px]">
                <canvas ref={previewCanvasRef} className="w-full h-full" />
              </div>
            </div>

            {/* Zoom slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-white/40 font-medium">Zoom</p>
                <span className="text-[10px] text-white/30">{zoom.toFixed(1)}×</span>
              </div>
              <input type="range" min="1" max="5" step="0.05" value={zoom}
                onChange={handleZoomSlider}
                className="w-full accent-purple-500 h-1" />
            </div>

            {/* Quick buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleReset}
                className="py-1.5 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors">
                Reset
              </button>
              <button onClick={handleFit}
                className="py-1.5 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors">
                Fit
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1 min-h-2" />

            {/* Action buttons */}
            <button onClick={onCancel}
              className="w-full py-2 rounded-lg border border-neutral-700 text-neutral-400 text-xs font-medium hover:text-white hover:bg-neutral-800 transition-colors">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving || !imgLoaded}
              className="w-full py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {saving ? (
                <><div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Menyimpan...</>
              ) : (
                'Simpan sebagai Cover'
              )}
            </button>

            <p className="text-[9px] text-white/15 text-center">600×600 · JPEG</p>
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
