import assert from 'node:assert/strict';
import test from 'node:test';
import { SerializedTaskQueue } from '../src/serializedTaskQueue.ts';

test('runs settings writes in the order they were requested', async () => {
  const queue = new SerializedTaskQueue();
  const events: string[] = [];
  let finishFirst!: () => void;

  const first = queue.run(async () => {
    events.push('first-start');
    await new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    events.push('first-end');
  });
  const second = queue.run(async () => {
    events.push('second');
  });

  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.deepEqual(events, ['first-start']);
  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});

test('continues with the next write after a failure', async () => {
  const queue = new SerializedTaskQueue();
  const first = queue.run(async () => {
    throw new Error('disk error');
  });
  const second = queue.run(async () => 'saved');

  await assert.rejects(first, /disk error/);
  assert.equal(await second, 'saved');
});
