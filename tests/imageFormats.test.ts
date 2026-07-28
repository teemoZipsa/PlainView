import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../src/imageFormats.ts';

test('the image picker matches the Windows file-association extension list', async () => {
  const config = JSON.parse(
    await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  );
  const registered = config.bundle.fileAssociations.flatMap(
    (association: { ext: string[] }) => association.ext
  );

  assert.deepEqual(
    [...SUPPORTED_IMAGE_EXTENSIONS].sort(),
    [...registered].sort()
  );
});
