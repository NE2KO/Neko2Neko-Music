import { Power, RefreshCw } from 'lucide-react';
import { useServiceControl } from '../hooks/useServiceControl';

const SERVICE_CONFIG = {
  mediaVault: {
    label: 'Media Vault',
    description: 'Media browsing and streaming is unavailable while the vault is stopped.',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    icon: '📁',
  },
  downloader: {
    label: 'Downloader',
    description: 'Downloads are unavailable while the downloader is stopped.',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    icon: '⬇️',
  },
  playlists: {
    label: 'Music',
    description: 'Playlist scanning is unavailable while playlists service is stopped.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    icon: '🎶',
  },
  adbTransfer: {
    label: 'ADB Transfer',
    description: 'File transfer is unavailable while ADB is stopped.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: '📱',
  },
};

export default function ServiceStoppedBanner({ service, overlay = false }) {
  const { services, startService, loading } = useServiceControl();
  const svc = services[service];
  const config = SERVICE_CONFIG[service];

  if (!svc || svc.status !== 'stopped' || !config) return null;

  if (overlay) {
    return (
      <div data-debug-id="X.3" data-debug-name="ServiceStoppedBanner" data-debug-type="overlay" className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className={`text-center p-6 rounded-2xl border ${config.bg} ${config.border} max-w-sm mx-4`}>
          <div className="text-4xl mb-3">{config.icon}</div>
          <div className={`text-sm font-bold ${config.color} mb-1`}>{config.label} Stopped</div>
          <div className="text-[11px] text-neutral-500 mb-4 leading-relaxed">{config.description}</div>
          <button
            onClick={() => startService(service)}
            disabled={loading}
            className="flex items-center gap-2 mx-auto px-5 py-2 text-xs font-medium bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/30 rounded-xl transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Start {config.label}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-debug-id="X.3" data-debug-name="ServiceStoppedBanner" data-debug-type="overlay" className={`mx-4 mt-3 p-3 rounded-xl border ${config.bg} ${config.border} backdrop-blur`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${config.bg} border ${config.border}`}>
          <Power size={14} className={config.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${config.color}`}>{config.label} Stopped</div>
          <div className="text-[10px] text-neutral-500 mt-0.5">{config.description}</div>
        </div>
        <button
          onClick={() => startService(service)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg transition-colors disabled:opacity-40"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Start
        </button>
      </div>
    </div>
  );
}
