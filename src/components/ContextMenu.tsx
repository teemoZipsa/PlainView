import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CustomOpenApp } from '../types';
import type { TFunction } from '../i18n';
import type { SubmenuDirection } from '../contextMenuGeometry';

interface ContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  submenuDirection: SubmenuDirection;
  submenuVerticalDirection: 'down' | 'up';
  customApps: CustomOpenApp[];
  t: TFunction;
  onCopyImage: () => void;
  onCopyFile: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
  onOpenDefault: () => void;
  onOpenWith: () => void;
  onMoveFile: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onShowProperties: () => void;
  onMoveToTrash: () => void;
  onOpenCustom: (app: CustomOpenApp) => void;
  onRegisterApp: () => void;
  onManageApps: () => void;
  onPrint: () => void;
}

export default function ContextMenu({
  menuRef,
  x,
  y,
  submenuDirection,
  submenuVerticalDirection,
  customApps,
  t,
  onCopyImage,
  onCopyFile,
  onCopyPath,
  onReveal,
  onOpenDefault,
  onOpenWith,
  onMoveFile,
  onSaveAs,
  onRename,
  onShowProperties,
  onMoveToTrash,
  onOpenCustom,
  onRegisterApp,
  onManageApps,
  onPrint,
}: ContextMenuProps) {
  const [openSections, setOpenSections] = useState({ open: false, files: false });
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const isStacked = submenuDirection === 'stacked';

  useEffect(() => {
    firstItemRef.current?.focus({ preventScroll: true });
  }, []);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.context-menu-item')
    ).filter((item) => item.offsetParent !== null && !item.disabled);
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = 0;
    if (event.key === 'End') {
      nextIndex = items.length - 1;
    } else if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    }
    items[nextIndex]?.focus();
  };

  const toggleSection = (section: 'open' | 'files') => {
    if (!isStacked) return;
    setOpenSections((current) =>
      section === 'open'
        ? { open: !current.open, files: false }
        : { open: false, files: !current.files }
    );
  };

  return (
    <div
      ref={menuRef}
      className={`context-menu ${submenuDirection === 'stacked' ? 'stacked' : ''} ${
        submenuVerticalDirection === 'up' ? 'submenu-up' : ''
      }`}
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        ref={firstItemRef}
        className="context-menu-item"
        type="button"
        role="menuitem"
        onClick={onCopyImage}
      >
        <span>{t('menu.copyImage')}</span>
        <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+C</kbd>
      </button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={onCopyFile}>
        <span>{t('menu.copyFile')}</span>
        <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+Shift+C</kbd>
      </button>

      <div className="context-menu-divider" />

      <div className={`context-menu-parent submenu-${submenuDirection}`}>
        <button
          className="context-menu-item"
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isStacked ? openSections.open : undefined}
          onClick={() => toggleSection('open')}
        >
          <span>{t('menu.open')}</span>
          <span className={`context-menu-arrow ${openSections.open ? 'open' : ''}`}>›</span>
        </button>
        <div
          className={`context-submenu ${submenuDirection} ${openSections.open ? 'is-open' : ''}`}
          role="menu"
        >
          <button className="context-menu-item" type="button" role="menuitem" onClick={onOpenDefault}>
            {t('menu.openDefault')}
          </button>
          <button className="context-menu-item" type="button" role="menuitem" onClick={onOpenWith}>
            {t('menu.openWith')}
          </button>
          <div className="context-menu-divider" />
          {customApps.length > 0 ? (
            customApps.map((app) => (
              <button
                key={app.id}
                className="context-menu-item"
                type="button"
                role="menuitem"
                title={app.executablePath}
                onClick={() => onOpenCustom(app)}
              >
                {app.name}
              </button>
            ))
          ) : (
            <div className="context-menu-item disabled">{t('menu.noCustomApps')}</div>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item" type="button" role="menuitem" onClick={onRegisterApp}>
            {t('menu.registerApp')}
          </button>
          <button
            className={`context-menu-item ${customApps.length === 0 ? 'disabled' : ''}`}
            type="button"
            role="menuitem"
            disabled={customApps.length === 0}
            onClick={onManageApps}
          >
            {t('menu.manageApps')}
          </button>
        </div>
      </div>

      <div className={`context-menu-parent submenu-${submenuDirection}`}>
        <button
          className="context-menu-item"
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isStacked ? openSections.files : undefined}
          onClick={() => toggleSection('files')}
        >
          <span>{t('menu.fileActions')}</span>
          <span className={`context-menu-arrow ${openSections.files ? 'open' : ''}`}>›</span>
        </button>
        <div
          className={`context-submenu ${submenuDirection} ${openSections.files ? 'is-open' : ''}`}
          role="menu"
        >
          <button className="context-menu-item" type="button" role="menuitem" onClick={onReveal}>
            {t('menu.reveal')}
          </button>
          <button className="context-menu-item" type="button" role="menuitem" onClick={onCopyPath}>
            {t('menu.copyPath')}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" type="button" role="menuitem" onClick={onSaveAs}>
            <span>{t('menu.saveAs')}</span>
            <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+S</kbd>
          </button>
          <button className="context-menu-item" type="button" role="menuitem" onClick={onMoveFile}>
            <span>{t('menu.moveFile')}</span>
            <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+M</kbd>
          </button>
          <button className="context-menu-item" type="button" role="menuitem" onClick={onRename}>
            <span>{t('menu.rename')}</span>
            <kbd className="context-menu-shortcut" aria-hidden="true">F2</kbd>
          </button>
          <button
            className="context-menu-item"
            type="button"
            role="menuitem"
            onClick={onShowProperties}
          >
            <span>{t('menu.properties')}</span>
            <kbd className="context-menu-shortcut" aria-hidden="true">Alt+Enter</kbd>
          </button>
          <button
            className="context-menu-item danger"
            type="button"
            role="menuitem"
            onClick={onMoveToTrash}
          >
            <span>{t('menu.moveToTrash')}</span>
            <kbd className="context-menu-shortcut" aria-hidden="true">Delete</kbd>
          </button>
        </div>
      </div>

      <button className="context-menu-item" type="button" role="menuitem" onClick={onPrint}>
        <span>{t('menu.print')}</span>
        <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+P</kbd>
      </button>
    </div>
  );
}
