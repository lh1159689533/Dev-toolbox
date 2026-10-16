import { RpaMessageType } from '../shared/rpa-types';
import { RpaLocatorEngine } from './locator';

/** 录制器：捕获 DOM 事件并实时上报（对齐 rocket-agent-plugin RpaRecorder） */
export class RpaRecorder {
  private isRecording = false;
  private handlers: Array<{ event: string; handler: EventListener }> = [];
  // private indicator: HTMLDivElement | null = null;
  private eventCount = 0;
  /**
   * 跟踪已通过 change 事件上报的输入框，避免 input 事件重复上报。
   */
  private changedElements = new WeakSet<Element>();
  /**
   * 暂存最后一次 input 事件信息，用于兜底：
   * 如果某些框架不触发 change，在 blur 时手动 flush。
   */
  private pendingInput: { el: Element; value: string } | null = null;
  /** 滚动防抖定时器 */
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  /** SPA 导航录制：保存被 patch 的 history 原始方法 */
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;
  /** 导航去重：记录上次录制的 URL 与时间 */
  private lastNavigateUrl = '';
  private lastNavigateTime = 0;

  /** 每捕获一个事件后的计数回调（用于更新悬浮条等 UI） */
  onEventCounted?: (count: number) => void;

  get recording(): boolean {
    return this.isRecording;
  }

  get count(): number {
    return this.eventCount;
  }

  /** baseCount：续录时从 background 同步的已录事件数（跨页签续录时保持计数一致） */
  start(baseCount = 0): void {
    if (this.isRecording) return;
    this.isRecording = true;
    this.eventCount = baseCount;
    this.changedElements = new WeakSet<Element>();
    this.pendingInput = null;

    this.addHandler('click', this.onClickHandler.bind(this));
    this.addHandler('dblclick', this.onDblClickHandler.bind(this));
    this.addHandler('contextmenu', this.onContextMenuHandler.bind(this));
    this.addHandler('change', this.onChangeHandler.bind(this));
    // input 事件只做暂存，不直接上报（避免 debounce 产生大量中间值）
    this.addHandler('input', this.onInputHandler.bind(this));
    // blur 事件作为兜底：如果 change 没触发则 flush pending input
    this.addHandler('blur', this.onBlurHandler.bind(this));
    // 录制补全：键盘快捷键
    this.addHandler('keydown', this.onKeyDownHandler.bind(this));

    // 滚动：scroll 不冒泡，需在 window 捕获阶段监听 + 防抖
    window.addEventListener('scroll', this.onScrollHandler, true);

    // SPA 导航：patch history + 监听 popstate/hashchange
    this.patchHistory();
    window.addEventListener('popstate', this.onPopStateHandler);
    window.addEventListener('hashchange', this.onPopStateHandler);

    // this.showIndicator();
  }

  stop(): void {
    this.isRecording = false;
    // flush 未上报的 pending input
    this.flushPendingInput();
    for (const { event, handler } of this.handlers) {
      document.removeEventListener(event, handler, true);
    }
    this.handlers = [];

    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    window.removeEventListener('scroll', this.onScrollHandler, true);
    window.removeEventListener('popstate', this.onPopStateHandler);
    window.removeEventListener('hashchange', this.onPopStateHandler);
    this.restoreHistory();

    // this.hideIndicator();
  }

  // private showIndicator(): void {
  //   this.indicator = document.createElement('div');
  //   this.indicator.id = '__rpa-recording-indicator';
  //   this.indicator.style.cssText = `
  //     position: fixed; top: 8px; right: 8px; z-index: 2147483647;
  //     display: flex; align-items: center; gap: 6px;
  //     background: rgba(220, 38, 38, 0.9); color: #fff;
  //     padding: 6px 12px; border-radius: 20px;
  //     font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  //     box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none;
  //     animation: __rpa-pulse 1.5s ease-in-out infinite;
  //   `;
  //   this.indicator.innerHTML = `
  //     <span style="width:8px;height:8px;border-radius:50%;background:#fff;display:inline-block;"></span>
  //     <span>录制中</span>
  //     <span id="__rpa-event-count" style="opacity:0.8">0 事件</span>
  //   `;

