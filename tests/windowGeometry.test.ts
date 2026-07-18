import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAN_OVERFLOW_TOLERANCE,
  exceedsPanBoundary,
  hasPanOverflow,
} from '../src/windowGeometry.ts';

test('mixed-DPI rounding does not switch window dragging into image panning', () => {
  assert.equal(exceedsPanBoundary(800.5, 800), false);
  assert.equal(exceedsPanBoundary(800 + PAN_OVERFLOW_TOLERANCE, 800), false);
  assert.equal(hasPanOverflow({ width: 800.5, height: 600 }, { width: 800, height: 600 }), false);
});

test('real image overflow remains pannable', () => {
  assert.equal(exceedsPanBoundary(803, 800), true);
  assert.equal(hasPanOverflow({ width: 800, height: 604 }, { width: 800, height: 600 }), true);
});
