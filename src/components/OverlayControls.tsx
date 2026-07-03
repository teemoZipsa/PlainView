import React, { useCallback, useRef, useState } from 'react';
import type { BackgroundMode } from '../types';
import type { TFunction } from '../i18n';

interface ImageInfo {
  filePath: string | null;
  fileSize: number;
  width: number;
  height: number;
  originalExtension: string | null;
}

interface OverlayControlsProps {
  isVisible: boolean;
  isAlwaysOnTop: boolean;
  backgroundMode: BackgroundMode;
  currentIndex: number;
  totalImages: number;
  zoom: number;
  fileName: string;
  imageInfo: ImageInfo;
  t: TFunction;
  onClose: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoom: (zoom: number) => void;
  onOriginalSize: () => void;
  onFitScreen: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleBackgroundMode: () => void;
  onRotate: () => void;
  onOverlayEnter: () => void;
  onOverlayLeave: () => void;
}

const OverlayControls: React.FC<OverlayControlsProps> = ({
  isVisible,
  isAlwaysOnTop,
  backgroundMode,
  currentIndex,
  totalImages,
  zoom,
  fileName,
  imageInfo,
  t,
  onClose,
  onPrevImage,
  onNextImage,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  onOriginalSize,
  onFitScreen,
  onToggleAlwaysOnTop,
  onToggleBackgroundMode,
  onRotate,
  onOverlayEnter,
  onOverlayLeave,
}) => {
  const hasImage = Boolean(imageInfo.filePath) && totalImages > 0;
  const infoBarRef = useRef<HTMLDivElement>(null);
  const editSessionRef = useRef(false);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomDraft, setZoomDraft] = useState('');
  const [isInfoVisible, setIsInfoVisible] = useState(false);
  const [infoPopoverPosition, setInfoPopoverPosition] = useState({ left: 0, top: 0 });

  const handleButtonClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return t('overlay.unknown');
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    const precision = unitIndex === 0 || size >= 100 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  };

  const updateInfoPopoverPosition = useCallback(() => {
    const rect = infoBarRef.current?.getBoundingClientRect();
    if (!rect) return;

    const popoverWidth = Math.min(360, Math.max(220, window.innerWidth - 16));
    const minLeft = 8 + popoverWidth / 2;
    const maxLeft = window.innerWidth - 8 - popoverWidth / 2;
    const desiredLeft = rect.left + rect.width / 2;
    const left = Math.max(minLeft, Math.min(maxLeft, desiredLeft));
    const top = Math.max(8, rect.top - 8);

    setInfoPopoverPosition({ left, top });
  }, []);

  const startZoomEdit = (event: React.MouseEvent) => {
    event.stopPropagation();
    editSessionRef.current = true;
    setZoomDraft(`${Math.round(zoom * 100)}`);
    setIsEditingZoom(true);
  };

  const cancelZoomEdit = () => {
    editSessionRef.current = false;
    setIsEditingZoom(false);
    setZoomDraft('');
  };

  const commitZoomEdit = () => {
    if (!editSessionRef.current) return;
    editSessionRef.current = false;

    const normalized = zoomDraft.trim().replace(/%/g, '');
    const parsed = Number(normalized);
    setIsEditingZoom(false);
    setZoomDraft('');

    if (!normalized || !Number.isFinite(parsed)) return;

    const clampedPercent = Math.max(10, Math.min(1000, parsed));
    onSetZoom(clampedPercent / 100);
  };

  const showInfoPopover = () => {
    updateInfoPopoverPosition();
    setIsInfoVisible(true);
  };

  const hideInfoPopover = () => {
    setIsInfoVisible(false);
  };

  return (
    <div
      className={`overlay-container ${isVisible ? 'visible' : ''}`}
      onMouseEnter={onOverlayEnter}
      onMouseLeave={onOverlayLeave}
    >
      {/* Top-right: theme + pin + close */}
      <div className="overlay-top-right">
        <button
          type="button"
          className="overlay-btn theme-btn"
          onClick={(e) => handleButtonClick(e, onToggleBackgroundMode)}
          title={backgroundMode === 'dark' ? t('overlay.switchToLight') : t('overlay.switchToDark')}
          aria-label={backgroundMode === 'dark' ? t('overlay.switchToLight') : t('overlay.switchToDark')}
        >
          {backgroundMode === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 8.74 6.74A9 9 0 1 1 12 3z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={`overlay-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
          onClick={(e) => handleButtonClick(e, onToggleAlwaysOnTop)}
          title={isAlwaysOnTop ? t('overlay.unpin') : t('overlay.pin')}
          aria-label={isAlwaysOnTop ? t('overlay.unpinAria') : t('overlay.pinAria')}
          aria-pressed={isAlwaysOnTop}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isAlwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isAlwaysOnTop ? (
              /* Filled pin icon — active state */
              <>
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16h14v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1h1v4.76z" />
              </>
            ) : (
              /* Outline pin icon — inactive state */
              <>
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16h14v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1h1v4.76z" />
              </>
            )}
          </svg>
        </button>
        <button
          type="button"
          className="overlay-btn close-btn"
          onClick={(e) => handleButtonClick(e, onClose)}
          title={t('overlay.closeTitle')}
          aria-label={t('overlay.closeAria')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Left-center: prev */}
      {hasImage && totalImages > 1 && (
        <button
          type="button"
          className="overlay-btn nav-btn nav-left"
          onClick={(e) => handleButtonClick(e, onPrevImage)}
          title={t('overlay.previousTitle')}
          aria-label={t('overlay.previousAria')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Right-center: next */}
      {hasImage && totalImages > 1 && (
        <button
          type="button"
          className="overlay-btn nav-btn nav-right"
          onClick={(e) => handleButtonClick(e, onNextImage)}
          title={t('overlay.nextTitle')}
          aria-label={t('overlay.nextAria')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Bottom-center: zoom controls + rotate */}
      {hasImage && (
      <div className="overlay-bottom-center">
        <div className="overlay-bottom-row">
          <button
            type="button"
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onZoomOut)}
            title={t('overlay.zoomOutTitle')}
            aria-label={t('overlay.zoomOutAria')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {isEditingZoom ? (
            <input
              className="zoom-label zoom-input"
              value={zoomDraft}
              autoFocus
              inputMode="numeric"
              aria-label={t('overlay.zoomInputAria')}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setZoomDraft(event.target.value)}
              onBlur={commitZoomEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitZoomEdit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelZoomEdit();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="zoom-label zoom-label-button"
              title={t('overlay.zoomEditTitle')}
              aria-label={t('overlay.zoomEditAria')}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={startZoomEdit}
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
          <button
            type="button"
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onZoomIn)}
            title={t('overlay.zoomInTitle')}
            aria-label={t('overlay.zoomInAria')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="zoom-divider" />
          <button
            type="button"
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onOriginalSize)}
            title={t('overlay.originalSizeTitle')}
            aria-label={t('overlay.originalSizeAria')}
          >
            1:1
          </button>
          <button
            type="button"
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onFitScreen)}
            title={t('overlay.fitScreenTitle')}
            aria-label={t('overlay.fitScreenAria')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3" />
              <path d="M21 8V5a2 2 0 00-2-2h-3" />
              <path d="M3 16v3a2 2 0 002 2h3" />
              <path d="M16 21h3a2 2 0 002-2v-3" />
            </svg>
          </button>
          <button
            type="button"
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onRotate)}
            title={t('overlay.rotateTitle')}
            aria-label={t('overlay.rotateAria')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
        {/* File info bar */}
        <div
          ref={infoBarRef}
          className="overlay-info-bar"
          onMouseEnter={showInfoPopover}
          onMouseMove={updateInfoPopoverPosition}
          onMouseLeave={hideInfoPopover}
        >
          <span className="info-filename">{fileName}</span>
          {totalImages > 1 && (
            <span className="info-counter">{currentIndex + 1} / {totalImages}</span>
          )}
        </div>
      </div>
      )}
      {hasImage && isInfoVisible && (
        <div
          className="info-popover"
          style={{
            left: infoPopoverPosition.left,
            top: infoPopoverPosition.top,
          }}
        >
          <div className="info-popover-row">
            <span>{t('overlay.path')}</span>
            <strong title={imageInfo.filePath ?? ''}>{imageInfo.filePath || t('overlay.unknown')}</strong>
          </div>
          <div className="info-popover-row">
            <span>{t('overlay.dimensions')}</span>
            <strong>
              {imageInfo.width > 0 && imageInfo.height > 0
                ? `${imageInfo.width} x ${imageInfo.height}`
                : t('overlay.unknown')}
            </strong>
          </div>
          <div className="info-popover-row">
            <span>{t('overlay.fileSize')}</span>
            <strong>{formatFileSize(imageInfo.fileSize)}</strong>
          </div>
          <div className="info-popover-row">
            <span>{t('overlay.extension')}</span>
            <strong>{imageInfo.originalExtension || t('overlay.unknown')}</strong>
          </div>
          {totalImages > 1 && (
            <div className="info-popover-row">
              <span>{t('overlay.index')}</span>
              <strong>{currentIndex + 1} / {totalImages}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OverlayControls;
