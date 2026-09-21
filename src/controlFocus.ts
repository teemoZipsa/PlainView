export type ControlRegion = 'viewer' | 'top-right' | 'bottom';

export interface ControlFocusRequest {
  region: Exclude<ControlRegion, 'viewer'>;
  sequence: number;
}

export function nextControlRegion(current: ControlRegion, hasImage: boolean, backwards: boolean): ControlRegion {
  const regions: ControlRegion[] = hasImage ? ['viewer', 'top-right', 'bottom'] : ['viewer', 'top-right'];
  const index = Math.max(0, regions.indexOf(current));
  return regions[(index + (backwards ? -1 : 1) + regions.length) % regions.length];
}
