export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface PanOffset {
  x: number;
  y: number;
}

/**
 * Mixed-DPI transitions can leave the WebView and image dimensions apart by a
 * fraction of a CSS pixel. Treat that rounding as fitted content, not pannable
 * overflow, so the viewer does not expose a misleading image-pan cursor.
 */
export const PAN_OVERFLOW_TOLERANCE = 2;

export const exceedsPanBoundary = (rendered: number, viewport: number) =>
  rendered > viewport + PAN_OVERFLOW_TOLERANCE;

export const hasPanOverflow = (
  rendered: ViewportDimensions,
  viewport: ViewportDimensions
) =>
  exceedsPanBoundary(rendered.width, viewport.width) ||
  exceedsPanBoundary(rendered.height, viewport.height);

/** Auto-size only the first successfully displayed image in a fresh window. */
export const shouldAutoSizeWindowForImage = (
  hasDisplayedImage: boolean,
  initialSizingPending: boolean
) => !hasDisplayedImage && initialSizingPending;

export const resolveViewportDimensions = (
  fallback: ViewportDimensions,
  measured?: Partial<ViewportDimensions> | null
): ViewportDimensions => {
  if (
    measured &&
    typeof measured.width === 'number' &&
    Number.isFinite(measured.width) &&
    measured.width > 0 &&
    typeof measured.height === 'number' &&
    Number.isFinite(measured.height) &&
    measured.height > 0
  ) {
    return { width: measured.width, height: measured.height };
  }

  return fallback;
};

export const clampPanOffsetToViewport = (
  rendered: ViewportDimensions,
  viewport: ViewportDimensions,
  panOffset: PanOffset
): PanOffset => {
  const clampAxis = (offset: number, renderedSize: number, viewportSize: number) => {
    if (!exceedsPanBoundary(renderedSize, viewportSize)) return 0;

    const maxOffset = (renderedSize - viewportSize) / 2;
    return Math.max(-maxOffset, Math.min(maxOffset, offset));
  };

  return {
    x: clampAxis(panOffset.x, rendered.width, viewport.width),
    y: clampAxis(panOffset.y, rendered.height, viewport.height),
  };
};
