import type { FitMode } from './types';

// Raster images can require a fitted scale well below 10% (for example long
// scrolling captures). Keep the interactive floor below realistic decoder
// limits so zoom-out never turns into an unexpected zoom-in.
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 10;
export const ZOOM_FACTOR = 1.15;
export const ORIGINAL_ZOOM = 1;

const ORIGINAL_ZOOM_EPSILON = 1e-9;

export interface PanOffset {
  x: number;
  y: number;
}

export interface ZoomTransition {
  zoom: number;
  fitMode: Extract<FitMode, 'auto' | 'original'>;
  panOffset: PanOffset;
}

export type ZoomDirection = 'in' | 'out';

export const clampZoom = (zoom: number) =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export const normalizeReferenceZoom = (zoom: number) =>
  Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : ORIGINAL_ZOOM;

export const isOriginalZoom = (zoom: number, referenceZoom = ORIGINAL_ZOOM) => {
  const reference = normalizeReferenceZoom(referenceZoom);
  return Math.abs(zoom - reference) <= Math.max(1, reference) * ORIGINAL_ZOOM_EPSILON;
};

export const getRelativeZoom = (zoom: number, referenceZoom: number) => {
  const normalizedZoom = Number.isFinite(zoom) ? zoom : ORIGINAL_ZOOM;
  return normalizedZoom / normalizeReferenceZoom(referenceZoom);
};

export const getWheelZoomDirection = (deltaY: number): ZoomDirection | null => {
  if (deltaY < 0) return 'in';
  if (deltaY > 0) return 'out';
  return null;
};

export const formatZoomPercent = (zoom: number) => {
  const normalizedZoom = Number.isFinite(zoom) ? zoom : ORIGINAL_ZOOM;
  const percent = normalizedZoom * 100;
  let rounded = Math.round(percent * 100) / 100;

  // Do not label a fitted value just below/above 1:1 as exactly 100%.
  if (!isOriginalZoom(normalizedZoom) && rounded === 100) {
    rounded = normalizedZoom < ORIGINAL_ZOOM ? 99.99 : 100.01;
  }

  return rounded.toFixed(2).replace(/\.?0+$/, '');
};

/**
 * Move through the view's 100% reference as a stable zoom stop. Using
 * reciprocal factors keeps zoom-in followed by zoom-out reversible.
 */
export const getNextZoom = (
  currentZoom: number,
  direction: ZoomDirection,
  referenceZoom = ORIGINAL_ZOOM
) => {
  const reference = normalizeReferenceZoom(referenceZoom);
  const normalizedCurrent = isOriginalZoom(currentZoom, reference) ? reference : currentZoom;
  const candidate =
    direction === 'in'
      ? normalizedCurrent * ZOOM_FACTOR
      : normalizedCurrent / ZOOM_FACTOR;

  const crossesOriginal =
    (normalizedCurrent < reference && candidate > reference) ||
    (normalizedCurrent > reference && candidate < reference);

  return clampZoom(crossesOriginal ? reference : candidate);
};

/**
 * Resolve a zoom change while keeping the image center stable. Returning to
 * The view's 100% reference is a reset operation: it matches the 1:1 control
 * and recenters the image rather than retaining a stale enlarged-view pan.
 */
export const getZoomTransition = (
  currentZoom: number,
  targetZoom: number,
  currentPanOffset: PanOffset,
  clampPanOffset: (zoom: number, panOffset: PanOffset) => PanOffset,
  referenceZoom = ORIGINAL_ZOOM
): ZoomTransition => {
  const clampedZoom = clampZoom(targetZoom);
  const reference = normalizeReferenceZoom(referenceZoom);

  if (isOriginalZoom(clampedZoom, reference)) {
    return {
      zoom: reference,
      fitMode: 'original',
      panOffset: { x: 0, y: 0 },
    };
  }

  const ratio = currentZoom > 0 ? clampedZoom / currentZoom : 1;
  const scaledPanOffset = {
    x: currentPanOffset.x * ratio,
    y: currentPanOffset.y * ratio,
  };

  return {
    zoom: clampedZoom,
    fitMode: 'auto',
    panOffset: clampPanOffset(clampedZoom, scaledPanOffset),
  };
};
