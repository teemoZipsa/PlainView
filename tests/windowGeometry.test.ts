import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAN_OVERFLOW_TOLERANCE,
  clampPanOffsetToViewport,
  exceedsPanBoundary,
  hasPanOverflow,
  resolveViewportDimensions,
  shouldAutoSizeWindowForImage,
} from '../src/windowGeometry.ts';

test('mixed-DPI rounding does not enable image panning', () => {
  assert.equal(exceedsPanBoundary(800.5, 800), false);
  assert.equal(exceedsPanBoundary(800 + PAN_OVERFLOW_TOLERANCE, 800), false);
  assert.equal(hasPanOverflow({ width: 800.5, height: 600 }, { width: 800, height: 600 }), false);
});

test('real image overflow remains pannable', () => {
  assert.equal(exceedsPanBoundary(803, 800), true);
  assert.equal(hasPanOverflow({ width: 800, height: 604 }, { width: 800, height: 600 }), true);
});

test('window auto-sizing is consumed by the first fresh image only', () => {
  assert.equal(shouldAutoSizeWindowForImage(false, true), true);
  assert.equal(shouldAutoSizeWindowForImage(true, true), false);
  assert.equal(shouldAutoSizeWindowForImage(false, false), false);
});

test('window growth clamps a previously valid pan to the new smaller range', () => {
  assert.deepEqual(
    clampPanOffsetToViewport(
      { width: 1200, height: 800 },
      { width: 1000, height: 800 },
      { x: 300, y: -120 }
    ),
    { x: 100, y: 0 }
  );
});

test('window growth recenters an image that no longer overflows', () => {
  assert.deepEqual(
    clampPanOffsetToViewport(
      { width: 900, height: 700 },
      { width: 1000, height: 800 },
      { x: 180, y: -90 }
    ),
    { x: 0, y: 0 }
  );
});

test('fit calculations prefer the measured viewer over the requested window size', () => {
  assert.deepEqual(
    resolveViewportDimensions(
      { width: 1200, height: 800 },
      { width: 1184.5, height: 763.25 }
    ),
    { width: 1184.5, height: 763.25 }
  );
});

test('fit calculations fall back when the viewer has no usable measurement', () => {
  assert.deepEqual(
    resolveViewportDimensions(
      { width: 1200, height: 800 },
      { width: 0, height: Number.NaN }
    ),
    { width: 1200, height: 800 }
  );
});
