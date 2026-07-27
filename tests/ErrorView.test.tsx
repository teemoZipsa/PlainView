/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorView from '../src/components/ErrorView';
import type { TFunction } from '../src/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key) => key;

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

describe('ErrorView', () => {
  it('offers recovery actions when callbacks are available', async () => {
    const onRetry = vi.fn();
    const onNext = vi.fn();
    const onReveal = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <ErrorView
          message="broken image"
          t={t}
          onRetry={onRetry}
          onNext={onNext}
          onReveal={onReveal}
          onClose={onClose}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual([
      'button.retry',
      'button.nextImage',
      'button.showInFolder',
      'button.close',
    ]);

    await act(async () => {
      buttons.forEach((button) => button.click());
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps recovery clicks out of the viewer drag surface', async () => {
    const onParentMouseDown = vi.fn();

    await act(async () => {
      root.render(
        <div onMouseDown={onParentMouseDown}>
          <ErrorView
            message="broken image"
            t={t}
            onRetry={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.error-action-btn.primary')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onParentMouseDown).not.toHaveBeenCalled();
  });
});
