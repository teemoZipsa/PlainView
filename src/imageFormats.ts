export const SUPPORTED_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'avif',
  'heic',
  'heif',
  'jxl',
  'psd',
  'tga',
  'dds',
  'pbm',
  'pgm',
  'pnm',
  'ppm',
  'pam',
  'raw',
  'cr2',
  'nef',
  'arw',
] as const;

export const FILE_SOURCE_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
] as const;

const fileSourceExtensionSet = new Set<string>(FILE_SOURCE_IMAGE_EXTENSIONS);

export function usesFileImageSource(filePath: string): boolean {
  const fileName = filePath.split(/[\\/]/).pop() ?? '';
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex < 0 || extensionIndex === fileName.length - 1) return false;
  return fileSourceExtensionSet.has(fileName.slice(extensionIndex + 1).toLowerCase());
}
