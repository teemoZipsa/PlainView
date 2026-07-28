import type { TFunction } from '../i18n';

interface EmptyViewProps {
  t: TFunction;
  onOpenImage: () => void;
}

export default function EmptyView({ t, onOpenImage }: EmptyViewProps) {
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
    </div>
  );
}
