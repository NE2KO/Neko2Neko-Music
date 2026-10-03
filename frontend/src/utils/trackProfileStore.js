import { TrackSyncProfile } from './trackSyncProfile.js';

export class TrackProfileStore {
  constructor(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    this.profiles = new Map();
    this.maxAgeMs = maxAgeMs;
    this.currentTrackId = null;
  }

  get(mediaId) {
    const profile = this.profiles.get(mediaId);
    if (!profile) return null;
    return profile;
  }

  set(mediaId, profile) {
    if (!(profile instanceof TrackSyncProfile)) {
      profile = new TrackSyncProfile(mediaId, profile);
    }
    this.profiles.set(mediaId, profile);
  }

  remove(mediaId) {
    this.profiles.delete(mediaId);
  }

  clear() {
    this.profiles.clear();
    this.currentTrackId = null;
  }

  setCurrentTrackId(mediaId) {
    this.currentTrackId = mediaId;
  }

  getCurrentTrackId() {
    return this.currentTrackId;
  }

  getOrCreate(mediaId) {
    let profile = this.get(mediaId);
    if (!profile) {
      profile = new TrackSyncProfile(mediaId);
      this.set(mediaId, profile);
    }
    return profile;
  }
}

export const trackProfileStore = new TrackProfileStore();
