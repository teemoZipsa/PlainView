import type { RefObject } from 'react';
import type { CustomOpenApp } from '../types';
import type { TFunction } from '../i18n';

type SubmenuDirection = 'right' | 'left' | 'stacked';

interface ContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  submenuDirection: SubmenuDirection;
  submenuVerticalDirection: 'down' | 'up';
  customApps: CustomOpenApp[];
  t: TFunction;
  onCopyImage: () => void;
  onReveal: () => void;
  onOpenDefault: () => void;
  onMoveFile: () => void;
  onSaveAs: () => void;
  onMoveToTrash: () => void;
  onOpenCustom: (app: CustomOpenApp) => void;
  onRegisterApp: () => void;
  onRequestRemoveApp: (app: CustomOpenApp) => void;
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
  onReveal,
  onOpenDefault,
  onMoveFile,
  onSaveAs,
  onMoveToTrash,
  onOpenCustom,
  onRegisterApp,
  onRequestRemoveApp,
  onPrint,
}: ContextMenuProps) {
  return (
    <div
      ref={menuRef}
      className={`context-menu ${submenuDirection === 'stacked' ? 'stacked' : ''} ${
        submenuVerticalDirection === 'up' ? 'submenu-up' : ''
      }`}
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button className="context-menu-item" type="button" role="menuitem" onClick={onCopyImage}>
        {t('menu.copyImage')}
      </button>
      <div className="context-menu-divider" />
      <button className="context-menu-item" type="button" role="menuitem" onClick={onReveal}>
        {t('menu.reveal')}
      </button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={onOpenDefault}>
        {t('menu.openDefault')}
      </button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={onMoveFile}>
        {t('menu.moveFile')}
      </button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={onSaveAs}>
        {t('menu.saveAs')}
      </button>
      <button className="context-menu-item danger" type="button" role="menuitem" onClick={onMoveToTrash}>
        {t('menu.moveToTrash')}
      </button>

      <div className={`context-menu-item context-menu-parent submenu-${submenuDirection}`} role="menuitem" tabIndex={0}>
        <span>{t('menu.openCustom')}</span>
        <span className="context-menu-arrow">›</span>
        <div className={`context-submenu ${submenuDirection}`}>
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
          <div className={`context-menu-item context-menu-parent submenu-${submenuDirection}`} role="menuitem" tabIndex={0}>
            <span>{t('menu.removeRegisteredApp')}</span>
            <span className="context-menu-arrow">›</span>
            <div className={`context-submenu nested ${submenuDirection}`}>
              {customApps.length > 0 ? (
                customApps.map((app) => (
                  <button
                    key={app.id}
                    className="context-menu-item danger"
                    type="button"
                    role="menuitem"
                    title={app.executablePath}
                    onClick={() => onRequestRemoveApp(app)}
                  >
                    {app.name}
                  </button>
                ))
              ) : (
                <div className="context-menu-item disabled">{t('menu.noAppsToRemove')}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="context-menu-divider" />
      <button className="context-menu-item" type="button" role="menuitem" onClick={onPrint}>
        {t('menu.print')}
      </button>
    </div>
  );
}
