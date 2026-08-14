import assert from 'node:assert/strict';
import test from 'node:test';
import { RevisionLruCache } from '../src/imageCache.ts';

test('reuses an entry only while file size and modified time still match', () => {
  const cache = new RevisionLruCache<string>(2);
  const original = { fileSize: 120, modifiedTimeNs: '1000000000' };

  cache.set('photo.png', original, 'first');

  assert.equal(cache.get('photo.png', original), 'first');
  assert.equal(
    cache.get('photo.png', { fileSize: 121, modifiedTimeNs: '1000000000' }),
    undefined
  );
  assert.equal(cache.size, 0);
});

test('distinguishes writes that occur within the same millisecond', () => {
  const cache = new RevisionLruCache<string>(2);
  cache.set(
    'photo.png',
    { fileSize: 120, modifiedTimeNs: '1000000000' },
    'first'
  );

  assert.equal(
    cache.get('photo.png', { fileSize: 120, modifiedTimeNs: '1000000001' }),
    undefined
  );
});

test('evicts the least recently used entry', () => {
  const cache = new RevisionLruCache<string>(2);
  const revision = { fileSize: 1, modifiedTimeNs: '1' };

  cache.set('one.png', revision, 'one');
  cache.set('two.png', revision, 'two');
  assert.equal(cache.get('one.png', revision), 'one');

  cache.set('three.png', revision, 'three');

  assert.equal(cache.get('two.png', revision), undefined);
  assert.equal(cache.get('one.png', revision), 'one');
  assert.equal(cache.get('three.png', revision), 'three');
});

test('evicts entries by total byte weight and skips an oversized entry', () => {
  const cache = new RevisionLruCache<string>(5, 10, (value) => value.length);
  const revision = { fileSize: 1, modifiedTimeNs: '1' };

  cache.set('one', revision, '123456');
  cache.set('two', revision, '12345');
  assert.equal(cache.get('one', revision), undefined);
  assert.equal(cache.get('two', revision), '12345');
  assert.equal(cache.totalWeight, 5);

  cache.set('huge', revision, '12345678901');
  assert.equal(cache.get('huge', revision), undefined);
  assert.equal(cache.totalWeight, 5);
});
