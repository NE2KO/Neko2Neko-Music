import { useState, useEffect, useRef, memo } from 'react';
import { Histogram } from '@homelab/sync-engine';
import './SyncOverlay.css';

let _coreRef = null;
let _audioRef = null;
let _mvRef = null;
let _bgRef = null;
let _engineStateRef = null;
let _videoOffsetRef = null;
let _rvfcStatusRef = { mv: 'UNSUPPORTED', bg: 'UNSUPPORTED' };
let _videoRemountCountRef = 0;
let _replayStateRef = { active: false, frameIndex: 0, totalFrames: 0, lastFrame: null, complete: false, startTime: 0 };
let _recordingStateRef = { enabled: false, bufferLength: 0, maxBuffer: 0 };
let _analyzerEvidenceRef = { mv: [], bg: [] };
let _decisionOutputRef = { mv: null, bg: null };

export function registerSyncCore(core) { _coreRef = core; }
export function registerAudioRef(ref) { _audioRef = ref; }
export function registerMvRef(ref) { _mvRef = ref; }
export function registerBgRef(ref) { _bgRef = ref; }
export function registerEngineStateRef(mv, bg) { _engineStateRef = { mv, bg }; }
export function registerVideoOffsetRef(ref) { _videoOffsetRef = ref; }
export function registerRvfcStatusRef(ref) { _rvfcStatusRef = ref; }
export function registerVideoRemountCount(count) { _videoRemountCountRef = count; }
export function registerReplayStateRef(ref) { _replayStateRef = ref || _replayStateRef; }
export function registerRecordingState(ref) { _recordingStateRef = ref || _recordingStateRef; }
export function registerAnalyzerEvidence(ref) { _analyzerEvidenceRef = ref || _analyzerEvidenceRef; }
export function registerDecisionOutput(ref) { _decisionOutputRef = ref || _decisionOutputRef; }

// ── Read-only surface registry accessors ────────────────────────────────────
// Other A/V surfaces (MiniPlayer BG, right-panel MV) feed these REAL counter-
// part timestamps into the triangle math instead of fabricated zeros. NaN when
// no counterpart is currently registered → engine reports hasTriangle:false.
// Registry entries are React ref objects (.current), matching Music.jsx usage:
// MV = CachedVideoPlayer handle (getCurrentTime), BG/audio = raw elements.
export function getRegisteredMvTime() {
  const v = _mvRef?.current ?? null;
  if (!v) return NaN;
  const t = v.getCurrentTime?.();
  if (Number.isFinite(t)) return t;
  const fb = v.currentTime;
  return Number.isFinite(fb) ? fb : NaN;
}
export function getRegisteredBgTime() {
  const v = _bgRef?.current ?? null;
  if (!v) return NaN;
  const t = v.currentTime;
  return Number.isFinite(t) ? t : NaN;
}
export function isRegisteredMv(ref) { return ref != null && _mvRef === ref; }
export function isRegisteredBg(ref) { return ref != null && _bgRef === ref; }

function driftColor(ms) {
  if (ms == null || !isFinite(ms)) return 'var(--so-text-muted)';
  const abs = Math.abs(ms);
  if (abs < 20) return 'var(--so-green)';
  if (abs < 50) return 'var(--so-yellow)';
  if (abs < 100) return 'var(--so-orange)';
  return 'var(--so-red)';
}

function fmtMs(val) {
  if (val == null || !isFinite(val)) return '\u2014';
  return Math.round(val);
}

function fmtVal(val, decimals = 0) {
  if (val == null || !isFinite(val)) return '\u2014';
  const f = 10 ** decimals;
  return String(Math.round(val * f) / f);
}

function healthColor(pct) {
  if (pct <= 5) return 'var(--so-green)';
  if (pct <= 15) return 'var(--so-yellow)';
  return 'var(--so-red)';
}

function badge(text, color = 'var(--so-text-muted)') {
  return <span className="so-badge" style={{ background: `${color}18`, color }}>{text}</span>;
}

function sectionTitle(text) {
  return <div className="so-section-title">{text}</div>;
}

function muted(text) {
  return <div className="so-muted">{text}</div>;
}

