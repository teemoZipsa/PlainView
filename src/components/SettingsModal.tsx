import { useRef, useState } from 'react';
import type { TFunction } from '../i18n';
import type {
  FitMode,
  LocalePreference,
  SettingsDraft,
} from '../types';
import type { UpdateCheckResult } from '../updateCheck';
import { handleDialogKeyDown } from '../modalKeyboard';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; result: UpdateCheckResult }
  | { kind: 'ahead'; result: UpdateCheckResult }
  | { kind: 'available'; result: UpdateCheckResult }
  | { kind: 'error' };

interface SettingsModalProps {
  initialSettings: SettingsDraft;
  currentVersion: string;
  t: TFunction;
  onCancel: () => void;
  onSave: (settings: SettingsDraft) => Promise<boolean>;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
  onOpenRelease: (url: string) => void;
  onOpenDefaultAppsSettings: () => void;
}

export default function SettingsModal({
  initialSettings,
  currentVersion,
  t,
  onCancel,
  onSave,
  onCheckForUpdates,
  onOpenRelease,
  onOpenDefaultAppsSettings,
}: SettingsModalProps) {
  const [draft, setDraft] = useState(initialSettings);
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: 'idle' });
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const updateDraft = <Key extends keyof SettingsDraft>(
    key: Key,
    value: SettingsDraft[Key]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleCheckForUpdates = async () => {
    setUpdateState({ kind: 'checking' });
    try {
      const result = await onCheckForUpdates();
      setUpdateState({
        kind: result.updateAvailable
          ? 'available'
          : result.currentVersionAhead
            ? 'ahead'
            : 'current',
        result,
      });
    } catch {
      setUpdateState({ kind: 'error' });
    }
  };

  const requestCancel = () => {
    if (!isSavingRef.current) onCancel();
  };

  const handleSave = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    const saved = await onSave(draft).catch(() => false);
    if (!saved) {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={requestCancel}>
      <div
        className="app-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        aria-busy={isSaving}
        tabIndex={-1}
        autoFocus
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onKeyDown={(event) =>
          handleDialogKeyDown(event, event.currentTarget, requestCancel)
        }
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
              disabled={isSaving}
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
              disabled={isSaving}
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
              disabled={isSaving}
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
              disabled={isSaving}
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
              disabled={isSaving}
              onChange={(event) =>
                updateDraft('rememberWindowPosition', event.target.checked)
              }
            />
            <span>
              <strong>{t('settings.rememberWindow')}</strong>
              <small>{t('settings.rememberWindowDescription')}</small>
            </span>
          </label>

          <section
            className="settings-panel settings-default-apps"
            aria-labelledby="settings-default-apps-title"
          >
            <div className="settings-panel-copy">
              <strong id="settings-default-apps-title">
                {t('settings.defaultAppsTitle')}
              </strong>
              <small>{t('settings.defaultAppsDescription')}</small>
            </div>
            <div className="settings-panel-actions">
              <button
                type="button"
                className="app-modal-button secondary settings-default-apps-open"
                disabled={isSaving}
                onClick={onOpenDefaultAppsSettings}
              >
                {t('settings.openDefaultApps')}
              </button>
            </div>
          </section>

          <section
            className="settings-panel settings-update"
            aria-labelledby="settings-update-title"
          >
            <div className="settings-panel-copy">
              <strong id="settings-update-title">{t('settings.updateTitle')}</strong>
              <small>
                {t('settings.currentVersion', { version: currentVersion })}
              </small>
            </div>

            <div
              className={`settings-update-status status-${updateState.kind}`}
              role={updateState.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {updateState.kind === 'idle' && t('settings.updateIdle')}
              {updateState.kind === 'checking' && t('settings.updateChecking')}
              {updateState.kind === 'current' &&
                t('settings.updateCurrent', {
                  version: updateState.result.latestVersion,
                })}
              {updateState.kind === 'ahead' &&
                t('settings.updateAhead', {
                  version: updateState.result.latestVersion,
                })}
              {updateState.kind === 'available' &&
                t('settings.updateAvailable', {
                  version: updateState.result.latestVersion,
                })}
              {updateState.kind === 'error' && t('settings.updateFailed')}
            </div>

            <div className="settings-panel-actions">
              <button
                type="button"
                className="app-modal-button secondary settings-update-check"
                disabled={isSaving || updateState.kind === 'checking'}
                onClick={() => void handleCheckForUpdates()}
              >
                {updateState.kind === 'checking'
                  ? t('settings.updateCheckingButton')
                  : t('settings.checkForUpdates')}
              </button>
              {updateState.kind === 'available' && (
                <button
                  type="button"
                  className="app-modal-button primary settings-update-open"
                  disabled={isSaving}
                  onClick={() => onOpenRelease(updateState.result.releaseUrl)}
                >
                  {t('settings.openRelease')}
                </button>
              )}
            </div>
          </section>
        </div>

        <div className="app-modal-actions">
          <button
            type="button"
            className="app-modal-button secondary"
            disabled={isSaving}
            onClick={requestCancel}
          >
            {t('button.cancel')}
          </button>
          <button
            type="button"
            className="app-modal-button primary"
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {t('button.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
