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
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <SettingsModal
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

  it('closes on Escape without saving', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <SettingsModal
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
            initialSettings={initialSettings}
            t={t}
            onCancel={vi.fn()}
            onSave={vi.fn()}
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
});
