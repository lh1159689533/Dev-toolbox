import type { PageToastKind } from '../shared/rpa-types';

const THEMES: Record<PageToastKind, { bg: string }> = {
  success: { bg: 'rgba(43, 164, 113, 0.95)' },
  error: { bg: 'rgba(213, 73, 65, 0.95)' },
  info: { bg: 'rgba(0, 82, 217, 0.92)' },
  picking: { bg: 'rgba(0, 82, 217, 0.92)' },
};

/**
 * 页面右下角 Toast 提示（对齐回放指示器的视觉风格）。
 * success/info 5 秒后自动消失；error 常驻并显示关闭按钮；picking 常驻（等待流程替换）。
 */
export class PageToast {
  private container: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  show(text: string, kind: PageToastKind): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    if (!this.container) this.create();

    if (this.textEl) this.textEl.textContent = text;

    const theme = THEMES[kind] || THEMES.info;
    if (this.container) {
      this.container.style.background = theme.bg;
      // 仅错误 Toast 需要交互（点击关闭按钮），其余不拦截页面事件
      this.container.style.pointerEvents = kind === 'error' ? 'auto' : 'none';
    }

    if (this.closeBtn) {
      this.closeBtn.style.display = kind === 'error' ? 'block' : 'none';
    }

    if (kind === 'success' || kind === 'info') {
      this.autoHideTimer = setTimeout(() => this.hide(), 5000);
    }
  }

  hide(): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (this.container) {
      this.container.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      this.container.style.opacity = '0';
      this.container.style.transform = 'translateY(8px)';
      setTimeout(() => {
        this.container?.remove();
        this.container = null;
        this.textEl = null;
        this.closeBtn = null;
      }, 300);
    }
  }

  private create(): void {
    this.container = document.createElement('div');
    this.container.id = '__rpa-page-toast';
    this.container.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
      display: flex; align-items: center; gap: 8px;
      max-width: 360px; padding: 10px 14px; border-radius: 10px;
      color: #fff; font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      line-height: 1.4;
      transition: opacity 0.3s ease, transform 0.3s ease;
    `;

    this.textEl = document.createElement('span');
    this.textEl.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    this.container.appendChild(this.textEl);

    this.closeBtn = document.createElement('button');
    this.closeBtn.setAttribute('aria-label', '关闭');
    this.closeBtn.textContent = '×';
    this.closeBtn.style.cssText = `
      display:none; border:none; background:transparent; cursor:pointer;
      padding:0 2px; font-size:16px; line-height:1; color:inherit; opacity:0.75;
    `;
    this.closeBtn.addEventListener('click', () => this.hide());
    this.container.appendChild(this.closeBtn);

    document.body.appendChild(this.container);
  }
}
