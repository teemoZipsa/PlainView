export interface ImageData {
  base64: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  width: number | null;
  height: number | null;
}

export interface Settings {
  rememberWindowPosition: boolean;
  alwaysOnTopDefault: boolean;
  loopNavigation: boolean;
  /** @future Stored for forward compatibility — not yet applied in UI. */
  backgroundMode: string;
  /** @future Stored for forward compatibility — not yet applied in UI. */
  defaultFitMode: string;
  lastWindowBounds: WindowBounds | null;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FitMode = 'auto' | 'fit' | 'original';
export type Rotation = 0 | 90 | 180 | 270;
export type DragMode = 'window-move' | 'image-pan' | 'none';

export interface ViewerState {
  currentFilePath: string | null;
  imageList: string[];
  currentIndex: number;
  zoom: number;
  rotation: Rotation;
  fitMode: FitMode;
  panOffset: { x: number; y: number };
  naturalSize: { width: number; height: number };
  isAlwaysOnTop: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  imageSrc: string | null;
  fileName: string;
}
