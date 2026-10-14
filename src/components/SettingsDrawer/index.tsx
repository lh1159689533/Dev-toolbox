import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import SettingsForm from '../SettingsForm';
import { STORAGE_KEYS, storageGet, storageSet } from '../../shared/storage';
import './index.css';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/** 全局常驻设置入口：右下角浮动按钮 + 右侧滑出抽屉（支持拖动左边缘调整宽度） */
export default function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number>(380);
  const drawerRef = useRef<HTMLElement>(null);

  // 启动时从 chrome.storage 恢复上次的抽屉宽度
  useEffect(() => {
    void storageGet<number>(STORAGE_KEYS.drawerWidth).then((n) => {
      if (typeof n === 'number' && Number.isFinite(n) && n >= MIN_WIDTH) setWidth(n);
    });
  }, []);

  // 抽屉打开时锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleResizeStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerRef.current?.offsetWidth ?? width;

    const onMove = (ev: MouseEvent) => {
      const maxW = Math.min(MAX_WIDTH, window.innerWidth * 0.9);
      const next = clamp(startWidth + (startX - ev.clientX), MIN_WIDTH, maxW);
      if (drawerRef.current) drawerRef.current.style.width = `${next}px`;
    };

    const onUp = () => {
      const finalWidth = drawerRef.current?.offsetWidth ?? width;
      setWidth(finalWidth);
      void storageSet(STORAGE_KEYS.drawerWidth, finalWidth).catch(() => {
        /* ignore */
      });
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <>
      <button
        type="button"
        className="settings-fab"
        onClick={() => setOpen(true)}
        title="设置"
        aria-label="打开设置"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && <div className="drawer-mask" onClick={() => setOpen(false)} />}

      <aside
        ref={drawerRef}
        className={`settings-drawer${open ? ' open' : ''}`}
        style={{ width }}
        aria-hidden={!open}
      >
        <div className="drawer-resizer" onMouseDown={handleResizeStart} />
        <header className="drawer-header">
          <span>设置</span>
          <button type="button" className="drawer-close" onClick={() => setOpen(false)} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="drawer-body">
          <SettingsForm showJsonHistory />
        </div>
      </aside>
    </>
  );
}
