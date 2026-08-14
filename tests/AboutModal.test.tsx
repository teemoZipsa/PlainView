/** @vitest-environment jsdom */

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutModal from '../src/components/AboutModal';
import type { TFunction } from '../src/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key, values) =>
  key === 'about.version' ? `${key}:${values?.version}` : key;

describe('AboutModal', () => {
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

  async function renderModal(onClose = vi.fn(), onParentMouseDown = vi.fn()) {
    const returnFocusRef = createRef<HTMLButtonElement>();
    const renderTree = (showModal: boolean) => (
      <>
        <button ref={returnFocusRef} type="button">
          viewer
        </button>
        <div onMouseDown={onParentMouseDown}>
          {showModal && (
            <AboutModal
              currentVersion="0.7.8"
              t={t}
              onClose={onClose}
            />
          )}
        </div>
      </>
    );

    await act(async () => {
      root.render(renderTree(true));
    });

    return {
      onClose,
      returnFocusRef,
    };
  }

  it('shows the app version, description, copyright, and license', async () => {
    const { onClose } = await renderModal();

    expect(container.querySelector('.about-title')?.textContent).toBe('about.title');
    expect(container.querySelector('.about-version')?.textContent).toBe(
      'about.version:0.7.8'
    );
    expect(container.querySelector('.about-description')?.textContent).toBe(
      'about.description'
    );
    expect(container.querySelector('.about-details')?.textContent).toContain(
      'about.copyright'
    );
    expect(container.querySelector('.about-details')?.textContent).toContain(
      'about.license'
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.about-modal button')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const { onClose } = await renderModal();

    await act(async () => {
      container
        .querySelector<HTMLElement>('.about-modal')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the modal', async () => {
    const { returnFocusRef } = await renderModal();
    const closeButton = container.querySelector<HTMLButtonElement>(
      '.about-modal button'
    );
    const returnTarget = returnFocusRef.current;

    expect(document.activeElement).toBe(closeButton);

    returnTarget?.focus();
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => returnTarget?.dispatchEvent(tabEvent));

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it('closes from the backdrop without bubbling into window dragging', async () => {
    const bubbledMouseDown = vi.fn();
    const { onClose } = await renderModal(vi.fn(), bubbledMouseDown);

    await act(async () => {
      container
        .querySelector<HTMLElement>('.modal-backdrop')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubbledMouseDown).not.toHaveBeenCalled();
  });
});
