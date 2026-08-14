import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestIntent } from '../src/asyncIntent.ts';

test('a newer intent invalidates a slower earlier operation', () => {
  const intents = new LatestIntent();
  const slowOpen = intents.begin();
  const newerOpen = intents.begin();

  assert.equal(intents.isCurrent(slowOpen), false);
  assert.equal(intents.isCurrent(newerOpen), true);
});

test('a snapshot stays current until a user action begins', () => {
  const intents = new LatestIntent();
  intents.begin();
  const refreshSnapshot = intents.snapshot();

  assert.equal(intents.isCurrent(refreshSnapshot), true);
  intents.begin();
  assert.equal(intents.isCurrent(refreshSnapshot), false);
});
