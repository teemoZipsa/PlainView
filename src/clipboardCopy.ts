export type AdaptiveCopyOutcome =
  | { kind: 'complete' }
  | { kind: 'image-only'; fileError?: unknown }
  | { kind: 'file-only' }
  | { kind: 'unavailable' };

export interface ClipboardFormatStatus {
  imageAvailable: boolean;
  fileAvailable: boolean;
}

interface AdaptiveCopyActions {
  writeImageFormats: () => Promise<void>;
  appendFileFormat: () => Promise<ClipboardFormatStatus>;
}

/**
 * Image formats are the useful fallback for nearly every paste target, so they
 * are written first. A later CF_HDROP failure is reported as a partial success
 * instead of incorrectly claiming that nothing reached the clipboard.
 */
export async function writeAdaptiveClipboard({
  writeImageFormats,
  appendFileFormat,
}: AdaptiveCopyActions): Promise<AdaptiveCopyOutcome> {
  await writeImageFormats();

  try {
    const status = await appendFileFormat();
    if (status.imageAvailable && status.fileAvailable) {
      return { kind: 'complete' };
    }
    if (status.imageAvailable) return { kind: 'image-only' };
    if (status.fileAvailable) return { kind: 'file-only' };
    return { kind: 'unavailable' };
  } catch (fileError) {
    return { kind: 'image-only', fileError };
  }
}
