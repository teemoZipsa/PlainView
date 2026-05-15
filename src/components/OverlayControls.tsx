import React, { useCallback, useRef, useState } from 'react';
import type { BackgroundMode } from '../types';

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
    if (!Number.isFinite(bytes) || bytes <= 0) return '알 수 없음';
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
          className="overlay-btn theme-btn"
          onClick={(e) => handleButtonClick(e, onToggleBackgroundMode)}
          title={backgroundMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          aria-label={backgroundMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
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
          className={`overlay-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
          onClick={(e) => handleButtonClick(e, onToggleAlwaysOnTop)}
          title={isAlwaysOnTop ? '고정 해제 (T)' : '항상 위 고정 (T)'}
          aria-label={isAlwaysOnTop ? '항상 위 고정 해제' : '항상 위 고정'}
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
          className="overlay-btn close-btn"
          onClick={(e) => handleButtonClick(e, onClose)}
          title="닫기 (Esc)"
          aria-label="창 닫기"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Left-center: prev */}
      {totalImages > 1 && (
        <button
          className="overlay-btn nav-btn nav-left"
          onClick={(e) => handleButtonClick(e, onPrevImage)}
          title="이전 이미지 (←)"
          aria-label="이전 이미지"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Right-center: next */}
      {totalImages > 1 && (
        <button
          className="overlay-btn nav-btn nav-right"
          onClick={(e) => handleButtonClick(e, onNextImage)}
          title="다음 이미지 (→)"
          aria-label="다음 이미지"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Bottom-center: zoom controls + rotate */}
      <div className="overlay-bottom-center">
        <div className="overlay-bottom-row">
          <button
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onZoomOut)}
            title="축소 (-)"
            aria-label="축소"
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
              aria-label="확대 비율 입력"
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
              title="클릭하여 확대 비율 입력"
              aria-label="확대 비율 직접 입력"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={startZoomEdit}
            >
              {Math.round(zoom * 100)}%
            </button>
          )}
          <button
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onZoomIn)}
            title="확대 (+)"
            aria-label="확대"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="zoom-divider" />
          <button
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onOriginalSize)}
            title="원본 크기 (0)"
            aria-label="원본 크기"
          >
            1:1
          </button>
          <button
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onFitScreen)}
            title="화면 맞춤 (F)"
            aria-label="화면 맞춤"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3" />
              <path d="M21 8V5a2 2 0 00-2-2h-3" />
              <path d="M3 16v3a2 2 0 002 2h3" />
              <path d="M16 21h3a2 2 0 002-2v-3" />
            </svg>
          </button>
          <button
            className="overlay-btn zoom-btn"
            onClick={(e) => handleButtonClick(e, onRotate)}
            title="회전 (R)"
            aria-label="시계 방향 90도 회전"
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
      {isInfoVisible && (
        <div
          className="info-popover"
          style={{
            left: infoPopoverPosition.left,
            top: infoPopoverPosition.top,
          }}
        >
          <div className="info-popover-row">
            <span>경로</span>
            <strong title={imageInfo.filePath ?? ''}>{imageInfo.filePath || '알 수 없음'}</strong>
          </div>
          <div className="info-popover-row">
            <span>크기</span>
            <strong>
              {imageInfo.width > 0 && imageInfo.height > 0
                ? `${imageInfo.width} x ${imageInfo.height}`
                : '알 수 없음'}
            </strong>
          </div>
          <div className="info-popover-row">
            <span>파일 크기</span>
            <strong>{formatFileSize(imageInfo.fileSize)}</strong>
          </div>
          <div className="info-popover-row">
            <span>확장자</span>
            <strong>{imageInfo.originalExtension || '알 수 없음'}</strong>
          </div>
          {totalImages > 1 && (
            <div className="info-popover-row">
              <span>순번</span>
              <strong>{currentIndex + 1} / {totalImages}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OverlayControls;
