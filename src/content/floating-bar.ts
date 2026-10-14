import { STORAGE_KEYS } from '../shared/storage';

export type BarState = 'idle' | 'recording' | 'playing';

interface FloatingBarOptions {
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
  /** 点击「取点」按钮：启动元素选择器 */
  onPick: () => void;
}

interface BarPosition {
  x: number;
  y: number;
}

const POSITION_KEY = STORAGE_KEYS.rpaBarPosition;
const OPEN_ORIGINS_KEY = STORAGE_KEYS.rpaBarOpenOrigins;

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const STOP_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';

const STYLE = `
.wrap {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid oklch(88% 0.02 160);
  color: oklch(25% 0.02 160);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 4px 16px oklch(20% 0.02 160 / 20%);
  user-select: none;
  cursor: grab;
  touch-action: none;
}
.wrap.dragging { cursor: grabbing; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: oklch(50% 0.07 160); flex-shrink: 0; }
.dot.recording { background: #ef4444; animation: pulse 1s infinite; }
.dot.playing { background: #3b82f6; }
.icon-btn {
  border: none;
  background: oklch(50% 0.07 160);
  color: #fff;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-btn:hover:not(:disabled) { background: oklch(45% 0.07 160); }
.icon-btn:disabled { background: oklch(92% 0.04 160); color: oklch(70% 0.03 160); cursor: not-allowed; }
.btn.close {
  border: none;
  background: transparent;
  color: oklch(45% 0.07 160);
  padding: 0 4px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.btn.close:hover { color: oklch(30% 0.02 160); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
`;

/**
 * 页面悬浮控制条（Shadow DOM 隔离样式）。
 * 包含：状态圆点、状态文字、开始/停止/取点 icon（状态互斥）、关闭按钮。
 * 支持拖动，位置通过 chrome.storage 全局持久化。
 */
export class FloatingBar {
  private host: HTMLDivElement;
  private wrap: HTMLDivElement;
  private dot: HTMLElement;
  private status: HTMLElement;
  private startBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private flashTimer: number | null = null;
  private pos: BarPosition | null = null;
  private drag: { offsetX: number; offsetY: number } | null = null;

  constructor(private readonly opts: FloatingBarOptions) {
    this.host = document.createElement('div');
    this.host.style.cssText = 'display: none;';
    // 标识属性：供录制器过滤发生在悬浮条内部的点击（避免把点击悬浮条录制成操作步骤）
    this.host.setAttribute('data-rpa-floating-bar', '');
    const root = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    this.wrap = document.createElement('div');
    this.wrap.className = 'wrap';

    this.dot = document.createElement('span');
    this.dot.className = 'dot';

    this.status = document.createElement('span');
    this.status.textContent = '就绪';

    this.startBtn = document.createElement('button');
    this.startBtn.className = 'icon-btn';
    this.startBtn.innerHTML = PLAY_ICON;
    this.startBtn.setAttribute('aria-label', '开始录制');
    this.startBtn.setAttribute('title', '开始录制');
    this.startBtn.addEventListener('click', () => this.opts.onStart());

    this.stopBtn = document.createElement('button');
    this.stopBtn.className = 'icon-btn';
    this.stopBtn.innerHTML = STOP_ICON;
    this.stopBtn.setAttribute('aria-label', '停止录制');
    this.stopBtn.setAttribute('title', '停止录制');
    this.stopBtn.addEventListener('click', () => this.opts.onStop());

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.setAttribute('title', '关闭');
    closeBtn.addEventListener('click', () => {
      this.close();
      this.opts.onClose();
    });

    this.wrap.addEventListener('pointerdown', this.onPointerDown);
    this.wrap.append(this.dot, this.status, this.startBtn, this.stopBtn, closeBtn);
    root.appendChild(this.wrap);

    this.setState('idle');
    void this.loadPosition();
  }

  mount(): void {
    if (!this.host.parentNode) document.documentElement.appendChild(this.host);
  }

  show(): void {
    this.host.style.display = 'block';
    this.applyPosition();
    // 只要悬浮条出现，就记住当前域名处于「打开」状态（常驻）
    void this.persistOpenState(true);
  }

  hide(): void {
    this.host.style.display = 'none';
  }

