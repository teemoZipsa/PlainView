import type { TFunction, TranslationKey } from '../i18n';
import { useDialogFocus, type DialogFocusOptions } from '../hooks/useDialogFocus';
import { handleDialogKeyDown } from '../modalKeyboard';

const shortcuts: ReadonlyArray<readonly [TranslationKey, string]> = [
  ['empty.openImage', 'Ctrl+O'],
  ['shortcuts.navigate', '← / →'],
  ['shortcuts.firstLast', 'Home / End'],
  ['shortcuts.zoom', '+ / −'],
  ['overlay.originalSizeAria', '0'],
  ['overlay.fitScreenAria', 'F'],
  ['shortcuts.rotate', 'R'],
  ['shortcuts.fullscreen', 'F11'],
  ['shortcuts.escape', 'Esc'],
  ['menu.copy', 'Ctrl+C'],
  ['menu.saveAs', 'Ctrl+S'],
  ['menu.moveFile', 'Ctrl+M'],
  ['menu.rename', 'F2'],
  ['menu.properties', 'Alt+Enter'],
  ['menu.moveToTrash', 'Delete'],
  ['menu.print', 'Ctrl+P'],
  ['shortcuts.refresh', 'F5'],
  ['shortcuts.pin', 'T'],
  ['settings.title', 'Ctrl+,'],
  ['shortcuts.title', 'F1'],
  ['shortcuts.controls', 'F6 / Shift+F6'],
];

interface ShortcutsModalProps extends DialogFocusOptions {
  t: TFunction;
  onClose: () => void;
}

export default function ShortcutsModal({ t, onClose, ...focusOptions }: ShortcutsModalProps) {
  const dialogRef = useDialogFocus(focusOptions);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} className="app-modal shortcuts-modal" role="dialog" aria-modal="true"
        aria-labelledby="shortcuts-title" tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleDialogKeyDown(event, event.currentTarget, onClose)}>
        <div className="shortcuts-heading">
          <h2 id="shortcuts-title" className="app-modal-title">{t('shortcuts.title')}</h2>
          <button type="button" className="shortcuts-close" onClick={onClose}
            title={t('button.close')} aria-label={t('button.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <dl className="shortcuts-list" tabIndex={0} aria-label={t('shortcuts.title')}>
          {shortcuts.map(([label, keys]) => (
            <div className="shortcut-row" key={label}>
              <dt>{t(label)}</dt><dd><kbd>{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
