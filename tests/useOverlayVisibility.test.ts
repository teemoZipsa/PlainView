import { describe, expect, it } from 'vitest';
import { getOverlayRegion } from '../src/hooks/useOverlayVisibility';

describe('getOverlayRegion', () => {
  const width = 1000;
  const height = 700;

  it('keeps ordinary movement in the image area HUDless', () => {
    expect(getOverlayRegion(500, 300, width, height)).toBe('none');
  });

  it('reveals only the navigation edge being approached', () => {
    expect(getOverlayRegion(40, 300, width, height)).toBe('left');
    expect(getOverlayRegion(960, 300, width, height)).toBe('right');
  });

  it('gives the top-right and bottom-center HUDs priority in their hot zones', () => {
    expect(getOverlayRegion(960, 40, width, height)).toBe('top-right');
    expect(getOverlayRegion(500, 660, width, height)).toBe('bottom');
  });
});
