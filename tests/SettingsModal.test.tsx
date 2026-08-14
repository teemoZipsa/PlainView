/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsModal from '../src/components/SettingsModal';
import type { TFunction } from '../src/i18n';
import type { SettingsDraft } from '../src/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key) => key;
const initialSettings: SettingsDraft = {
  rememberWindowPosition: true,
  loopNavigation: true,
  defaultFitMode: 'auto',
  locale: 'system',
  overlayHideDelayMs: 2000,
};
const currentVersion = '0.7.7';
const currentRelease = {
  currentVersion,
  latestVersion: currentVersion,
  releaseUrl: 'https://github.com/teemoZipsa/PlainView/releases/tag/v0.7.7',
  updateAvailable: false,
  currentVersionAhead: false,
};

const updateProps = () => ({
  currentVersion,
  onCheckForUpdates: vi.fn(async () => currentRelease),
  onOpenRelease: vi.fn(),
  onOpenDefaultAppsSettings: vi.fn(),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  it('returns the edited viewer preferences', async () => {
    const onSave = vi.fn(async () => true);

    await act(async () => {
      root.render(
        <SettingsModal
          {...updateProps()}
          initialSettings={initialSettings}
          t={t}
          onCancel={vi.fn()}
          onSave={onSave}
        />
      );
    });

    const language = container.querySelector<HTMLSelectElement>('#settings-language');
    const fitMode = container.querySelector<HTMLSelectElement>('#settings-fit-mode');
    const delay = container.querySelector<HTMLSelectElement>('#settings-overlay-delay');
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    await act(async () => {
      if (!language || !fitMode || !delay) throw new Error('Missing settings controls.');
      language.value = 'ko';
      language.dispatchEvent(new Event('change', { bubbles: true }));
      fitMode.value = 'fit';
      fitMode.dispatchEvent(new Event('change', { bubbles: true }));
      delay.value = '4000';
      delay.dispatchEvent(new Event('change', { bubbles: true }));
      checkboxes[0].click();
      container.querySelector<HTMLButtonElement>('.app-modal-button.primary')?.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      rememberWindowPosition: true,
      loopNavigation: false,
      defaultFitMode: 'fit',
      locale: 'ko',
      overlayHideDelayMs: 4000,
    });
  });

  it('keeps the modal open and blocks cancellation while settings are saving', async () => {
    const onCancel = vi.fn();
    let finishSave: ((saved: boolean) => void) | undefined;
    const onSave = vi.fn(
      () => new Promise<boolean>((resolve) => {
        finishSave = resolve;
      })
    );

    await act(async () => {
      root.render(
        <SettingsModal
          {...updateProps()}
          initialSettings={initialSettings}
          t={t}
          onCancel={onCancel}
          onSave={onSave}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.app-modal-button.primary')?.click();
    });

    expect(container.querySelector('.settings-modal')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('.app-modal-button.secondary')?.disabled).toBe(true);

    await act(async () => {
      container
        .querySelector<HTMLElement>('.settings-modal')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => finishSave?.(false));
    expect(container.querySelector('.settings-modal')?.getAttribute('aria-busy')).toBe('false');
  });

  it('closes on Escape without saving', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn(async () => true);

    await act(async () => {
      root.render(
        <SettingsModal
          {...updateProps()}
          initialSettings={initialSettings}
          t={t}
          onCancel={onCancel}
          onSave={onSave}
        />
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>('.settings-modal')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps modal scrolling from changing viewer zoom', async () => {
    const onParentWheel = vi.fn();

    await act(async () => {
      root.render(
        <div onWheel={onParentWheel}>
          <SettingsModal
            {...updateProps()}
            initialSettings={initialSettings}
            t={t}
            onCancel={vi.fn()}
            onSave={vi.fn(async () => true)}
          />
        </div>
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>('.settings-modal')
        ?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });

    expect(onParentWheel).not.toHaveBeenCalled();
  });

  it('opens Windows Default Apps settings only when requested', async () => {
    const onOpenDefaultAppsSettings = vi.fn();

    await act(async () => {
      root.render(
        <SettingsModal
          {...updateProps()}
          initialSettings={initialSettings}
          t={t}
          onCancel={vi.fn()}
          onSave={vi.fn(async () => true)}
          onOpenDefaultAppsSettings={onOpenDefaultAppsSettings}
        />
      );
    });

    expect(onOpenDefaultAppsSettings).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.settings-default-apps-open')?.click();
    });

    expect(onOpenDefaultAppsSettings).toHaveBeenCalledTimes(1);
  });

  it('shows an available update and opens only the returned release URL', async () => {
    const result = {
      currentVersion,
      latestVersion: '0.7.8',
      releaseUrl: 'https://github.com/teemoZipsa/PlainView/releases/tag/v0.7.8',
      updateAvailable: true,
      currentVersionAhead: false,
    };
    const onCheckForUpdates = vi.fn(async () => result);
    const onOpenRelease = vi.fn();

    await act(async () => {
      root.render(
        <SettingsModal
          currentVersion={currentVersion}
          initialSettings={initialSettings}
          t={t}
          onCancel={vi.fn()}
          onSave={vi.fn(async () => true)}
          onCheckForUpdates={onCheckForUpdates}
          onOpenRelease={onOpenRelease}
          onOpenDefaultAppsSettings={vi.fn()}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.settings-update-check')?.click();
    });

    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.settings-update-status')?.textContent).toBe(
      'settings.updateAvailable'
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.settings-update-open')?.click();
    });

    expect(onOpenRelease).toHaveBeenCalledWith(result.releaseUrl);
  });

  it('keeps a failed update check inside the settings panel', async () => {
    await act(async () => {
      root.render(
        <SettingsModal
          currentVersion={currentVersion}
          initialSettings={initialSettings}
          t={t}
          onCancel={vi.fn()}
          onSave={vi.fn(async () => true)}
          onCheckForUpdates={vi.fn(async () => {
            throw new Error('offline');
          })}
          onOpenRelease={vi.fn()}
          onOpenDefaultAppsSettings={vi.fn()}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.settings-update-check')?.click();
    });

    expect(container.querySelector('.settings-update-status')?.textContent).toBe(
      'settings.updateFailed'
    );
    expect(container.querySelector('.settings-update-open')).toBeNull();
  });
});
