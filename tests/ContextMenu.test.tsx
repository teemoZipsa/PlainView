/** @vitest-environment jsdom */

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from '../src/components/ContextMenu';
import type { TFunction } from '../src/i18n';
import type { CustomOpenApp } from '../src/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key) => key;
const customApps: CustomOpenApp[] = [
  {
    id: 'paint',
    name: 'Paint',
    executablePath: 'C:\\Windows\\System32\\mspaint.exe',
  },
];

const callbacks = () => ({
  onCopyImage: vi.fn(),
  onCopyFile: vi.fn(),
  onCopyPath: vi.fn(),
  onReveal: vi.fn(),
  onOpenDefault: vi.fn(),
  onOpenWith: vi.fn(),
  onMoveFile: vi.fn(),
  onSaveAs: vi.fn(),
  onRename: vi.fn(),
  onShowProperties: vi.fn(),
  onMoveToTrash: vi.fn(),
  onOpenCustom: vi.fn(),
  onRegisterApp: vi.fn(),
  onManageApps: vi.fn(),
  onPrint: vi.fn(),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement;
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderMenu(
  submenuDirection: 'right' | 'left' | 'stacked' = 'stacked',
  apps: CustomOpenApp[] = customApps,
  onParentWheel = vi.fn()
) {
  const handlers = callbacks();
  await act(async () => {
    root.render(
      <div onWheel={onParentWheel}>
        <ContextMenu
          menuRef={createRef<HTMLDivElement>()}
          x={8}
          y={8}
          submenuDirection={submenuDirection}
          submenuVerticalDirection="down"
          customApps={apps}
          t={t}
          {...handlers}
        />
      </div>
    );
  });
  return handlers;
}

function getRootButtons() {
  const menu = container.querySelector<HTMLElement>('.context-menu');
  if (!menu) throw new Error('Context menu was not rendered.');

  return Array.from(menu.children)
    .map((child) =>
      child.matches('button.context-menu-item')
        ? child
        : child.querySelector(':scope > button.context-menu-item')
    )
    .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement);
}

describe('ContextMenu', () => {
  it('keeps the root menu to five actions and exposes shortcut hints', async () => {
    await renderMenu();

    const rootButtons = getRootButtons();
    expect(rootButtons).toHaveLength(5);
    expect(rootButtons.map((button) => button.textContent)).toEqual([
      'menu.copyImageCtrl+C',
      'menu.copyFileCtrl+Shift+C',
      'menu.open›',
      'menu.fileActions›',
      'menu.printCtrl+P',
    ]);
    expect(container.querySelectorAll('.context-submenu.nested')).toHaveLength(0);
  });

  it('uses single-level accordions in a stacked small-window menu', async () => {
    await renderMenu('stacked');
    const [, , openButton, fileButton] = getRootButtons();
    const [openMenu, fileMenu] = Array.from(
      container.querySelectorAll<HTMLElement>('.context-submenu')
    );

    await act(async () => openButton.click());
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
    expect(openMenu.classList.contains('is-open')).toBe(true);

    await act(async () => fileButton.click());
    expect(openButton.getAttribute('aria-expanded')).toBe('false');
    expect(fileButton.getAttribute('aria-expanded')).toBe('true');
    expect(openMenu.classList.contains('is-open')).toBe(false);
    expect(fileMenu.classList.contains('is-open')).toBe(true);
  });

  it('focuses the first action and moves focus with ArrowDown', async () => {
    await renderMenu();
    const [firstButton, secondButton] = getRootButtons();
    const menu = container.querySelector<HTMLElement>('.context-menu');

    expect(document.activeElement).toBe(firstButton);
    await act(async () => {
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(secondButton);
  });

  it('keeps menu scrolling from bubbling into viewer zoom', async () => {
    const bubbledWheel = vi.fn();
    await renderMenu('stacked', customApps, bubbledWheel);
    const menu = container.querySelector<HTMLElement>('.context-menu');

    await act(async () => {
      menu?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });
    expect(bubbledWheel).not.toHaveBeenCalled();
  });

  it('disables registered-app management when no apps exist', async () => {
    await renderMenu('stacked', []);
    const manageButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'menu.manageApps'
    );

    expect(manageButton).toBeDefined();
    expect(manageButton?.disabled).toBe(true);
  });
});