  //   const style = document.createElement('style');
  //   style.id = '__rpa-recording-style';
  //   style.textContent = `
  //     @keyframes __rpa-pulse {
  //       0%, 100% { opacity: 1; }
  //       50% { opacity: 0.7; }
  //     }
  //   `;
  //   document.head.appendChild(style);
  //   document.body.appendChild(this.indicator);
  // }

  // private hideIndicator(): void {
  //   this.indicator?.remove();
  //   this.indicator = null;
  //   document.getElementById('__rpa-recording-style')?.remove();
  // }

  private addHandler(event: string, handler: EventListener): void {
    document.addEventListener(event, handler, true);
    this.handlers.push({ event, handler });
  }

  private onClickHandler(e: Event): void {
    const target = e.target as Element;
    if (!target) return;
    // 忽略发生在悬浮条（Shadow DOM）内部的点击：
    // Shadow DOM 事件 retargeting 会使 document 监听器看到 e.target 为宿主元素，
    // 若不过滤，点击悬浮条按钮（如「停止」）会被误录制为一条 click 步骤
    if (this.isFromFloatingBar(e)) return;

    let node: Element | null = target;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement;
    }

    this.sendEvent('click', target);
  }

  /** 判断事件是否来自扩展自身的悬浮条（事件路径中包含悬浮条宿主） */
  private isFromFloatingBar(e: Event): boolean {
    const path = (e as MouseEvent).composedPath?.() ?? [];
    return path.some((node) => node instanceof Element && node.hasAttribute('data-rpa-floating-bar'));
  }

  private onDblClickHandler(e: Event): void {
    const target = e.target as Element;
    if (!target) return;
    this.sendEvent('dblclick', target);
  }

  private onContextMenuHandler(e: Event): void {
    const target = e.target as Element;
    if (!target) return;
    this.sendEvent('contextmenu', target);
  }

  /** radio/checkbox 属于点选型 input：选中动作已由 click 事件录制，其 change/input 值（"on"/选项值）对回放无意义，不录 */
  private isCheckableInput(el: Element): boolean {
    return el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
  }

  private onChangeHandler(e: Event): void {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    if (!target) return;
    if (this.isCheckableInput(target)) return;

    if (target.tagName === 'SELECT') {
      this.sendEvent('select', target, `label=${(target as HTMLSelectElement).selectedOptions[0]?.text || ''}`);
    } else {
      // change 事件是输入框失焦时触发的最终值，作为 type 事件的权威来源
      this.changedElements.add(target);
      if (this.pendingInput?.el === target) {
        this.pendingInput = null;
      }
      this.sendEvent('change', target, target.value);
    }
  }

  private onInputHandler(e: Event): void {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target) return;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      if (this.isCheckableInput(target)) return;
      // 只暂存，不立即上报。等 change 或 blur 时决定是否上报。
      this.pendingInput = { el: target, value: target.value };
    }
  }

  private onBlurHandler(e: Event): void {
    const target = e.target as Element;
    if (!target) return;
    this.flushPendingInput();
  }

  /** 录制键盘快捷键：只录组合键（含修饰键）与功能键，普通字符输入交由 input/change 录制 */
  private onKeyDownHandler(e: Event): void {
    const ke = e as KeyboardEvent;
    if (ke.repeat) return;
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(ke.key)) return;

    const hasModifier = ke.metaKey || ke.ctrlKey || ke.altKey;
    const isFunctionKey =
      ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
        ke.key,
      ) || /^F\d{1,2}$/.test(ke.key);

    // 普通字符输入（无修饰键、非功能键）跳过
    if (!hasModifier && !isFunctionKey) return;

    const activeEl = document.activeElement;
    const targetEl =
      activeEl && activeEl !== document.body && activeEl !== document.documentElement
        ? (activeEl as Element)
        : document.body;

    // 功能键用 ${KEY_XXX} 格式；组合键用 MOD1+MOD2+KEY 格式
    let value: string;
    if (hasModifier) {
      const parts: string[] = [];
      if (ke.metaKey) parts.push('META');
      if (ke.ctrlKey) parts.push('CTRL');
      if (ke.altKey) parts.push('ALT');
      if (ke.shiftKey) parts.push('SHIFT');
      parts.push(ke.key);
      value = parts.join('+');
    } else {
      const keyMap: Record<string, string> = {
        Enter: '${KEY_ENTER}',
        Tab: '${KEY_TAB}',
        Escape: '${KEY_ESC}',
        Backspace: '${KEY_BACKSPACE}',
        Delete: '${KEY_DELETE}',
        ArrowUp: '${KEY_UP}',
        ArrowDown: '${KEY_DOWN}',
        ArrowLeft: '${KEY_LEFT}',
        ArrowRight: '${KEY_RIGHT}',
      };
      value = keyMap[ke.key] || ke.key;
    }

    this.sendEvent('keydown', targetEl, value);
  }

  /** 滚动防抖：停止滚动 300ms 后录制最终滚动位置 */
  private onScrollHandler = (e: Event): void => {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    // 在 setTimeout 外捕获滚动目标，避免 Event 对象在回调执行前被浏览器重置
    const target = e.target;
    this.scrollTimer = setTimeout(() => {
      // 整页滚动：scroll 事件的 target 是 document / documentElement
      if (target === document || target === document.documentElement) {
        const x = Math.round(window.scrollX);
        const y = Math.round(window.scrollY);
        if (x === 0 && y === 0) return;
        this.sendRawEvent('scroll', `${x},${y}`);
        return;
      }

      // 内部滚动容器（div/iframe 等 overflow 滚动）：记录容器的 scrollLeft/scrollTop
      if (target instanceof Element) {
        const x = Math.round(target.scrollLeft);
        const y = Math.round(target.scrollTop);
        if (x === 0 && y === 0) return;
        // 用 sendEvent 携带容器定位器，回放时定位到该容器设置滚动位置
        this.sendEvent('scroll', target, `${x},${y}`);
      }
    }, 300);
  };

  /** popstate / hashchange 触发导航录制 */
  private onPopStateHandler = (): void => {
    this.onNavigate();
  };

  /** 录制 SPA 路由导航（去重：同一 URL 1 秒内不重复） */
  private onNavigate(): void {
    const url = window.location.href;
    const now = Date.now();
    if (url === this.lastNavigateUrl && now - this.lastNavigateTime < 1000) return;
    this.lastNavigateUrl = url;
    this.lastNavigateTime = now;
    this.sendRawEvent('navigate', url);
  }

  /** patch history.pushState/replaceState，捕获 SPA 框架（React Router 等）触发的路由跳转 */
  private patchHistory(): void {
    if (this.originalPushState) return;
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;
    const originalPush = this.originalPushState;
    const originalReplace = this.originalReplaceState;
    const self = this;

    history.pushState = function pushState(this: History, ...args) {
      const result = originalPush.apply(this, args as Parameters<typeof history.pushState>);
      self.onNavigate();
      return result;
    } as typeof history.pushState;

    history.replaceState = function replaceState(this: History, ...args) {
      const result = originalReplace.apply(this, args as Parameters<typeof history.replaceState>);
      self.onNavigate();
      return result;
    } as typeof history.replaceState;
  }

  /** 恢复被 patch 的 history 方法 */
  private restoreHistory(): void {
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
  }

  /** 上报暂存的 input 事件（兜底：某些框架不触发 change） */
  private flushPendingInput(): void {
    if (!this.pendingInput) return;
    const { el, value } = this.pendingInput;
    this.pendingInput = null;
    if (this.changedElements.has(el)) return;
    if (value) {
      this.sendEvent('input', el, value);
    }
  }

  private sendEvent(type: string, el: Element, value?: string): void {
    const locators = RpaLocatorEngine.generateLocators(el);

    this.eventCount++;
    this.onEventCounted?.(this.eventCount);

    void chrome.runtime
      .sendMessage({
        type: RpaMessageType.RECORDING_EVENT,
        payload: {
          type,
          locators,
          value: value || '',
          timestamp: Date.now(),
          url: window.location.href,
        },
      })
      .catch(() => {
        // background 未监听时忽略
      });
  }

  /** 上报无 DOM 元素的事件（如页面滚动、SPA 导航） */
  private sendRawEvent(type: string, value: string): void {
    this.eventCount++;
    this.onEventCounted?.(this.eventCount);

    void chrome.runtime
      .sendMessage({
        type: RpaMessageType.RECORDING_EVENT,
        payload: {
          type,
          locators: [],
          value,
          timestamp: Date.now(),
          url: window.location.href,
        },
      })
      .catch(() => {
        // background 未监听时忽略
      });
  }
}