  /** 关闭悬浮条：隐藏并记住当前域名为「关闭」状态（对称持久化） */
  close(): void {
    void this.persistOpenState(false);
    this.hide();
  }

  setState(state: BarState, detail?: string): void {
    this.dot.className = 'dot' + (state === 'idle' ? '' : ` ${state}`);
    if (state === 'recording') {
      this.status.textContent = detail ? `录制中 · ${detail}` : '录制中';
    } else if (state === 'playing') {
      this.status.textContent = detail ? `回放中 · ${detail}` : '回放中';
    } else {
      this.status.textContent = '就绪';
    }
    const busy = state !== 'idle';
    this.startBtn.disabled = busy;
    this.stopBtn.disabled = !busy;
  }

  /** 短暂显示一条提示信息，3 秒后恢复为「就绪」 */
  flash(message: string): void {
    this.dot.className = 'dot';
    this.status.textContent = message;
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.status.textContent = '就绪';
      this.flashTimer = null;
    }, 3000);
  }

  /** 读取已保存的悬浮条位置（全局，跨页面/会话） */
  private async loadPosition(): Promise<void> {
    try {
      const data = (await chrome.storage.local.get(POSITION_KEY)) as {
        [POSITION_KEY]?: BarPosition;
      };
      const saved = data[POSITION_KEY];
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        this.pos = { x: saved.x, y: saved.y };
      }
    } catch {
      // 读取失败时使用默认位置
    }
  }

  /** 将当前 pos 应用（并约束在视口内）到悬浮条 */
  private applyPosition(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = this.wrap.getBoundingClientRect();
    const w = rect.width || this.wrap.offsetWidth;
    const h = rect.height || this.wrap.offsetHeight;

    let x: number;
    let y: number;
    if (this.pos) {
      x = this.pos.x;
      y = this.pos.y;
    } else {
      // 默认右下角
      x = vw - w - 16;
      y = vh - h - 16;
    }
    x = Math.min(Math.max(x, 0), Math.max(0, vw - w));
    y = Math.min(Math.max(y, 0), Math.max(0, vh - h));
    this.pos = { x, y };

    this.wrap.style.left = `${x}px`;
    this.wrap.style.top = `${y}px`;
    this.wrap.style.right = 'auto';
    this.wrap.style.bottom = 'auto';
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    // 点击按钮时不做拖动（保留按钮自身的 click 行为）
    if (target && target.closest('button')) return;
    e.preventDefault();
    const rect = this.wrap.getBoundingClientRect();
    this.drag = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    this.wrap.classList.add('dragging');
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.pos = { x: e.clientX - this.drag.offsetX, y: e.clientY - this.drag.offsetY };
    this.applyPosition();
  };

  private onPointerUp = (): void => {
    if (!this.drag) return;
    this.drag = null;
    this.wrap.classList.remove('dragging');
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.savePosition();
  };

  private savePosition(): void {
    if (!this.pos) return;
    try {
      void chrome.storage.local.set({ [POSITION_KEY]: this.pos }).catch(() => {});
    } catch {
      // 存储失败时忽略
    }
  }

  /** 持久化当前域名的悬浮条打开状态（打开/关闭） */
  private async persistOpenState(open: boolean): Promise<void> {
    const origin = window.location.origin;
    try {
      const data = (await chrome.storage.local.get(OPEN_ORIGINS_KEY)) as {
        [OPEN_ORIGINS_KEY]?: string[];
      };
      const origins = new Set(data[OPEN_ORIGINS_KEY] ?? []);
      if (open) {
        origins.add(origin);
      } else {
        origins.delete(origin);
      }
      await chrome.storage.local.set({ [OPEN_ORIGINS_KEY]: [...origins] });
    } catch {
      // 存储失败时忽略
    }
  }
}

/** 判断当前域名是否处于「打开」状态（供页面加载时自动显示） */
export async function isBarOpenForCurrentOrigin(): Promise<boolean> {
  const origin = window.location.origin;
  try {
    const data = (await chrome.storage.local.get(OPEN_ORIGINS_KEY)) as {
      [OPEN_ORIGINS_KEY]?: string[];
    };
    return (data[OPEN_ORIGINS_KEY] ?? []).includes(origin);
  } catch {
    return false;
  }
}
