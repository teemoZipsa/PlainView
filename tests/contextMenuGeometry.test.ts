import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampContextMenuToViewport,
  getInitialContextMenuPlacement,
} from '../src/contextMenuGeometry.ts';

test('uses a full-width stacked menu immediately in the minimum window size', () => {
  assert.deepEqual(
    getInitialContextMenuPlacement({
      pointerX: 270,
      pointerY: 230,
      viewportWidth: 280,
      viewportHeight: 240,
    }),
    {
      x: 8,
      y: 8,
      submenuDirection: 'stacked',
      submenuVerticalDirection: 'up',
    }
  );
});

test('opens a submenu toward the side with enough room', () => {
  assert.equal(
    getInitialContextMenuPlacement({
      pointerX: 8,
      pointerY: 120,
      viewportWidth: 800,
      viewportHeight: 600,
    }).submenuDirection,
    'right'
  );

  assert.equal(
    getInitialContextMenuPlacement({
      pointerX: 400,
      pointerY: 120,
      viewportWidth: 800,
      viewportHeight: 600,
    }).submenuDirection,
    'left'
  );
});

test('anchors a width-constrained stacked menu instead of letting it jump', () => {
  assert.deepEqual(
    getInitialContextMenuPlacement({
      pointerX: 250,
      pointerY: 500,
      viewportWidth: 500,
      viewportHeight: 700,
    }),
    {
      x: 8,
      y: 8,
      submenuDirection: 'stacked',
      submenuVerticalDirection: 'up',
    }
  );
});

test('clamps the measured menu inside every viewport edge', () => {
  assert.deepEqual(
    clampContextMenuToViewport({
      x: 900,
      y: 700,
      menuWidth: 240,
      menuHeight: 500,
      viewportWidth: 800,
      viewportHeight: 600,
    }),
    { x: 552, y: 92 }
  );
});
