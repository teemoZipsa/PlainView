import { useState } from 'react';
import type { TFunction } from '../i18n';
import type {
  FitMode,
  LocalePreference,
  SettingsDraft,
} from '../types';

interface SettingsModalProps {
  initialSettings: SettingsDraft;
  t: TFunction;
  onCancel: () => void;
  onSave: (settings: SettingsDraft) => void;
}

export default function SettingsModal({
  initialSettings,
  t,
  onCancel,
  onSave,
}: SettingsModalProps) {
  const [draft, setDraft] = useState(initialSettings);

  const updateDraft = <Key extends keyof SettingsDraft>(
    key: Key,
    value: SettingsDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="app-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        autoFocus
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <h2 id="settings-modal-title" className="app-modal-title">
          {t('settings.title')}
        </h2>
        <p className="app-modal-text">{t('settings.description')}</p>

        <div className="settings-form">
          <label className="settings-field" htmlFor="settings-language">
            <span>{t('settings.language')}</span>
            <select
              id="settings-language"
              className="settings-select"
              value={draft.locale}
              onChange={(event) =>
                updateDraft('locale', event.target.value as LocalePreference)
              }
            >
              <option value="system">{t('settings.languageSystem')}</option>
              <option value="ko">{t('settings.languageKorean')}</option>
              <option value="en">{t('settings.languageEnglish')}</option>
            </select>
          </label>

          <label className="settings-field" htmlFor="settings-fit-mode">
            <span>{t('settings.defaultView')}</span>
            <select
              id="settings-fit-mode"
              className="settings-select"
              value={draft.defaultFitMode}
              onChange={(event) =>
                updateDraft('defaultFitMode', event.target.value as FitMode)
              }
            >
              <option value="auto">{t('settings.viewAuto')}</option>
              <option value="fit">{t('settings.viewFit')}</option>
              <option value="original">{t('settings.viewOriginal')}</option>
            </select>
          </label>

          <label className="settings-field" htmlFor="settings-overlay-delay">
            <span>{t('settings.overlayDelay')}</span>
            <select
              id="settings-overlay-delay"
              className="settings-select"
              value={draft.overlayHideDelayMs}
              onChange={(event) =>
                updateDraft('overlayHideDelayMs', Number(event.target.value))
              }
            >
              <option value={1000}>{t('settings.delayOneSecond')}</option>
              <option value={2000}>{t('settings.delayTwoSeconds')}</option>
              <option value={4000}>{t('settings.delayFourSeconds')}</option>
            </select>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={draft.loopNavigation}
              onChange={(event) =>
                updateDraft('loopNavigation', event.target.checked)
              }
            />
            <span>
              <strong>{t('settings.loopNavigation')}</strong>
              <small>{t('settings.loopNavigationDescription')}</small>
            </span>
          </label>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={draft.rememberWindowPosition}
              onChange={(event) =>
                updateDraft('rememberWindowPosition', event.target.checked)
              }
            />
            <span>
              <strong>{t('settings.rememberWindow')}</strong>
              <small>{t('settings.rememberWindowDescription')}</small>
            </span>
          </label>
        </div>

        <div className="app-modal-actions">
          <button
            type="button"
            className="app-modal-button secondary"
            onClick={onCancel}
          >
            {t('button.cancel')}
          </button>
          <button
            type="button"
            className="app-modal-button primary"
            onClick={() => onSave(draft)}
          >
            {t('button.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
