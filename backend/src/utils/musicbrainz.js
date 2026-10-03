const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';
const USER_AGENT = 'Music/1.0 (media-server)';

async function mbFetch(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT }
  });
  if (!res.ok) return null;
  return res.json();
}

export async function searchRelease(artist, album) {
  const query = `artist:"${artist}" AND release:"${album}"`;
  const url = `${MB_BASE}/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
  const data = await mbFetch(url);
  if (!data?.releases) return [];
  return data.releases.map(r => ({
    id: r.id,
    title: r.title,
    artist: r['artist-credit']?.[0]?.name || artist,
    date: r.date,
    country: r.country,
    trackCount: r['track-count'],
    status: r.status,
  }));
}

export async function searchReleaseGroup(artist, album) {
  const query = `artist:"${artist}" AND releasegroup:"${album}"`;
  const url = `${MB_BASE}/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
  const data = await mbFetch(url);
  if (!data?.['release-groups']) return [];
  return data['release-groups'].map(rg => ({
    id: rg.id,
    title: rg.title,
    artist: rg['artist-credit']?.[0]?.name || artist,
    type: rg.type,
    firstReleaseDate: rg['first-release-date'],
  }));
}

export async function getCoverArt(mbid) {
  const url = `${CAA_BASE}/release/${mbid}`;
  const data = await mbFetch(url);
  if (!data?.images) return null;
  const front = data.images.find(i => i.front) || data.images[0];
  if (!front) return null;
  return {
    id: front.id,
    image: front.image,
    thumbnails: front.thumbnails || {},
    types: front.types || [],
    approved: front.approved,
  };
}

export async function searchRecording(artist, track) {
  const query = `recording:"${track}"` + (artist ? ` AND artist:"${artist}"` : '');
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
  const data = await mbFetch(url);
  if (!data?.recordings) return [];
  return data.recordings.map(r => ({
    id: r.id,
    title: r.title,
    artist: r['artist-credit']?.[0]?.name || artist,
    length: r.length,
    releases: (r.releases || []).map(rel => rel.id),
  }));
}

export async function searchCoverArt(artist, album, track) {
  // If we have a track name, try recording search first (more specific)
  if (track) {
    const recordings = await searchRecording(artist, track);
    const results = [];
    const seenReleases = new Set();
    for (const rec of recordings.slice(0, 5)) {
      for (const relId of rec.releases) {
        if (seenReleases.has(relId)) continue;
        seenReleases.add(relId);
        const art = await getCoverArt(relId);
        if (art) {
          results.push({
            release: { id: relId, title: rec.title, artist: rec.artist },
            cover: art,
          });
        }
        if (results.length >= 8) break;
      }
      if (results.length >= 8) break;
    }
    if (results.length > 0) return results;
  }

  // Fallback: search by artist + album
  if (artist && album) {
    const releases = await searchRelease(artist, album);
    const results = [];
    for (const release of releases.slice(0, 5)) {
      const art = await getCoverArt(release.id);
      if (art) {
        results.push({ release, cover: art });
      }
    }
    return results;
  }

  // Last resort: search just artist
  if (artist && !album) {
    const releases = await searchRelease(artist, '');
    const results = [];
    for (const release of releases.slice(0, 5)) {
      const art = await getCoverArt(release.id);
      if (art) {
        results.push({ release, cover: art });
      }
    }
    return results;
  }

  return [];
}

export async function getCoverArtByReleaseGroup(rgMbid) {
  const url = `${CAA_BASE}/release-group/${rgMbid}`;
  const data = await mbFetch(url);
  if (!data?.images) return null;
  const front = data.images.find(i => i.front) || data.images[0];
  if (!front) return null;
  return {
    id: front.id,
    image: front.image,
    thumbnails: front.thumbnails || {},
    types: front.types || [],
    approved: front.approved,
  };
}
