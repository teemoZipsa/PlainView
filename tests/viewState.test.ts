import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFittedView,
  getNextRotation,
  restoreViewTransform,
} from '../src/viewState.ts';

test('rotation advances clockwise through all four orientations', () => {
  assert.equal(getNextRotation(0), 90);
  assert.equal(getNextRotation(90), 180);
  assert.equal(getNextRotation(180), 270);
  assert.equal(getNextRotation(270), 0);
});

test('rotating into a fitted view records the matching fit mode', () => {
  assert.deepEqual(createFittedView(90, 0.625), {
    rotation: 90,
    zoom: 0.625,
    fitMode: 'fit',
    panOffset: { x: 0, y: 0 },
  });
});

test('fullscreen restoration includes rotation and copies the pan offset', () => {
  const snapshot = {
    rotation: 270 as const,
    zoom: 1.5,
    fitMode: 'auto' as const,
    panOffset: { x: 120, y: -45 },
  };
  const restored = restoreViewTransform(snapshot);

  assert.deepEqual(restored, snapshot);
  assert.notEqual(restored.panOffset, snapshot.panOffset);
});
