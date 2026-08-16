export type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

export const WINDOW_RESIZE_EDGE_SIZE = 12;
export const WINDOW_RESIZE_CORNER_SPAN = 28;

export function getWindowResizeDirection(
  x: number,
  y: number,
  width: number,
  height: number
): ResizeDirection | null {
  const nearNorth = y >= 0 && y < WINDOW_RESIZE_EDGE_SIZE;
  const nearSouth = y <= height && y > height - WINDOW_RESIZE_EDGE_SIZE;
  const nearWest = x >= 0 && x < WINDOW_RESIZE_EDGE_SIZE;
  const nearEast = x <= width && x > width - WINDOW_RESIZE_EDGE_SIZE;
  const withinWestCorner = x >= 0 && x < WINDOW_RESIZE_CORNER_SPAN;
  const withinEastCorner = x <= width && x > width - WINDOW_RESIZE_CORNER_SPAN;
  const withinNorthCorner = y >= 0 && y < WINDOW_RESIZE_CORNER_SPAN;
  const withinSouthCorner = y <= height && y > height - WINDOW_RESIZE_CORNER_SPAN;

  if ((nearNorth && withinWestCorner) || (nearWest && withinNorthCorner)) {
    return 'NorthWest';
  }
  if ((nearNorth && withinEastCorner) || (nearEast && withinNorthCorner)) {
    return 'NorthEast';
  }
  if ((nearSouth && withinWestCorner) || (nearWest && withinSouthCorner)) {
    return 'SouthWest';
  }
  if ((nearSouth && withinEastCorner) || (nearEast && withinSouthCorner)) {
    return 'SouthEast';
  }
  if (nearNorth) return 'North';
  if (nearSouth) return 'South';
  if (nearWest) return 'West';
  if (nearEast) return 'East';
  return null;
}
