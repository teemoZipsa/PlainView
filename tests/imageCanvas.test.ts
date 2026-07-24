import assert from 'node:assert/strict';
import test from 'node:test';
import { getRotatedCanvasSize } from '../src/imageCanvas.ts';

test('keeps canvas dimensions for 0 and 180 degree rotations', () => {
  assert.deepEqual(getRotatedCanvasSize(1920, 1080, 0), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(getRotatedCanvasSize(1920, 1080, 180), {
    width: 1920,
    height: 1080,
  });
});

test('swaps canvas dimensions for 90 and 270 degree rotations', () => {
  assert.deepEqual(getRotatedCanvasSize(1920, 1080, 90), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(getRotatedCanvasSize(1920, 1080, 270), {
    width: 1080,
    height: 1920,
  });
});
