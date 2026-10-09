import { useLayoutEffect, useRef } from 'react';
import type { TFunction } from '../i18n';

export interface ImageInfo {
  filePath: string | null;
  fileSize: number;
  width: number;
  height: number;
  originalExtension: string | null;
}

interface ImageInfoPanelProps {
  imageInfo: ImageInfo;
  fileName: string;
  currentIndex: number;
  totalImages: number;
  t: TFunction;
  onClose: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
}

export default function ImageInfoPanel({
  imageInfo, fileName, currentIndex, totalImages, t, onClose, onCopyPath, onReveal,
}: ImageInfoPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => closeRef.current?.focus({ preventScroll: true }), []);

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return t('overlay.unknown');
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 || size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
  };

  return (
    <section id="image-info-panel" className="image-info-panel" role="region"
      aria-labelledby="image-info-title" data-control-region="bottom"
      onWheel={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}>
      <div className="image-info-heading">
        <h2 id="image-info-title">{t('overlay.imageInfo')}</h2>
        <button ref={closeRef} type="button" className="image-info-close" onClick={onClose}
          title={t('button.close')} aria-label={t('button.close')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="image-info-body" tabIndex={0}>
        <p className="image-info-name">{fileName}</p>
        <label className="image-info-path-label" htmlFor="image-info-path">{t('overlay.path')}</label>
        <textarea id="image-info-path" className="image-info-path" readOnly rows={2}
          value={imageInfo.filePath ?? ''} onFocus={(event) => event.currentTarget.select()} />
        <dl className="image-info-details">
          <div><dt>{t('overlay.dimensions')}</dt><dd>{imageInfo.width > 0 && imageInfo.height > 0
            ? `${imageInfo.width} × ${imageInfo.height}` : t('overlay.unknown')}</dd></div>
          <div><dt>{t('overlay.fileSize')}</dt><dd>{formatFileSize(imageInfo.fileSize)}</dd></div>
          <div><dt>{t('overlay.extension')}</dt><dd>{imageInfo.originalExtension || t('overlay.unknown')}</dd></div>
          {totalImages > 1 && <div><dt>{t('overlay.index')}</dt><dd>{currentIndex + 1} / {totalImages}</dd></div>}
        </dl>
        <div className="image-info-actions">
          <button type="button" className="app-modal-button secondary" onClick={onCopyPath}>{t('menu.copyPath')}</button>
          <button type="button" className="app-modal-button secondary" onClick={onReveal}>{t('menu.reveal')}</button>
        </div>
      </div>
    </section>
  );
}
