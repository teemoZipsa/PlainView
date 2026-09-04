import type { ResizeDirection } from '../windowResize';

const handles: Array<{ className: string; direction: ResizeDirection }> = [
  { className: 'north', direction: 'North' },
  { className: 'north-east', direction: 'NorthEast' },
  { className: 'east', direction: 'East' },
  { className: 'south-east', direction: 'SouthEast' },
  { className: 'south', direction: 'South' },
  { className: 'south-west', direction: 'SouthWest' },
  { className: 'west', direction: 'West' },
  { className: 'north-west', direction: 'NorthWest' },
];

export default function WindowResizeHandles() {
  return (
    <>
      {handles.map(({ className, direction }) => (
        <div
          key={direction}
          className={`window-resize-handle window-resize-${className}`}
          data-resize-direction={direction}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
