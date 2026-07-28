const LATEST_RELEASE_ENDPOINT =
  'https://api.github.com/repos/teemoZipsa/PlainView/releases/latest';
const RELEASE_ORIGIN = 'https://github.com';
const RELEASE_PATH_PREFIX = '/teemozipsa/plainview/releases/tag/';
const DEFAULT_TIMEOUT_MS = 8_000;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface GitHubReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  updateAvailable: boolean;
  currentVersionAhead: boolean;
}

export type FetchRelease = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber > rightNumber ? 1 : -1;
    }
    if (leftNumber !== null || rightNumber !== null) {
      return leftNumber !== null ? -1 : 1;
    }
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error('Invalid semantic version.');
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] > parsedRight[key] ? 1 : -1;
    }
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function validateReleaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== RELEASE_ORIGIN ||
    !url.pathname.toLowerCase().startsWith(RELEASE_PATH_PREFIX)
  ) {
    throw new Error('Unexpected release URL.');
  }
  return url.toString();
}

export async function checkForUpdates(
  currentVersion: string,
  fetchRelease: FetchRelease = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<UpdateCheckResult> {
  if (!parseVersion(currentVersion)) {
    throw new Error('Invalid current version.');
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchRelease(LATEST_RELEASE_ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Release check failed with status ${response.status}.`);
    }

    const release = (await response.json()) as GitHubReleaseResponse;
    if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
      throw new Error('Invalid release response.');
    }

    const latestVersion = release.tag_name.replace(/^v/i, '');
    if (!parseVersion(latestVersion)) {
      throw new Error('Invalid latest version.');
    }

    const comparison = compareVersions(latestVersion, currentVersion);
    return {
      currentVersion,
      latestVersion,
      releaseUrl: validateReleaseUrl(release.html_url),
      updateAvailable: comparison > 0,
      currentVersionAhead: comparison < 0,
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
