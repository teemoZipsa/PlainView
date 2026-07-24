import type { Rotation } from './types';

export interface CanvasSize {
  width: number;
  height: number;
}

export function getRotatedCanvasSize(
  width: number,
  height: number,
  rotation: Rotation
): CanvasSize {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }

  return { width, height };
}

export function drawImageToCanvas(
  imageElement: HTMLImageElement,
  rotation: Rotation = 0,
  canvas: HTMLCanvasElement = document.createElement('canvas')
): HTMLCanvasElement {
  const width = imageElement.naturalWidth;
  const height = imageElement.naturalHeight;

  if (!width || !height) {
    throw new Error('image_size_failed');
  }

  const canvasSize = getRotatedCanvasSize(width, height, rotation);
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context is not available.');
  }

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(imageElement, -width / 2, -height / 2, width, height);

  return canvas;
}
