// Shared, safe-but-aggressive yt-dlp flags to resist timeouts and rate limits.
// Applied to every download pipeline (Music cache).

export const YTDLP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Aggressive but within safe bounds:
//  - generous retries (network/transient) without being infinite
//  - socket timeout so a stalled connection eventually gives up and retries
//  - a real browser UA to avoid lightweight-bot fingerprinting / limits
//  - chunked HTTP + larger buffer for smoother fragmented downloads
export const YTDLP_RESILIENT_ARGS = [
  '--retries', '10',
  '--fragment-retries', '10',
  '--extractor-retries', '3',
  '--retry-sleep', '2',
  '--socket-timeout', '30',
  '--http-chunk-size', '10M',
  '--buffer-size', '32K',
  '--user-agent', YTDLP_USER_AGENT,
];
