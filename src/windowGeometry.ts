export interface ViewportDimensions {
  width: number;
  height: number;
}

/**
 * Mixed-DPI transitions can leave the WebView and image dimensions apart by a
 * fraction of a CSS pixel. Treat that rounding as fitted content, not pannable
 * overflow, so dragging continues to move the window at monitor boundaries.
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
