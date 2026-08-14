/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDialogKeyDown } from '../src/modalKeyboard';

afterEach(() => {
  document.body.replaceChildren();
});

function createDialog() {
  const dialog = document.createElement('div');
  dialog.tabIndex = -1;
  const first = document.createElement('button');
  const last = document.createElement('button');
  dialog.append(first, last);
  document.body.append(dialog);
  return { dialog, first, last };
}

describe('handleDialogKeyDown', () => {
  it('wraps backwards from the first focusable control', () => {
    const { dialog, first, last } = createDialog();
    first.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
    });

    handleDialogKeyDown(event, dialog, vi.fn());

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('wraps forwards from the last focusable control', () => {
    const { dialog, first, last } = createDialog();
    last.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
    });

    handleDialogKeyDown(event, dialog, vi.fn());

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('closes and consumes Escape', () => {
    const { dialog } = createDialog();
    const onClose = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });

    handleDialogKeyDown(event, dialog, onClose);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
