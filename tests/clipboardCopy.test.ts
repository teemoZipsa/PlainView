import assert from 'node:assert/strict';
import test from 'node:test';
import { writeAdaptiveClipboard } from '../src/clipboardCopy.ts';

test('writes image formats before appending the Windows file format', async () => {
  const calls: string[] = [];

  const result = await writeAdaptiveClipboard({
    writeImageFormats: async () => {
      calls.push('image');
    },
    appendFileFormat: async () => {
      calls.push('file');
      return { imageAvailable: true, fileAvailable: true };
    },
  });

  assert.deepEqual(calls, ['image', 'file']);
  assert.deepEqual(result, { kind: 'complete' });
});

test('reports image-only success when the file format cannot be appended', async () => {
  const fileError = new Error('clipboard busy');

  const result = await writeAdaptiveClipboard({
    writeImageFormats: async () => {},
    appendFileFormat: async () => {
      throw fileError;
    },
  });

  assert.equal(result.kind, 'image-only');
  if (result.kind === 'image-only') {
    assert.equal(result.fileError, fileError);
  }
});

test('uses the native format report to distinguish file-only success', async () => {
  const result = await writeAdaptiveClipboard({
    writeImageFormats: async () => {},
    appendFileFormat: async () => ({
      imageAvailable: false,
      fileAvailable: true,
    }),
  });

  assert.deepEqual(result, { kind: 'file-only' });
});

test('reports an unavailable clipboard when neither format survives', async () => {
  const result = await writeAdaptiveClipboard({
    writeImageFormats: async () => {},
    appendFileFormat: async () => ({
      imageAvailable: false,
      fileAvailable: false,
    }),
  });

  assert.deepEqual(result, { kind: 'unavailable' });
});

test('does not append a file format when writing the image fails', async () => {
  let fileAppendAttempted = false;

  await assert.rejects(
    writeAdaptiveClipboard({
      writeImageFormats: async () => {
        throw new Error('image conversion failed');
      },
      appendFileFormat: async () => {
        fileAppendAttempted = true;
        return { imageAvailable: true, fileAvailable: true };
      },
    }),
    /image conversion failed/
  );

  assert.equal(fileAppendAttempted, false);
});