function TriangleDiagram({ audioMs, mvMs, bgMs, offsetMs, audioMvDrift, audioBgDrift, mvBgDrift, triangleConsistency }) {
  const W = 300, H = 150;
  const nodes = {
    audio: { x: 150, y: 18, label: 'AUDIO' },
    mv: { x: 28, y: 138, label: 'MV' },
    bg: { x: 272, y: 138, label: 'BG' },
  };
  const r = 10;
  const edge = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    return {
      x1: from.x + ux * (r + 2), y1: from.y + uy * (r + 2),
      x2: to.x - ux * (r + 4), y2: to.y - uy * (r + 4),
      mx: (from.x + to.x) / 2, my: (from.y + to.y) / 2,
    };
  };
  const e1 = edge(nodes.audio, nodes.mv);
  const e2 = edge(nodes.audio, nodes.bg);
  const e3 = edge(nodes.mv, nodes.bg);
  const dc = (ms) => {
    if (ms == null || !isFinite(ms)) return 'var(--so-text-muted)';
    const abs = Math.abs(ms);
    if (abs < 20) return 'var(--so-green)';
    if (abs < 50) return 'var(--so-yellow)';
    if (abs < 100) return 'var(--so-orange)';
    return 'var(--so-red)';
  };
  const markerId = (color) => {
    if (color === 'var(--so-green)') return 'arrow-g';
    if (color === 'var(--so-yellow)') return 'arrow-y';
    if (color === 'var(--so-orange)') return 'arrow-o';
    if (color === 'var(--so-red)') return 'arrow-r';
    return 'arrow-default';
  };
  const fmtDrift = (ms) => {
    if (ms == null || !isFinite(ms)) return '\u2014';
    const sign = ms > 0 ? '+' : '';
    return `${sign}${Math.round(ms)}`;
  };
  const m1 = markerId(dc(audioMvDrift));
  const m2 = markerId(dc(audioBgDrift));
  const m3 = markerId(dc(mvBgDrift));

  const centerY = 98;
  const centerX1 = 65;
  const centerX2 = 235;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="so-triangle">
      <defs>
        <marker id="arrow-default" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--so-text-muted)" /></marker>
        <marker id="arrow-g" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--so-green)" /></marker>
        <marker id="arrow-y" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--so-yellow)" /></marker>
        <marker id="arrow-o" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--so-orange)" /></marker>
        <marker id="arrow-r" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--so-red)" /></marker>
      </defs>
      <line x1={e1.x1} y1={e1.y1} x2={e1.x2} y2={e1.y2} stroke={dc(audioMvDrift)} strokeWidth="2" markerEnd={`url(#${m1})`} />
      <line x1={e2.x1} y1={e2.y1} x2={e2.x2} y2={e2.y2} stroke={dc(audioBgDrift)} strokeWidth="2" markerEnd={`url(#${m2})`} />
      <line x1={e3.x1} y1={e3.y1} x2={e3.x2} y2={e3.y2} stroke={dc(mvBgDrift)} strokeWidth="2" markerEnd={`url(#${m3})`} />
      <line x1={centerX1 + 5} y1={centerY} x2={centerX2 - 5} y2={centerY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <line x1={centerX1 + 5} y1={centerY} x2={centerX1} y2={centerY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" markerEnd="url(#arrow-default)" />
      <line x1={centerX2 - 5} y1={centerY} x2={centerX2} y2={centerY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" markerEnd="url(#arrow-default)" />
      <text x={e1.mx - 6} y={e1.my - 4} fill={dc(audioMvDrift)} fontSize="9" fontFamily="var(--so-mono)" fontWeight="700">{fmtDrift(audioMvDrift)}</text>
      <text x={e2.mx + 4} y={e2.my - 4} fill={dc(audioBgDrift)} fontSize="9" fontFamily="var(--so-mono)" fontWeight="700">{fmtDrift(audioBgDrift)}</text>
      <text x={e3.mx - 6} y={e3.my + 12} fill={dc(mvBgDrift)} fontSize="9" fontFamily="var(--so-mono)" fontWeight="700">{fmtDrift(mvBgDrift)}</text>
      {Object.entries(nodes).map(([key, n]) => {
        const stroke = key === 'audio' ? 'var(--so-purple)' : key === 'mv' ? 'var(--so-blue)' : 'var(--so-green)';
        return (
          <text key={key} x={n.x} y={n.y + 4} textAnchor="middle" fill={stroke} fontSize="10" fontWeight="700" fontFamily="var(--so-mono)">{n.label}</text>
        );
      })}
    </svg>
  );
}

function FpsMeter({ fps, label }) {
  const hasValue = fps != null && isFinite(fps);
  const pct = hasValue ? Math.min(100, Math.max(0, (fps / 60) * 100)) : 0;
  const color = hasValue ? (fps >= 55 ? 'var(--so-green)' : fps >= 30 ? 'var(--so-yellow)' : 'var(--so-red)') : 'var(--so-text-muted)';
  const status = hasValue ? (fps >= 55 ? 'GOOD' : fps >= 30 ? 'LOW' : 'BAD') : 'NO DATA';
  return (
    <div className="so-fps-item">
      <div className="so-fps-header">
        <span className="so-stat-label">{label}</span>
        <span className="so-fps-value" style={{ color }}>{hasValue ? `${Math.round(fps)}` : '\u2014'}</span>
      </div>
      <div className="so-fps-track">
        <div className="so-fps-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="so-fps-status">{status}</div>
    </div>
  );
}

function DriftGraph({ history, colorFn, label }) {
  if (!Array.isArray(history) || history.length === 0) {
    return <span className="so-muted">no data</span>;
  }
  const maxAbs = Math.max(1, ...history.map(v => Math.abs(v ?? 0)));
  const current = history[history.length - 1];
  const color = colorFn ? colorFn(current) : driftColor(current);
  const pct = (Math.abs(current) / maxAbs) * 50;
  const side = current >= 0 ? 'right' : 'left';

  return (
    <div className="so-drift-row">
      <span className="so-drift-label">{label}</span>
      <div className="so-drift-track">
        <div className="so-drift-center" />
        <div className={`so-drift-fill so-drift-${side}`} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="so-drift-value" style={{ color }}>{fmtMs(current)}ms</span>
    </div>
  );
}

function HistogramDisplay({ histogram }) {
  if (!histogram || histogram.total === 0) return <div className="so-muted">No data</div>;
  const normalized = histogram.getNormalized();
  const maxRatio = Math.max(0.001, ...normalized);
  return (
    <div className="so-hist">
      {Histogram.BINS.map((bin, i) => {
        const ratio = normalized[i] || 0;
        const pct = Math.round(ratio * 100);
        const width = Math.round((ratio / maxRatio) * 100);
        const color = ratio > 0.3 ? 'var(--so-green)' : ratio > 0.1 ? 'var(--so-yellow)' : 'var(--so-text-faint)';
        return (
          <div key={bin.label} className="so-hist-row">
            <span className="so-hist-label">{bin.label}</span>
            <div className="so-hist-track">
              <div className="so-hist-fill" style={{ width: `${width}%`, background: color }} />
            </div>
            <span className="so-hist-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function ComparisonRow({ label, mvValue, bgValue, mvColor, bgColor, mono = true }) {
  return (
    <div className="so-compare-row">
      <span className="so-compare-label">{label}</span>
      <span className="so-compare-value" style={{ color: mvColor || 'var(--so-text)', fontVariantNumeric: mono ? 'tabular-nums' : 'inherit' }}>{mvValue ?? '\u2014'}</span>
      <span className="so-compare-value" style={{ color: bgColor || 'var(--so-text)', fontVariantNumeric: mono ? 'tabular-nums' : 'inherit' }}>{bgValue ?? '\u2014'}</span>
    </div>
  );
}

const SyncOverlay = memo(function SyncOverlay({ onClose }) {
  const [, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  const [driftHistoryMv, setDriftHistoryMv] = useState([]);
  const [driftHistoryBg, setDriftHistoryBg] = useState([]);
  const rafFpsRef = useRef({ lastTime: 0, ema: 0, fps: 0 });

  useEffect(() => {
    let rafId;
    const rafLoop = (now) => {
      const r = rafFpsRef.current;
      if (r.lastTime > 0) {
        const dt = now - r.lastTime;
        if (dt > 0) {
          const instant = 1000 / dt;
          r.ema = r.ema === 0 ? instant : r.ema * 0.9 + instant * 0.1;
          r.fps = Math.round(r.ema);
        }
      }
      r.lastTime = now;
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    const id = setInterval(() => {
      const debug = window.__SYNC_DEBUG === true || localStorage.syncDebug === 'true';
      setVisible(debug);
      if (!debug || !_coreRef) { setTick(t => t + 1); return; }

      const mvStats = _coreRef.getStats('mv');
      const bgStats = _coreRef.getStats('bg');
      if (mvStats) {
        setDriftHistoryMv(prev => {
          const next = [...prev, mvStats.rawDrift];
          return next.length > 56 ? next.slice(-56) : next;
        });
      }
      if (bgStats) {
        setDriftHistoryBg(prev => {
          const next = [...prev, bgStats.rawDrift];
          return next.length > 56 ? next.slice(-56) : next;
        });
      }
      setTick(t => t + 1);
    }, 100);
    return () => { clearInterval(id); cancelAnimationFrame(rafId); };
  }, []);

  const handleClose = () => {
    window.__SYNC_DEBUG = false;
    try { localStorage.syncDebug = 'false'; } catch {}
    if (onClose) onClose();
  };

  if (!visible || !_coreRef) return null;

  const mv = _coreRef.getStats('mv');
  const bg = _coreRef.getStats('bg');
  const mvState = _engineStateRef?.mv;
  const bgState = _engineStateRef?.bg;
  const audioMs = Math.round((_audioRef?.current?.currentTime ?? 0) * 1000);
  const mvMs = Math.round((_mvRef?.current?.getCurrentTime?.() ?? 0) * 1000);
  const bgMs = Math.round((_bgRef?.current?.currentTime ?? 0) * 1000);
  const offsetMs = Math.round((_videoOffsetRef?.current ?? 0) * 1000);
  const audioMvDrift = mvMs - (audioMs + offsetMs);
  const audioBgDrift = bgMs - (audioMs + offsetMs);
  const mvBgDrift = bgMs - mvMs;
  const mvSynced = Math.abs(audioMvDrift) <= 10;
  const bgSynced = Math.abs(audioBgDrift) <= 10;
  const overallSynced = mvSynced && bgSynced;
  const rafFps = rafFpsRef.current.fps;
  const mvFpsVal = mv?.stats?.fps?.current;
  const bgFpsVal = bg?.stats?.fps?.current;
  const tickAvg = mv?.stats?.tickDelta?.avg;
  const tickHz = tickAvg > 0 ? (1000 / tickAvg) : null;
  const totalTick = (mv?.tickCount ?? 0) + (bg?.tickCount ?? 0);
  const totalMiss = (mv?.tickMissCount ?? 0) + (bg?.tickMissCount ?? 0);
  const missPct = totalTick > 0 ? Math.round(totalMiss / totalTick * 100) : 0;
  const mvReStab = _coreRef.getReStabilitySummary?.('mv');
  const bgReStab = _coreRef.getReStabilitySummary?.('bg');
  const mvClockProv = _coreRef.getClockProvenance?.('mv');
  const bgClockProv = _coreRef.getClockProvenance?.('bg');
  const mvSpikes = (_coreRef.getSpikeRecorder?.('mv') || []).slice(-5).reverse();
  const bgSpikes = (_coreRef.getSpikeRecorder?.('bg') || []).slice(-5).reverse();
  const mvSeekPipeline = _coreRef.getSeekPipelineLatencies?.('mv') || [];
  const bgSeekPipeline = _coreRef.getSeekPipelineLatencies?.('bg') || [];
  const mvDecision = _decisionOutputRef.mv;
  const bgDecision = _decisionOutputRef.bg;
  const mvEvidences = _analyzerEvidenceRef.mv || [];
  const bgEvidences = _analyzerEvidenceRef.bg || [];
  const mvSeekTele = mv?.seekTelemetry;
  const bgSeekTele = bg?.seekTelemetry;

  const triangleConsistency = (() => {
    const expectedMvBg = audioBgDrift - audioMvDrift;
    const error = Math.abs(mvBgDrift - expectedMvBg);
    const maxDrift = Math.max(Math.abs(audioMvDrift), Math.abs(audioBgDrift), Math.abs(mvBgDrift));
    const score = Math.max(0, Math.min(1, 1 - error / 200)) * Math.max(0.3, 1 - maxDrift / 500);
    const absDrifts = [
      { node: 'MV', drift: Math.abs(audioMvDrift), raw: audioMvDrift },
      { node: 'BG', drift: Math.abs(audioBgDrift), raw: audioBgDrift },
    ];
    absDrifts.sort((a, b) => b.drift - a.drift);
    const outlier = absDrifts[0].drift > 40 ? absDrifts[0].node : null;
    return { score: Math.round(score * 100), outlier, maxDrift: absDrifts[0].drift, maxDriftNode: absDrifts[0].node };
  })();

  return (
    <>
      <div className="so-panel so-panel-left">
        <div className="so-panel-header">
          <span>SYNC DEBUG</span>
          <button className="so-close" onClick={handleClose} title="Close">&times;</button>
        </div>

        <div className="so-section">
          <TriangleDiagram
            audioMs={audioMs}
            mvMs={mvMs}
            bgMs={bgMs}
            offsetMs={offsetMs}
            audioMvDrift={audioMvDrift}
            audioBgDrift={audioBgDrift}
            mvBgDrift={mvBgDrift}
            triangleConsistency={triangleConsistency}
          />
        </div>

        <div className="so-section">
          {sectionTitle('STATUS')}
          <div className="so-status-grid">
            <div className="so-status-card">
              <div className="so-status-top">
                {badge(mv?.stable ? 'LOCKED' : 'DRIFT', mv?.stable ? 'var(--so-green)' : 'var(--so-red)')}
                <span className="so-status-mode">{mvState?.mode ?? '\u2014'}</span>
              </div>
              <div className="so-compact-grid">
                <span className="so-compact-label">Drift</span>
                <span className="so-compact-value" style={{ color: driftColor(mv?.rawDrift) }}>{fmtMs(mv?.rawDrift)}ms</span>
                <span className="so-compact-label">Corrected</span>
                <span className="so-compact-value" style={{ color: driftColor(mv?.correctedDrift) }}>{fmtMs(mv?.correctedDrift)}ms</span>
                <span className="so-compact-label">Soft</span>
                <span className="so-compact-value">{fmtMs(mv?.thresholds?.soft * 1000)}ms</span>
                <span className="so-compact-label">Hard</span>
                <span className="so-compact-value">{fmtMs(mv?.thresholds?.hard * 1000)}ms</span>
              </div>
            </div>
            <div className="so-status-card">
              <div className="so-status-top">
                {badge(bg?.stable ? 'LOCKED' : 'DRIFT', bg?.stable ? 'var(--so-green)' : 'var(--so-red)')}
                <span className="so-status-mode">{bgState?.mode ?? '\u2014'}</span>
              </div>
              <div className="so-compact-grid">
                <span className="so-compact-label">Drift</span>
                <span className="so-compact-value" style={{ color: driftColor(bg?.rawDrift) }}>{fmtMs(bg?.rawDrift)}ms</span>
                <span className="so-compact-label">Corrected</span>
                <span className="so-compact-value" style={{ color: driftColor(bg?.correctedDrift) }}>{fmtMs(bg?.correctedDrift)}ms</span>
                <span className="so-compact-label">Soft</span>
                <span className="so-compact-value">{fmtMs(bg?.thresholds?.soft * 1000)}ms</span>
                <span className="so-compact-label">Hard</span>
                <span className="so-compact-value">{fmtMs(bg?.thresholds?.hard * 1000)}ms</span>
              </div>
            </div>
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('PERFORMANCE')}
          <div className="so-perf-compact">
            <div className="so-perf-item">
              <span className="so-perf-label">Sync</span>
              {badge(overallSynced ? 'SYNCED' : 'DESYNC', overallSynced ? 'var(--so-green)' : 'var(--so-red)')}
            </div>
            <div className="so-perf-item">
              <span className="so-perf-label">RAF</span>
              <span className="so-perf-value" style={{ color: rafFps < 30 ? 'var(--so-red)' : 'var(--so-text)' }}>{rafFps} FPS</span>
            </div>
            <div className="so-perf-item">
              <span className="so-perf-label">Tick</span>
              <span className="so-perf-value">{tickHz != null ? `${fmtVal(tickHz, 1)} Hz` : '\u2014'}</span>
            </div>
            <div className="so-perf-item">
              <span className="so-perf-label">Dt</span>
              <span className="so-perf-value">{mv?.stats?.tickDelta?.current != null ? `${fmtMs(mv.stats.tickDelta.current)}ms` : '\u2014'}</span>
            </div>
            <div className="so-perf-item">
              <span className="so-perf-label">Sched</span>
              <span className="so-perf-value">{mv?.stats?.tickDelta?.avg != null ? `${fmtVal(mv.stats.tickDelta.avg, 0)}ms` : '\u2014'}</span>
            </div>
            <div className="so-perf-item">
              <span className="so-perf-label">Miss</span>
              <span className="so-perf-value" style={{ color: healthColor(missPct) }}>{totalTick > 0 ? `${missPct}%` : '\u2014'}</span>
            </div>
          </div>
          <div className="so-fps-compact">
            <FpsMeter fps={mvFpsVal} label="MV" />
            <FpsMeter fps={bgFpsVal} label="BG" />
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('HEALTH')}
          <div className="so-compact-grid">
            <span className="so-compact-label">Lock</span>
            <span className="so-compact-value">{mv?.decisions?.lock ?? 0}/{bg?.decisions?.lock ?? 0} ({mv?.decisions?.lockPct ?? 0}%)</span>
            <span className="so-compact-label">Stall</span>
            <span className="so-compact-value" style={{ color: ((mv?.schedulerStallCount ?? 0) + (bg?.schedulerStallCount ?? 0)) > 0 ? 'var(--so-red)' : 'var(--so-green)' }}>
              {(mv?.schedulerStallCount ?? 0) + (bg?.schedulerStallCount ?? 0)}
            </span>
            <span className="so-compact-label">CPU</span>
            <span className="so-compact-value" style={{ color: (mvState?.cpuOverloaded || bgState?.cpuOverloaded) ? 'var(--so-red)' : 'var(--so-green)' }}>
              {(mvState?.cpuOverloaded || bgState?.cpuOverloaded) ? 'ON' : 'OFF'}
            </span>
            <span className="so-compact-label">Tick Miss</span>
            <span className="so-compact-value" style={{ color: healthColor(missPct) }}>{totalMiss} / {totalTick}</span>
            <span className="so-compact-label">Futile</span>
            <span className="so-compact-value" style={{ color: ((mv?.decisions?.futile ?? 0) + (bg?.decisions?.futile ?? 0)) > 0 ? 'var(--so-orange)' : 'var(--so-green)' }}>
              {(mv?.decisions?.futile ?? 0) + (bg?.decisions?.futile ?? 0)}
            </span>
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('RE-STABILITY')}
          <div className="so-compact-grid">
            {['mv', 'bg'].map(eng => {
              const s = eng === 'mv' ? mvReStab : bgReStab;
              const cur = s?.current;
              return (
                <div key={eng} className="so-restab-mini">
                  <span className="so-restab-engine" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</span>
                  <span className="so-restab-value">{cur?.trigger ?? '\u2014'}</span>
                  <span className="so-restab-value" style={{ color: (cur?.disruptions?.length ?? 0) > 0 ? 'var(--so-yellow)' : 'var(--so-text)' }}>
                    {cur?.startTime ? `${fmtMs(performance.now() - cur.startTime)}ms` : '\u2014'}
                  </span>
                  <span className="so-restab-value" style={{ color: (cur?.disruptions?.length ?? 0) > 0 ? 'var(--so-red)' : 'var(--so-green)' }}>
                    {(cur?.disruptions?.length ?? 0)}
                  </span>
                  <span className="so-restab-value">{s?.total ?? 0}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('CLOCK')}
          <div className="so-clock-compact">
            {['mv', 'bg'].map(eng => {
              const ring = eng === 'mv' ? mvClockProv?.ring : bgClockProv?.ring;
              const entries = ring?.slice(-3).reverse() || [];
              return (
                <div key={eng} className="so-clock-col">
                  <div className="so-clock-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  {entries.map((s, i) => {
                    const aD = s.audioDeltaMs != null ? `${s.audioDeltaMs >= 0 ? '+' : ''}${s.audioDeltaMs.toFixed(0)}` : '\u2014';
                    const vD = s.videoDeltaMs != null ? `${s.videoDeltaMs >= 0 ? '+' : ''}${s.videoDeltaMs.toFixed(0)}` : '\u2014';
                    const pD = s.perfDeltaMs != null ? `${s.perfDeltaMs.toFixed(0)}` : '\u2014';
                    return (
                      <div key={i} className="so-clock-row-compact">
                        <span className="so-clock-time">{i === 0 ? 'now' : `-${i * 30}ms`}</span>
                        <span className="so-clock-val" style={{ color: Math.abs(s.audioDeltaMs ?? 0) > 30 ? 'var(--so-red)' : 'var(--so-text)' }}>{aD}</span>
                        <span className="so-clock-val" style={{ color: Math.abs(s.videoDeltaMs ?? 0) > 30 ? 'var(--so-yellow)' : 'var(--so-text)' }}>{vD}</span>
                        <span className="so-clock-val" style={{ color: (s.perfDeltaMs ?? 0) > 50 ? 'var(--so-red)' : 'var(--so-text)' }}>{pD}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="so-panel so-panel-right">
        <div className="so-panel-header">
          <span>DECISIONS</span>
        </div>

        <div className="so-section">
          <div className="so-compact-grid">
            {['mv', 'bg'].map(eng => {
              const decision = eng === 'mv' ? mvDecision : bgDecision;
              const counts = (eng === 'mv' ? mv : bg)?.decisions || {};
              const items = [
                { label: 'LOCK', val: counts.lock ?? 0, color: 'var(--so-green)' },
                { label: 'RATE', val: counts.rate ?? 0, color: 'var(--so-blue)' },
                { label: 'HARD', val: counts.hard ?? 0, color: 'var(--so-red)' },
                { label: 'NOOP', val: counts.noop ?? 0, color: 'var(--so-text-muted)' },
                { label: 'FUTL', val: counts.futile ?? 0, color: 'var(--so-orange)' },
              ];
              return (
                <div key={eng} className="so-decision-col">
                  <div className="so-decision-col-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  <div className="so-decision-chips">
                    {items.map(d => (
                      <span key={d.label} className="so-decision-chip" style={{ color: d.color, borderColor: `${d.color}40` }}>
                        <span className="so-decision-chip-label">{d.label}</span>
                        <span className="so-decision-chip-value">{d.val}</span>
                      </span>
                    ))}
                  </div>
                  <div className="so-decision-meta">
                    <span>Lock <b style={{ color: 'var(--so-text)' }}>{counts.lockPct ?? 0}%</b></span>
                    <span>Eff <b style={{ color: 'var(--so-text)' }}>{counts.lock ?? 0}</b></span>
                  </div>
                  <div className="so-judge-row">
                    <span className="so-judge-label">Judge</span>
                    {badge(decision?.actionRequest?.type?.toUpperCase() || '\u2014', decision?.actionRequest?.type === 'hardSeek' ? 'var(--so-red)' : decision?.actionRequest?.type === 'hold' ? 'var(--so-text-muted)' : 'var(--so-green)')}
                    <span className="so-judge-conf">{Math.round((decision?.decisionConfidence || 0) * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('CONFIDENCE')}
          <div className="so-compact-grid">
            {['mv', 'bg'].map(eng => {
              const st = eng === 'mv' ? mv : bg;
              const blocked = st?.confidenceBlockedBy ?? 'decoder';
              const metrics = [
                { label: 'Op', val: st?.compositeConfidence ?? 0, max: 30 },
                { label: 'Bias', val: st?.biasConfidence ?? 0, max: 10 },
                { label: 'Dec', val: st?.decoderConfidence ?? 0, max: 30 },
                { label: 'Rend', val: st?.renderConfidence ?? 0, max: 30 },
                { label: 'Sched', val: st?.schedulerConfidence ?? 0, max: 30 },
                { label: 'Clk', val: st?.clockConfidence ?? 0, max: 30 },
              ];
              return (
                <div key={eng} className="so-conf-col">
                  <div className="so-conf-col-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  <div className="so-conf-bars-compact">
                    {metrics.map(m => {
                      const pct = Math.min(100, Math.round((m.val / m.max) * 100));
                      const color = pct >= 70 ? 'var(--so-green)' : pct >= 40 ? 'var(--so-yellow)' : 'var(--so-red)';
                      return (
                        <div key={m.label} className="so-conf-row-compact">
                          <span className="so-conf-label">{m.label}</span>
                          <div className="so-conf-track">
                            <div className="so-conf-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <span className="so-conf-pct">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="so-conf-blocked">Blocked: {blocked}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('EXECUTED SEEKS')}
          <div className="so-compact-grid">
            {['mv', 'bg'].map(eng => {
              const st = eng === 'mv' ? mvSeekTele : bgSeekTele;
              const hard = st?.hard;
              const soft = st?.soft;
              const hasData = (hard?.count ?? 0) > 0 || (soft?.count ?? 0) > 0;
              return (
                <div key={eng} className="so-seek-mini">
                  <div className="so-seek-mini-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  {hasData ? (
                    <div className="so-seek-mini-rows">
                      <div className="so-seek-mini-row">
                        <span className="so-seek-mini-label">Hard</span>
                        <span className="so-seek-mini-value" style={{ color: 'var(--so-red)' }}>
                          {hard.count} <span style={{ color: 'var(--so-text-muted)', fontWeight: 400 }}>({hard.avgDrift}ms)</span>
                        </span>
                      </div>
                      <div className="so-seek-mini-row">
                        <span className="so-seek-mini-label">Soft</span>
                        <span className="so-seek-mini-value" style={{ color: 'var(--so-yellow)' }}>
                          {soft.count} <span style={{ color: 'var(--so-text-muted)', fontWeight: 400 }}>({soft.avgDrift}ms)</span>
                        </span>
                      </div>
                    </div>
                  ) : muted('No seeks')}
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('PIPELINE')}
          <div className="so-pipeline-compact">
            {['mv', 'bg'].map(eng => {
              const evidences = eng === 'mv' ? mvEvidences : bgEvidences;
              const decision = eng === 'mv' ? mvDecision : bgDecision;
              return (
                <div key={eng} className="so-pipe-compact">
                  <div className="so-pipe-compact-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  <div className="so-pipe-evidence-compact">
                    {evidences.length ? evidences.slice(-2).map((ev, i) => {
                      const c = ev.confidence >= 0.7 ? 'var(--so-green)' : ev.confidence >= 0.4 ? 'var(--so-yellow)' : 'var(--so-red)';
                      return (
                        <div key={i} className="so-pipe-ev-compact">
                          <span className="so-pipe-ev-name" title={ev.analyzerId}>{ev.analyzerId}</span>
                          <span className="so-pipe-ev-conf" style={{ color: c }}>{Math.round(ev.confidence * 100)}%</span>
                        </div>
                      );
                    }) : <div className="so-muted">no evidence</div>}
                  </div>
                  <div className="so-pipe-flow">
                    <span>input</span>
                    <span className="so-pipe-flow-arrow">→</span>
                    <span>judge</span>
                    <span className="so-pipe-flow-arrow">→</span>
                    <span>action</span>
                  </div>
                  <div className="so-pipe-judge-compact">
                    {decision ? (
                      <>
                        {badge(decision.actionRequest?.type?.toUpperCase() || '\u2014', decision.actionRequest?.type === 'hardSeek' ? 'var(--so-red)' : decision.actionRequest?.type === 'hold' ? 'var(--so-text-muted)' : 'var(--so-green)')}
                        <span className="so-pipe-conf">{Math.round((decision.decisionConfidence || 0) * 100)}%</span>
                      </>
                    ) : muted('waiting')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('SEEK PIPELINE')}
          <div className="so-compact-grid">
            {['mv', 'bg'].map(eng => {
              const pipes = eng === 'mv' ? mvSeekPipeline : bgSeekPipeline;
              const last = pipes?.slice(-1)[0];
              return (
                <div key={eng} className="so-seekpipe-mini">
                  <div className="so-seekpipe-mini-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  {last ? (
                    <div className="so-seekpipe-mini-rows">
                      <ComparisonRow label="Seeked" mvValue={`${fmtMs(last.seekStartToSeeked)}ms`} bgValue={null} mvColor={last.seekStartToSeeked > 50 ? 'var(--so-red)' : 'var(--so-green)'} />
                      <ComparisonRow label="1st Frame" mvValue={last.seekToFirstFrameMs != null ? `${fmtMs(last.seekToFirstFrameMs)}ms` : '\u2014'} bgValue={null} mvColor={last.seekToFirstFrameMs > 100 ? 'var(--so-red)' : 'var(--so-yellow)'} />
                      <ComparisonRow label="Stable" mvValue={last.decodeStableMs != null ? `${fmtMs(last.decodeStableMs)}ms` : '\u2014'} bgValue={null} mvColor={last.decodeStableMs > 300 ? 'var(--so-red)' : 'var(--so-yellow)'} />
                      <ComparisonRow label="Total" mvValue={`${fmtMs(last.totalToStable)}ms`} bgValue={null} mvColor={last.totalToStable > 100 ? 'var(--so-red)' : 'var(--so-text)'} />
                    </div>
                  ) : muted('No seek data')}
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('SPIKES')}
          <div className="so-spikes-compact">
            {['mv', 'bg'].map(eng => {
              const spikes = eng === 'mv' ? mvSpikes : bgSpikes;
              return (
                <div key={eng} className="so-spike-col">
                  <div className="so-spike-col-header" style={{ color: eng === 'mv' ? 'var(--so-blue)' : 'var(--so-green)' }}>{eng.toUpperCase()}</div>
                  <div className="so-spike-list-compact">
                    {spikes.length ? spikes.slice(0, 4).map((sp, i) => {
                      const c = sp.attribution?.cause ?? 'UNKNOWN';
                      const badgeColor = c === 'SEEK_COMPLETE' ? 'var(--so-green)' :
                        c === 'SEEK_LATENCY' ? 'var(--so-orange)' :
                        c === 'SCHEDULER' ? 'var(--so-red)' :
                        c === 'DECODER' ? 'var(--so-yellow)' :
                        c === 'CLOCK_AUDIO' ? 'var(--so-blue)' :
                        c === 'CLOCK_VIDEO' ? '#fbbf24' :
                        c === 'CLOCK_BOTH' ? '#c084fc' :
                        c === 'RVFC_LOST' ? 'var(--so-orange)' : 'var(--so-text-muted)';
                      return (
                        <div key={i} className="so-spike-item-compact">
                          <span className="so-spike-drift" style={{ color: driftColor(sp.rawDriftMs) }}>{fmtMs(sp.rawDriftMs)}ms</span>
                          {badge(c, badgeColor)}
                          <span className="so-spike-conf">{sp.attribution?.confidence ?? 0}%</span>
                        </div>
                      );
                    }) : <div className="so-muted">no spikes</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="so-section">
          {sectionTitle('DISTRIBUTION')}
          <div className="so-dist-compact">
            <div className="so-dist-col">
              <div className="so-dist-header" style={{ color: 'var(--so-blue)' }}>MV</div>
              <HistogramDisplay histogram={mv?.histogram} />
              <DriftGraph history={driftHistoryMv} colorFn={driftColor} label="MV" />
            </div>
            <div className="so-dist-col">
              <div className="so-dist-header" style={{ color: 'var(--so-green)' }}>BG</div>
              <HistogramDisplay histogram={bg?.histogram} />
              <DriftGraph history={driftHistoryBg} colorFn={driftColor} label="BG" />
            </div>
          </div>
        </div>

        {(function() {
          const replay = _replayStateRef.current || _replayStateRef;
          if (!replay || !replay.active) return null;
          return (
            <div className="so-section">
              {sectionTitle('REPLAY')}
              <div className="so-compact-grid">
                <span className="so-compact-label">Status</span>
                <span className="so-compact-value" style={{ color: replay.complete ? 'var(--so-green)' : 'var(--so-yellow)' }}>{replay.complete ? 'COMPLETE' : 'RUNNING'}</span>
                <span className="so-compact-label">Frame</span>
                <span className="so-compact-value">{replay.frameIndex} / {replay.totalFrames}</span>
                {replay.lastFrame && (
                  <>
                    <span className="so-compact-label">Engine</span>
                    <span className="so-compact-value">{replay.lastFrame.engine || '\u2014'}</span>
                    <span className="so-compact-label">Decision</span>
                    <span className="so-compact-value">{replay.lastFrame.decision?.actionRequest?.type || '\u2014'}</span>
                    <span className="so-compact-label">Confidence</span>
                    <span className="so-compact-value">{Math.round((replay.lastFrame.decision?.decisionConfidence || 0) * 100)}%</span>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
});

export default SyncOverlay;
