import type { RefObject } from 'react';
import type { CustomOpenApp } from '../types';

type SubmenuDirection = 'right' | 'left';

interface ContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  submenuDirection: SubmenuDirection;
  customApps: CustomOpenApp[];
  onReveal: () => void;
  onOpenDefault: () => void;
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
  customApps,
  onReveal,
  onOpenDefault,
  onOpenCustom,
  onRegisterApp,
  onRequestRemoveApp,
  onPrint,
}: ContextMenuProps) {
  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button className="context-menu-item" type="button" role="menuitem" onClick={onReveal}>
        탐색기에서 보기
      </button>
      <button className="context-menu-item" type="button" role="menuitem" onClick={onOpenDefault}>
        기본 앱으로 열기
      </button>

      <div className="context-menu-item context-menu-parent" role="menuitem" tabIndex={0}>
        <span>사용자 정의 앱으로 열기</span>
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
            <div className="context-menu-item disabled">등록된 앱 없음</div>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item" type="button" role="menuitem" onClick={onRegisterApp}>
            앱 등록...
          </button>
          <div className="context-menu-item context-menu-parent" role="menuitem" tabIndex={0}>
            <span>등록 앱 제거</span>
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
                <div className="context-menu-item disabled">제거할 앱 없음</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="context-menu-divider" />
      <button className="context-menu-item" type="button" role="menuitem" onClick={onPrint}>
        인쇄
      </button>
    </div>
  );
}
