export interface ImageData {
  base64: string;
  mimeType: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  originalExtension: string | null;
  width: number | null;
  height: number | null;
}

export type CommandErrorKind =
  | 'file_not_found'
  | 'target_not_folder'
  | 'same_folder'
  | 'no_association'
  | 'access_denied'
  | 'already_moving'
  | 'copy_failed'
  | 'remove_original_failed'
  | 'open_failed'
  | 'unknown';

export interface CommandError {
  kind: CommandErrorKind;
  message: string;
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
  customOpenApps: CustomOpenApp[];
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CustomOpenApp {
  id: string;
  name: string;
  executablePath: string;
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
  fileSize: number;
  originalExtension: string | null;
}
