import assert from 'node:assert/strict';
import test from 'node:test';
import { checkForUpdates, compareVersions, type FetchRelease } from '../src/updateCheck.ts';

function releaseResponse(
  tagName: string,
  htmlUrl = `https://github.com/teemoZipsa/PlainView/releases/tag/${tagName}`
): FetchRelease {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: tagName, html_url: htmlUrl }),
  });
}

test('compares stable and prerelease semantic versions', () => {
  assert.equal(compareVersions('0.7.7', '0.7.6'), 1);
  assert.equal(compareVersions('v0.7.7', '0.7.7'), 0);
  assert.equal(compareVersions('0.8.0', '0.7.99'), 1);
  assert.equal(compareVersions('0.7.7-beta.2', '0.7.7-beta.1'), 1);
  assert.equal(compareVersions('0.7.7', '0.7.7-beta.2'), 1);
});

test('reports a newer public release', async () => {
  const result = await checkForUpdates('0.7.7', releaseResponse('v0.7.8'));

  assert.deepEqual(result, {
    currentVersion: '0.7.7',
    latestVersion: '0.7.8',
    releaseUrl: 'https://github.com/teemoZipsa/PlainView/releases/tag/v0.7.8',
    updateAvailable: true,
    currentVersionAhead: false,
  });
});

test('does not report the current or an older release as an update', async () => {
  assert.equal(
    (await checkForUpdates('0.7.7', releaseResponse('v0.7.7'))).updateAvailable,
    false
  );
  assert.equal(
    (await checkForUpdates('0.7.7', releaseResponse('v0.7.6'))).updateAvailable,
    false
  );
  assert.equal(
    (await checkForUpdates('0.7.7', releaseResponse('v0.7.6'))).currentVersionAhead,
    true
  );
});

test('rejects release URLs outside the PlainView GitHub repository', async () => {
  await assert.rejects(
    checkForUpdates(
      '0.7.7',
      releaseResponse('v9.9.9', 'https://example.com/releases/tag/v9.9.9')
    ),
    /Unexpected release URL/
  );
});

test('rejects unsuccessful or malformed release responses', async () => {
  await assert.rejects(
    checkForUpdates('0.7.7', async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    })),
    /status 403/
  );
  await assert.rejects(
    checkForUpdates('0.7.7', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'latest' }),
    })),
    /Invalid release response/
  );
});
