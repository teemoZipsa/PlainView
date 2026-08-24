import type { MouseEvent } from 'react';

export const WINDOW_RESIZE_HANDLES = [
  { direction: 'North', className: 'north' },
  { direction: 'NorthEast', className: 'north-east' },
  { direction: 'East', className: 'east' },
  { direction: 'SouthEast', className: 'south-east' },
  { direction: 'South', className: 'south' },
  { direction: 'SouthWest', className: 'south-west' },
  { direction: 'West', className: 'west' },
  { direction: 'NorthWest', className: 'north-west' },
] as const;

export type WindowResizeDirection =
  (typeof WINDOW_RESIZE_HANDLES)[number]['direction'];

export interface WindowResizeState {
  ready: boolean;
  isFullscreen: boolean;
  isMaximized: boolean;
}

export const canStartWindowResize = (state: WindowResizeState) =>
  state.ready && !state.isFullscreen && !state.isMaximized;

interface WindowResizeHandlesProps {
  onResizeStart: (direction: WindowResizeDirection) => void;
}

export default function WindowResizeHandles({
  onResizeStart,
}: WindowResizeHandlesProps) {
  const handleMouseDown = (
    event: MouseEvent<HTMLDivElement>,
    direction: WindowResizeDirection
  ) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    onResizeStart(direction);
  };

  return (
    <>
      {WINDOW_RESIZE_HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          className={`window-resize-handle resize-${className}`}
          aria-hidden="true"
          onMouseDown={(event) => handleMouseDown(event, direction)}
        />
      ))}
    </>
  );
}
