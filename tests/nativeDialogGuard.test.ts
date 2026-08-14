import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NativeDialogGuard,
  runWithNativeDialogGuard,
} from '../src/nativeDialogGuard.ts';

test('blocks a second native dialog and releases after the queued-key delay', async () => {
  const guard = new NativeDialogGuard();
  let finishFirst!: () => void;
  const first = runWithNativeDialogGuard(
    guard,
    () => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }),
    0
  );

  assert.equal(guard.isActive, true);
  assert.deepEqual(await runWithNativeDialogGuard(guard, () => 'second', 0), {
    started: false,
  });

  finishFirst();
  assert.deepEqual(await first, { started: true, value: undefined });
  assert.equal(guard.isActive, true);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(guard.isActive, false);
});

test('releases the guard even when opening the native dialog fails', async () => {
  const guard = new NativeDialogGuard();

  await assert.rejects(
    runWithNativeDialogGuard(
      guard,
      () => Promise.reject(new Error('dialog failed')),
      0
    ),
    /dialog failed/
  );
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(guard.isActive, false);
});
