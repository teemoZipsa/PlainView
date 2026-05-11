import React from 'react';

interface OverlayControlsProps {
  isVisible: boolean;
  isAlwaysOnTop: boolean;
  currentIndex: number;
  totalImages: number;
  zoom: number;
  fileName: string;
  onClose: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOriginalSize: () => void;
  onFitScreen: () => void;
  onToggleAlwaysOnTop: () => void;
  onRotate: () => void;
  onOverlayEnter: () => void;
  onOverlayLeave: () => void;
}

const OverlayControls: React.FC<OverlayControlsProps> = ({
  isVisible,
  isAlwaysOnTop,
  currentIndex,
  totalImages,
  zoom,
  fileName,
  onClose,
  onPrevImage,
  onNextImage,
  onZoomIn,
  onZoomOut,
  onOriginalSize,
  onFitScreen,
  onToggleAlwaysOnTop,
  onRotate,
  onOverlayEnter,
  onOverlayLeave,
}) => {
  const handleButtonClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <div
      className={`overlay-container ${isVisible ? 'visible' : ''}`}
      onMouseEnter={onOverlayEnter}
      onMouseLeave={onOverlayLeave}
    >
      {/* Top-right: close + pin */}
      <div className="overlay-top-right">
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
          <span className="zoom-label" aria-live="polite">{Math.round(zoom * 100)}%</span>
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
        <div className="overlay-info-bar">
          <span className="info-filename" title={fileName}>{fileName}</span>
          {totalImages > 1 && (
            <span className="info-counter">{currentIndex + 1} / {totalImages}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverlayControls;
