import { useEffect, useRef } from 'react';
import type { TFunction } from '../i18n';

interface AboutModalProps {
  currentVersion: string;
  t: TFunction;
  onClose: () => void;
}

export default function AboutModal({
  currentVersion,
  t,
  onClose,
}: AboutModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeButtonRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="app-modal compact about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        aria-describedby="about-modal-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="about-heading">
          <div className="about-icon" aria-hidden="true">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <div>
            <h2 id="about-modal-title" className="about-title">
              {t('about.title')}
            </h2>
            <p className="about-version">
              {t('about.version', { version: currentVersion })}
            </p>
          </div>
        </div>

        <p id="about-modal-description" className="about-description">
          {t('about.description')}
        </p>

        <div className="about-details">
          <span>{t('about.copyright')}</span>
          <span>{t('about.license')}</span>
        </div>

        <div className="app-modal-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="app-modal-button primary"
            autoFocus
            onClick={onClose}
          >
            {t('button.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
