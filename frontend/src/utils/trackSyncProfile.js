export class TrackSyncProfile {
  constructor(mediaId, data = {}) {
    this.mediaId = mediaId;
    this.version = 1;
    this.updatedAt = data.updatedAt || performance.now();

    this.biasMs = data.biasMs || { mean: 0, variance: 0, samples: 0 };
    this.decodeLatMs = data.decodeLatMs || { mean: 0, variance: 0, samples: 0 };
    this.seekLatMs = data.seekLatMs || { mean: 0, variance: 0, samples: 0 };
    this.presLatMs = data.presLatMs || { mean: 15, variance: 0, samples: 0 };

    this.driftMean = data.driftMean || 0;
    this.driftVariance = data.driftVariance || 0;
    this.stableRate = data.stableRate || 1;
    this.hardSeekCount = data.hardSeekCount || 0;
    this.softSeekCount = data.softSeekCount || 0;
    this.futileSeekCount = data.futileSeekCount || 0;

    this.sampleCount = data.sampleCount || 0;
    this.confidence = data.confidence || 0;
  }

  getFreshness(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const age = performance.now() - this.updatedAt;
    return Math.max(0, 1 - age / maxAgeMs);
  }

  getEffectiveConfidence() {
    const freshness = this.getFreshness();
    const sampleWeight = Math.min(1, this.sampleCount / 100);
    return freshness * 0.3 + sampleWeight * 0.7;
  }

  toJSON() {
    return {
      mediaId: this.mediaId,
      version: this.version,
      updatedAt: this.updatedAt,
      biasMs: this.biasMs,
      decodeLatMs: this.decodeLatMs,
      seekLatMs: this.seekLatMs,
      presLatMs: this.presLatMs,
      driftMean: this.driftMean,
      driftVariance: this.driftVariance,
      stableRate: this.stableRate,
      hardSeekCount: this.hardSeekCount,
      softSeekCount: this.softSeekCount,
      futileSeekCount: this.futileSeekCount,
      sampleCount: this.sampleCount,
      confidence: this.confidence,
    };
  }

  static fromJSON(json) {
    return new TrackSyncProfile(json.mediaId, json);
  }
}
