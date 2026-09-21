import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SUPPORTED_IMAGE_EXTENSIONS,
  RECOGNIZED_UNSUPPORTED_IMAGE_EXTENSIONS,
  usesFileImageSource,
} from '../src/imageFormats.ts';

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

test('only WebView-native formats are eligible for speculative preload', () => {
  assert.equal(usesFileImageSource('C:\\images\\photo.JPEG'), true);
  assert.equal(usesFileImageSource('C:\\images\\animation.gif'), true);
  assert.equal(usesFileImageSource('C:\\images\\large.tiff'), false);
  assert.equal(usesFileImageSource('C:\\images\\layered.psd'), false);
});

test('Rust scanning and the picker advertise the same viewable formats', async () => {
  const rust = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const extensions = (name: string) => {
    const declaration = rust.match(new RegExp(`const ${name}: [^=]+=[\\s]*&\\[([\\s\\S]*?)\\];`));
    assert.ok(declaration, `Missing Rust format declaration: ${name}`);
    return [...declaration[1].matchAll(/"([a-z0-9]+)"/g)].map((match) => match[1]).sort();
  };
  assert.deepEqual(extensions('SUPPORTED_EXTENSIONS'), [...SUPPORTED_IMAGE_EXTENSIONS].sort());
  assert.deepEqual(
    [...extensions('UNSUPPORTED_HEIC_EXTENSIONS'), ...extensions('UNSUPPORTED_RAW_EXTENSIONS')].sort(),
    [...RECOGNIZED_UNSUPPORTED_IMAGE_EXTENSIONS].sort()
  );
  for (const extension of RECOGNIZED_UNSUPPORTED_IMAGE_EXTENSIONS) {
    assert.equal((SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(extension), false);
  }
});
