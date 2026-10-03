import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayableQueue, resolveClickedIndex } from './playlistQueue.js';

// Fixture: a displayed playlist where the 2nd track (by display order) is
// missing its file (exists=false) and therefore is NOT playable. The playable
// subset is [track0, track2, track3]. Grid order is [0,1,2,3].
const makeTracks = () => [
  { id: 't0', file_id: 'f0', display_name: 'A', exists: true, resolved_path: '/a.mp3' },
  { id: 't1', file_id: 'f1', display_name: 'B', exists: false }, // missing file
  { id: 't2', file_id: 'f2', display_name: 'C', exists: true, resolved_path: '/c.mp3' },
  { id: 't3', file_id: 'f3', display_name: 'D', exists: true, resolved_path: '/d.mp3' },
];

test('buildPlayableQueue drops unplayable tracks but preserves display order', () => {
  const queue = buildPlayableQueue(makeTracks());
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map((q) => q.file_id), ['f0', 'f2', 'f3']);
  // track_index reflects position *within the playable queue*
  assert.deepEqual(queue.map((q) => q.track_index), [0, 1, 2]);
});

test('clicking the 3rd displayed track resolves to its index in the playable queue (not 0)', () => {
  const displayTracks = makeTracks();
  const queue = buildPlayableQueue(displayTracks); // [f0, f2, f3]
  // The 3rd displayed track is index 2 -> file_id f2 -> playable index 1.
  const clicked = displayTracks[2];
  const idx = resolveClickedIndex(clicked, queue);
  assert.equal(idx, 1);
  assert.equal(queue[idx].file_id, 'f2');
  assert.notEqual(idx, 0); // would have been the old bug
});

test('clicking an unresolvable (missing) track does NOT resolve to 0', () => {
  const displayTracks = makeTracks();
  const queue = buildPlayableQueue(displayTracks);
  const missing = displayTracks[1]; // exists=false, not in queue
  const idx = resolveClickedIndex(missing, queue);
  assert.equal(idx, -1);
});

test('resolveClickedIndex matches on stable id even when file_id is absent', () => {
  const queue = buildPlayableQueue(makeTracks());
  const clicked = { id: 't3' }; // no file_id, only id
  const idx = resolveClickedIndex(clicked, queue);
  assert.equal(idx, 2);
  assert.equal(queue[idx].file_id, 'f3');
});

// Loved-playlist scenario: every track has id === file_id, and the backend can
// return the same file twice (duplicate entries). buildPlayableQueue must drop
// the duplicate so resolveClickedIndex targets the clicked track, not index 0.
const makeLovedTracks = () => [
  { id: 'f0', file_id: 'f0', display_name: 'A', exists: true, resolved_path: '/a.mp3' },
  { id: 'f1', file_id: 'f1', display_name: 'B', exists: true, resolved_path: '/b.mp3' },
  { id: 'f2', file_id: 'f2', display_name: 'C', exists: true, resolved_path: '/c.mp3' },
  { id: 'f9', file_id: 'f9', display_name: 'J', exists: true, resolved_path: '/j.mp3' },
  { id: 'f9', file_id: 'f9', display_name: 'J (dup)', exists: true, resolved_path: '/j.mp3' }, // duplicate of f9
];

test('Loved: buildPlayableQueue deduplicates by file_id (keeps first)', () => {
  const queue = buildPlayableQueue(makeLovedTracks());
  assert.equal(queue.length, 4); // duplicate f9 dropped
  assert.deepEqual(queue.map((q) => q.file_id), ['f0', 'f1', 'f2', 'f9']);
});

test('Loved: clicking the last (duplicate) file still resolves to its real index', () => {
  const displayTracks = makeLovedTracks();
  const queue = buildPlayableQueue(displayTracks); // [f0, f1, f2, f9]
  const clicked = displayTracks[3]; // the real f9 (4th display row)
  const idx = resolveClickedIndex(clicked, queue);
  assert.equal(idx, 3);
  assert.equal(queue[idx].file_id, 'f9');
  assert.notEqual(idx, 0); // would have been the old Bug #2 behavior
});

test('empty / non-array input is safe', () => {
  assert.equal(buildPlayableQueue([]).length, 0);
  assert.equal(buildPlayableQueue(null).length, 0);
  assert.equal(resolveClickedIndex(null, []), -1);
  assert.equal(resolveClickedIndex({ id: 'x' }, null), -1);
});
