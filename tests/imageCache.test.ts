import assert from 'node:assert/strict';
import test from 'node:test';
import { RevisionLruCache } from '../src/imageCache.ts';

test('reuses an entry only while file size and modified time still match', () => {
  const cache = new RevisionLruCache<string>(2);
  const original = { fileSize: 120, modifiedTimeMs: 1_000 };

  cache.set('photo.png', original, 'first');

  assert.equal(cache.get('photo.png', original), 'first');
  assert.equal(
    cache.get('photo.png', { fileSize: 121, modifiedTimeMs: 1_000 }),
    undefined
  );
  assert.equal(cache.size, 0);
});

test('evicts the least recently used entry', () => {
  const cache = new RevisionLruCache<string>(2);
  const revision = { fileSize: 1, modifiedTimeMs: 1 };

  cache.set('one.png', revision, 'one');
  cache.set('two.png', revision, 'two');
  assert.equal(cache.get('one.png', revision), 'one');

  cache.set('three.png', revision, 'three');

  assert.equal(cache.get('two.png', revision), undefined);
  assert.equal(cache.get('one.png', revision), 'one');
  assert.equal(cache.get('three.png', revision), 'three');
});
