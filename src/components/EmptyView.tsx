import type { TFunction } from '../i18n';

interface EmptyViewProps {
  t: TFunction;
  onOpenImage: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
}

export default function EmptyView({ t, onOpenImage, onOpenSettings, onOpenShortcuts }: EmptyViewProps) {
  return (
    <div
      className="empty-view"
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenImage();
      }}
    >
      <div className="empty-icon" aria-hidden="true">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
      <button
        type="button"
        className="empty-open-button"
        title={t('empty.openImageTitle')}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenImage();
        }}
      >
        {t('empty.openImage')}
      </button>
      <p className="empty-text">{t('empty.dragImage')}</p>
      <div className="empty-utilities" onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" className="empty-utility-button" onClick={onOpenSettings}
          title={t('shortcuts.settingsTitle')} aria-label={t('settings.title')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2.5" fill="var(--app-bg)" /><circle cx="15" cy="17" r="2.5" fill="var(--app-bg)" />
          </svg>
        </button>
        <button type="button" className="empty-utility-button" onClick={onOpenShortcuts}
          title={t('shortcuts.helpTitle')} aria-label={t('shortcuts.title')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
