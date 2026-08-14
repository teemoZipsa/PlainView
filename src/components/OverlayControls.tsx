import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OverlayRegion } from '../hooks/useOverlayVisibility';
import type { TFunction } from '../i18n';
import type { BackgroundMode } from '../types';
import { formatZoomPercent, isOriginalZoom, MAX_ZOOM, MIN_ZOOM } from '../zoom';

interface ImageInfo {
  filePath: string | null;
  fileSize: number;
  width: number;
  height: number;
  originalExtension: string | null;
}

interface OverlayControlsProps {
  activeRegion: OverlayRegion;
  feedbackDurationMs: number;
  isAlwaysOnTop: boolean;
  backgroundMode: BackgroundMode;
  currentIndex: number;
  totalImages: number;
  zoom: number;
  fileName: string;
  imageInfo: ImageInfo;
  t: TFunction;
  onMinimize: () => void;
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
  onOpenSettings: () => void;
  onRotate: () => void;
}

type FeedbackKind = 'zoom' | 'image';

const OverlayControls: React.FC<OverlayControlsProps> = ({
  activeRegion,
  feedbackDurationMs,
  isAlwaysOnTop,
  backgroundMode,
  currentIndex,
  totalImages,
  zoom,
  fileName,
  imageInfo,
  t,
  onMinimize,
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
  onOpenSettings,
  onRotate,
}) => {
  const hasImage = Boolean(imageInfo.filePath) && totalImages > 0;
  const statusRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const editSessionRef = useRef(false);
  const initialZoomDraftRef = useRef('');
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousZoomRef = useRef(zoom);
  const previousPathRef = useRef(imageInfo.filePath);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomDraft, setZoomDraft] = useState('');
  const [isBottomExpanded, setIsBottomExpanded] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);
  const [isInfoVisible, setIsInfoVisible] = useState(false);
  const [infoPopoverPosition, setInfoPopoverPosition] = useState({ left: 0, top: 0 });

  const clearFeedbackTimer = useCallback(() => {
    if (!feedbackTimerRef.current) return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  }, []);

  const showFeedback = useCallback(
    (kind: FeedbackKind) => {
      clearFeedbackTimer();
      setFeedbackKind(kind);
      const duration = Number.isFinite(feedbackDurationMs)
        ? Math.max(500, feedbackDurationMs)
        : 2000;
      feedbackTimerRef.current = setTimeout(
        () => setFeedbackKind(null),
        duration
      );
    },
    [clearFeedbackTimer, feedbackDurationMs]
  );

  useEffect(() => {
    if (previousZoomRef.current !== zoom && hasImage && activeRegion !== 'bottom') {
      showFeedback('zoom');
    }
    previousZoomRef.current = zoom;
  }, [activeRegion, hasImage, showFeedback, zoom]);

  useEffect(() => {
    if (previousPathRef.current !== imageInfo.filePath && hasImage) {
      showFeedback('image');
    }
    previousPathRef.current = imageInfo.filePath;
  }, [hasImage, imageInfo.filePath, showFeedback]);

  useEffect(() => {
    if (activeRegion !== 'bottom') {
      setIsBottomExpanded(false);
      setIsInfoVisible(false);
    }
    if (activeRegion !== 'top-right') {
      setIsMoreOpen(false);
    }
  }, [activeRegion]);

  useEffect(() => {
    if (!isMoreOpen) return;

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsMoreOpen(false);
      moreButtonRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isMoreOpen]);

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer]);

  const handleButtonClick = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  const handleMoreAction = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
    setIsMoreOpen(false);
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
    const rect = statusRef.current?.getBoundingClientRect();
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
    const draft = formatZoomPercent(zoom);
    initialZoomDraftRef.current = draft;
    setZoomDraft(draft);
    setIsEditingZoom(true);
  };

  const cancelZoomEdit = () => {
    editSessionRef.current = false;
    initialZoomDraftRef.current = '';
    setIsEditingZoom(false);
    setZoomDraft('');
  };

  const commitZoomEdit = () => {
    if (!editSessionRef.current) return;
    editSessionRef.current = false;

    const normalized = zoomDraft.trim().replace(/%/g, '');
    const parsed = Number(normalized);
    const isUnchanged = normalized === initialZoomDraftRef.current;
    initialZoomDraftRef.current = '';
    setIsEditingZoom(false);
    setZoomDraft('');

    if (!normalized || !Number.isFinite(parsed)) return;
    if (isUnchanged) {
      // Confirming an exact 100% is also an explicit request to recenter and
      // return to 1:1, even if the numeric value did not change.
      if (isOriginalZoom(zoom)) onSetZoom(1);
      return;
    }

    const clampedPercent = Math.max(
      MIN_ZOOM * 100,
      Math.min(MAX_ZOOM * 100, parsed)
    );
    onSetZoom(clampedPercent / 100);
  };

  const toggleBottomControls = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsBottomExpanded((current) => !current);
    setIsInfoVisible(false);
  };

  const showInfoPopover = () => {
    if (isBottomExpanded) return;
    updateInfoPopoverPosition();
    setIsInfoVisible(true);
  };

  return (
    <div className="overlay-container">
      <div className={`overlay-top-right ${activeRegion === 'top-right' ? 'is-visible' : ''}`}>
        <div className="overlay-window-controls">
          <button
            ref={moreButtonRef}
            type="button"
            className={`overlay-btn more-btn ${isMoreOpen ? 'active' : ''}`}
            title={t('overlay.moreTitle')}
            aria-label={t('overlay.moreAria')}
            aria-expanded={isMoreOpen}
            aria-controls="overlay-more-actions"
            onClick={(event) => {
              event.stopPropagation();
              setIsMoreOpen((current) => !current);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
          <button
            type="button"
            className="overlay-btn minimize-btn"
            onClick={(event) => handleButtonClick(event, onMinimize)}
            title={t('overlay.minimizeTitle')}
            aria-label={t('overlay.minimizeAria')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="6" y1="18" x2="18" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            className="overlay-btn close-btn"
            onClick={(event) => handleButtonClick(event, onClose)}
            title={t('overlay.closeTitle')}
            aria-label={t('overlay.closeAria')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isMoreOpen && (
          <div
            id="overlay-more-actions"
            className="overlay-more-actions"
            role="group"
            aria-label={t('overlay.moreAria')}
          >
            <button
              type="button"
              className="overlay-btn theme-btn"
              onClick={(event) => handleMoreAction(event, onToggleBackgroundMode)}
              title={
                backgroundMode === 'dark'
                  ? t('overlay.switchToLight')
                  : t('overlay.switchToDark')
              }
              aria-label={
                backgroundMode === 'dark'
                  ? t('overlay.switchToLight')
                  : t('overlay.switchToDark')
              }
            >
              {backgroundMode === 'dark' ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3a6 6 0 0 0 8.74 6.74A9 9 0 1 1 12 3z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className={`overlay-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
              onClick={(event) => handleMoreAction(event, onToggleAlwaysOnTop)}
              title={isAlwaysOnTop ? t('overlay.unpin') : t('overlay.pin')}
              aria-label={isAlwaysOnTop ? t('overlay.unpinAria') : t('overlay.pinAria')}
              aria-pressed={isAlwaysOnTop}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={isAlwaysOnTop ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16h14v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1h1v4.76z" />
              </svg>
            </button>
            <button
              type="button"
              className="overlay-btn settings-btn"
              onClick={(event) => handleMoreAction(event, onOpenSettings)}
              title={t('overlay.settingsTitle')}
              aria-label={t('overlay.settingsAria')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06-.06A1.7 1.7 0 0 0 19.4 9c.35.3.56.72.6 1.18V13.6h-.09A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {hasImage && totalImages > 1 && (
        <>
          <button
            type="button"
            className={`overlay-btn nav-btn nav-left ${
              activeRegion === 'left' ? 'is-visible' : ''
            }`}
            onClick={(event) => handleButtonClick(event, onPrevImage)}
            title={t('overlay.previousTitle')}
            aria-label={t('overlay.previousAria')}
          >
            <span className="nav-glyph" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            className={`overlay-btn nav-btn nav-right ${
              activeRegion === 'right' ? 'is-visible' : ''
            }`}
            onClick={(event) => handleButtonClick(event, onNextImage)}
            title={t('overlay.nextTitle')}
            aria-label={t('overlay.nextAria')}
          >
            <span className="nav-glyph" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </button>
        </>
      )}

      {hasImage && (
        <div
          className={`overlay-bottom-center ${
            activeRegion === 'bottom' ? 'is-visible' : ''
          } ${isBottomExpanded ? 'is-expanded' : ''}`}
        >
          {isBottomExpanded && (
            <div className="overlay-bottom-row">
              <button
                type="button"
                className="overlay-btn zoom-btn"
                onClick={(event) => handleButtonClick(event, onZoomOut)}
                title={t('overlay.zoomOutTitle')}
                aria-label={t('overlay.zoomOutAria')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {isEditingZoom ? (
                <input
                  className="zoom-label zoom-input"
                  value={zoomDraft}
                  autoFocus
                  inputMode="decimal"
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
                      event.stopPropagation();
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
                  {formatZoomPercent(zoom)}%
                </button>
              )}
              <button
                type="button"
                className="overlay-btn zoom-btn"
                onClick={(event) => handleButtonClick(event, onZoomIn)}
                title={t('overlay.zoomInTitle')}
                aria-label={t('overlay.zoomInAria')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <div className="zoom-divider" />
              <button
                type="button"
                className="overlay-btn zoom-btn"
                onClick={(event) => handleButtonClick(event, onOriginalSize)}
                title={t('overlay.originalSizeTitle')}
                aria-label={t('overlay.originalSizeAria')}
              >
                1:1
              </button>
              <button
                type="button"
                className="overlay-btn zoom-btn"
                onClick={(event) => handleButtonClick(event, onFitScreen)}
                title={t('overlay.fitScreenTitle')}
                aria-label={t('overlay.fitScreenAria')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 3H5a2 2 0 00-2 2v3" />
                  <path d="M21 8V5a2 2 0 00-2-2h-3" />
                  <path d="M3 16v3a2 2 0 002 2h3" />
                  <path d="M16 21h3a2 2 0 002-2v-3" />
                </svg>
              </button>
              <button
                type="button"
                className="overlay-btn zoom-btn"
                onClick={(event) => handleButtonClick(event, onRotate)}
                title={t('overlay.rotateTitle')}
                aria-label={t('overlay.rotateAria')}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
          )}

          <button
            ref={statusRef}
            type="button"
            className="overlay-status-button"
            aria-expanded={isBottomExpanded}
            aria-label={
              isBottomExpanded
                ? t('overlay.hideViewControls')
                : t('overlay.showViewControls')
            }
            title={
              isBottomExpanded
                ? t('overlay.hideViewControls')
                : t('overlay.showViewControls')
            }
            onClick={toggleBottomControls}
            onMouseEnter={showInfoPopover}
            onMouseMove={updateInfoPopoverPosition}
            onMouseLeave={() => setIsInfoVisible(false)}
          >
            <span className="status-zoom">{formatZoomPercent(zoom)}%</span>
            {totalImages > 1 && (
              <>
                <span className="status-separator" aria-hidden="true">·</span>
                <span className="info-counter">
                  {currentIndex + 1} / {totalImages}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {hasImage && feedbackKind && activeRegion !== 'bottom' && (
        <div className={`overlay-action-feedback ${feedbackKind}`} role="status" aria-live="polite">
          {feedbackKind === 'zoom' ? (
            <span>{formatZoomPercent(zoom)}%</span>
          ) : (
            <>
              <span className="feedback-filename">{fileName}</span>
              {totalImages > 1 && (
                <span className="feedback-counter">
                  {currentIndex + 1} / {totalImages}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {hasImage && isInfoVisible && activeRegion === 'bottom' && (
        <div
          className="info-popover"
          style={{
            left: infoPopoverPosition.left,
            top: infoPopoverPosition.top,
          }}
        >
          <div className="info-popover-row">
            <span>{t('overlay.path')}</span>
            <strong title={imageInfo.filePath ?? ''}>
              {imageInfo.filePath || t('overlay.unknown')}
            </strong>
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
              <strong>
                {currentIndex + 1} / {totalImages}
              </strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OverlayControls;
