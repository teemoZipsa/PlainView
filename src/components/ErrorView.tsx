import React from 'react';
import type { TFunction } from '../i18n';

interface ErrorViewProps {
  message: string;
  t: TFunction;
  onClose: () => void;
  onRetry?: () => void;
  onNext?: () => void;
  onReveal?: () => void;
}

const ErrorView: React.FC<ErrorViewProps> = ({
  message,
  t,
  onClose,
  onRetry,
  onNext,
  onReveal,
}) => {
  return (
    <div className="error-view" onMouseDown={(event) => event.stopPropagation()}>
      <div className="error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
          <line x1="4" y1="4" x2="20" y2="20" stroke="rgba(255,100,100,0.7)" strokeWidth="2" />
        </svg>
      </div>
      <p className="error-message">{message}</p>
      <div className="error-actions">
        {onRetry && (
          <button type="button" className="error-action-btn primary" onClick={onRetry}>
            {t('button.retry')}
          </button>
        )}
        {onNext && (
          <button type="button" className="error-action-btn" onClick={onNext}>
            {t('button.nextImage')}
          </button>
        )}
        {onReveal && (
          <button type="button" className="error-action-btn" onClick={onReveal}>
            {t('button.showInFolder')}
          </button>
        )}
        <button type="button" className="error-action-btn" onClick={onClose}>
          {t('button.close')}
        </button>
      </div>
    </div>
  );
};

export default ErrorView;
