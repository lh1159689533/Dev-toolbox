import { RpaMessageType } from '../shared/rpa-types';
import { RpaLocatorEngine } from './locator';

/** 元素选择器：悬停高亮 + 点击选取（对齐 rocket-agent-plugin RpaElementPicker） */
export class RpaElementPicker {
  private isActive = false;
  private overlay: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private currentElement: Element | null = null;

  start(): void {
    if (this.isActive) return;
    this.isActive = true;

    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid #0052d9; background: rgba(0,82,217,0.1);
      transition: all 0.15s ease;
    `;
    document.body.appendChild(this.overlay);

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed; z-index: 2147483647; pointer-events: none;
      background: #333; color: #fff; padding: 4px 8px; border-radius: 4px;
      font-size: 12px; font-family: monospace; white-space: nowrap;
      max-width: 400px; overflow: hidden; text-overflow: ellipsis;
    `;
    document.body.appendChild(this.tooltip);

    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  stop(): void {
    this.isActive = false;
    this.overlay?.remove();
    this.tooltip?.remove();
    this.overlay = null;
    this.tooltip = null;
    this.currentElement = null;

    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  private onMouseMove = (e: MouseEvent): void => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === this.overlay || target === this.tooltip) return;

    this.currentElement = target;
    const rect = target.getBoundingClientRect();

    if (this.overlay) {
      this.overlay.style.left = rect.left + 'px';
      this.overlay.style.top = rect.top + 'px';
      this.overlay.style.width = rect.width + 'px';
      this.overlay.style.height = rect.height + 'px';
    }

    if (this.tooltip) {
      const selector = RpaLocatorEngine.generateCssSelector(target);
      this.tooltip.textContent = `${target.tagName.toLowerCase()} | ${selector}`;
      this.tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 400) + 'px';
      this.tooltip.style.top = e.clientY + 20 + 'px';
    }
  };

  private onClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (this.currentElement) {
      const locators = RpaLocatorEngine.generateLocators(this.currentElement);
      void chrome.runtime
        .sendMessage({
          type: RpaMessageType.ELEMENT_PICKED,
          payload: {
            locators,
            tagName: this.currentElement.tagName.toLowerCase(),
            text: this.currentElement.textContent?.trim().slice(0, 100) || '',
            attributes: this.getAttributes(this.currentElement),
          },
        })
        .catch(() => {
          // 忽略
        });
    }

    this.stop();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.stop();
      void chrome.runtime.sendMessage({ type: RpaMessageType.STOP_ELEMENT_PICKER }).catch(() => {});
    }
  };

  private getAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }
}
