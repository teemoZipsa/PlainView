import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { TFunction } from '../i18n';
import { checkForUpdates } from '../updateCheck';

interface SystemIntegrationOptions {
  currentVersion: string;
  t: TFunction;
  showError: (message: string) => void;
}

export function useSystemIntegration({
  currentVersion,
  t,
  showError,
}: SystemIntegrationOptions) {
  const checkForAppUpdates = useCallback(
    () => checkForUpdates(currentVersion),
    [currentVersion]
  );

  const openReleasePage = useCallback(
    (url: string) => {
      void openUrl(url).catch((error) => {
        console.warn('Failed to open release page:', error);
        showError(t('toast.releaseOpenFailed'));
      });
    },
    [showError, t]
  );

  const openDefaultAppsSettings = useCallback(() => {
    void invoke('open_default_apps_settings').catch((error) => {
      console.warn('Failed to open Windows Default Apps settings:', error);
      showError(t('toast.defaultAppsOpenFailed'));
    });
  }, [showError, t]);

  return {
    checkForAppUpdates,
    openReleasePage,
    openDefaultAppsSettings,
  };
}
