import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash } from './routeParser.js';

const noStorage = { getItem: () => null };

test('deep-link to a playlist track parses playlistId and trackFileId (file id at parts[4])', () => {
  const route = parseHash('#/audio/playlist/562/track/bcc9ff31c8e4f2f31e312a2145ac9d4c', noStorage);
  assert.equal(route.type, 'audio');
  assert.equal(route.playlistId, '562');
  assert.equal(route.trackFileId, 'bcc9ff31c8e4f2f31e312a2145ac9d4c');
});

test('the track id is NOT read from parts[5] (which is undefined for this URL)', () => {
  const route = parseHash('#/audio/playlist/562/track/bcc9ff31c8e4f2f31e312a2145ac9d4c', noStorage);
  assert.notEqual(route.trackFileId, undefined);
  assert.notEqual(route.trackFileId, null);
});

test('single-file audio URL parses fileId', () => {
  const route = parseHash('#/audio/single/abc123', noStorage);
  assert.equal(route.type, 'audio');
  assert.equal(route.fileId, 'abc123');
});

test('empty hash with no storage defaults to root/media', () => {
  const route = parseHash('', noStorage);
  assert.equal(route.type, 'root');
  assert.equal(route.view, 'media');
});

test('empty hash with saved view in storage restores that view', () => {
  const storage = { getItem: (k) => (k === 'view' ? 'audio' : null) };
  const route = parseHash('', storage);
  assert.equal(route.type, 'audio');
});

test('playlist detail and plain audio tab routes', () => {
  assert.equal(parseHash('#/playlists/99', noStorage).type, 'playlist-detail');
  assert.equal(parseHash('#/audio', noStorage).type, 'audio');
  assert.equal(parseHash('#/media', noStorage).type, 'root');
});

test('music routes map to same views', () => {
  assert.equal(parseHash('#/music', noStorage).type, 'root');
  assert.equal(parseHash('#/music/playlists', noStorage).type, 'playlists');
  assert.equal(parseHash('#/music/playlists/99', noStorage).type, 'playlist-detail');
  assert.equal(parseHash('#/music/player', noStorage).type, 'audio');
});
