import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  formatZoomPercent,
  getNextZoom,
  getWheelZoomDirection,
  getWheelZoomTarget,
  getZoomTransition,
} from '../src/zoom.ts';

test('one zoom-in and one zoom-out return exactly to 100%', () => {
  const enlarged = getNextZoom(1, 'in');

  assert.equal(enlarged, 1.15);
  assert.equal(getNextZoom(enlarged, 'out'), 1);
});

test('one zoom-out and one zoom-in return exactly to 100%', () => {
  const reduced = getNextZoom(1, 'out');

  assert.equal(getNextZoom(reduced, 'in'), 1);
});

test('zooming across 100% stops at 100% in either direction', () => {
  assert.equal(getNextZoom(0.95, 'in'), 1);
  assert.equal(getNextZoom(1.05, 'out'), 1);
});

test('zoom targets remain inside the supported range', () => {
  assert.equal(getNextZoom(MAX_ZOOM, 'in'), MAX_ZOOM);
  assert.equal(getNextZoom(MIN_ZOOM, 'out'), MIN_ZOOM);
});

test('a fitted zoom below 10% changes gradually in both directions', () => {
  const fittedZoom = 0.05;

  assert.equal(getNextZoom(fittedZoom, 'in'), fittedZoom * 1.15);
  assert.equal(getNextZoom(fittedZoom, 'out'), fittedZoom / 1.15);
});

test('zero vertical wheel movement does not request a zoom change', () => {
  assert.equal(getWheelZoomDirection(-1), 'in');
  assert.equal(getWheelZoomDirection(1), 'out');
  assert.equal(getWheelZoomDirection(0), null);
});

test('mouse wheels keep 15% steps while trackpads zoom continuously', () => {
  assert.equal(getWheelZoomTarget(1, -100), 1.15);
  assert.equal(getWheelZoomTarget(1, -3, 1), 1.15);
  assert.equal(getWheelZoomTarget(1, 0), 1);

  const trackpadTarget = getWheelZoomTarget(1, -1);
  assert.ok(trackpadTarget > 1);
  assert.ok(trackpadTarget < 1.01);
});

test('continuous wheel zoom also stops at actual 100%', () => {
  assert.equal(getWheelZoomTarget(0.95, -100), 1);
  assert.equal(getWheelZoomTarget(1.05, 100), 1);
});

test('zoom labels preserve precision and reserve 100% for actual 1:1', () => {
  assert.equal(formatZoomPercent(1), '100');
  assert.equal(formatZoomPercent(0.996), '99.6');
  assert.equal(formatZoomPercent(0.99999), '99.99');
  assert.equal(formatZoomPercent(1.00001), '100.01');
  assert.equal(formatZoomPercent(0.0043478), '0.43');
  assert.equal(formatZoomPercent(1.15), '115');
  assert.equal(formatZoomPercent(Number.NaN), '100');
});

test('interactive zoom reaching 100% keeps the pointer anchor', () => {
  const currentZoom = 0.95;
  const currentPan = { x: 10, y: -5 };
  const anchor = { x: 100, y: -40 };
  const transition = getZoomTransition(
    currentZoom,
    1,
    currentPan,
    (_zoom, panOffset) => panOffset,
    anchor
  );
  const ratio = 1 / currentZoom;

  assert.deepEqual(transition, {
    zoom: 1,
    fitMode: 'auto',
    panOffset: {
      x: anchor.x - (anchor.x - currentPan.x) * ratio,
      y: anchor.y - (anchor.y - currentPan.y) * ratio,
    },
  });
});

test('non-100% zoom keeps a scaled, clamped pan offset', () => {
  const transition = getZoomTransition(
    2,
    3,
    { x: 40, y: -20 },
    (_zoom, panOffset) => ({ x: panOffset.x, y: Math.max(-25, panOffset.y) })
  );

  assert.deepEqual(transition, {
    zoom: 3,
    fitMode: 'auto',
    panOffset: { x: 60, y: -25 },
  });
});

test('wheel zoom can keep the image point under the cursor stationary', () => {
  const transition = getZoomTransition(
    1,
    2,
    { x: 0, y: 0 },
    (_zoom, panOffset) => panOffset,
    { x: 120, y: -40 }
  );

  assert.deepEqual(transition, {
    zoom: 2,
    fitMode: 'auto',
    panOffset: { x: -120, y: 40 },
  });
});
