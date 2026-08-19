import type { FitMode, Rotation } from './types';

export interface ViewTransformState {
  zoom: number;
  referenceZoom: number;
  rotation: Rotation;
  fitMode: FitMode;
  panOffset: { x: number; y: number };
}

export const getNextRotation = (rotation: Rotation) =>
  ((rotation + 90) % 360) as Rotation;

export const createFittedView = (
  rotation: Rotation,
  zoom: number
): ViewTransformState => ({
  rotation,
  zoom,
  referenceZoom: zoom,
  fitMode: 'fit',
  panOffset: { x: 0, y: 0 },
});

export const restoreViewTransform = (
  snapshot: ViewTransformState
): ViewTransformState => ({
  zoom: snapshot.zoom,
  referenceZoom: snapshot.referenceZoom,
  rotation: snapshot.rotation,
  fitMode: snapshot.fitMode,
  panOffset: { ...snapshot.panOffset },
});
