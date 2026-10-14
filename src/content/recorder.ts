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

  private onChangeHandler(e: Event): void {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    if (!target) return;

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
      // 只暂存，不立即上报。等 change 或 blur 时决定是否上报。
      this.pendingInput = { el: target, value: target.value };
    }
  }

  private onBlurHandler(e: Event): void {
    const target = e.target as Element;
    if (!target) return;
    this.flushPendingInput();
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
}
