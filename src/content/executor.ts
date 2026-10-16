import { RpaLocatorEngine } from './locator';
import { PlaybackCursor } from './playback-cursor';

export interface CommandResult {
  success: boolean;
  error?: string;
  storedValue?: string;
}

/** 光标动画预留的缓冲时间（ms）：动画时长 = 步骤间隔 - 该值，保证动画在间隔内完成并留出停顿 */
const CURSOR_SETTLE_MS = 100;

/** 事件执行器：在页面内执行 RPA 事件（对齐 rocket-agent-plugin RpaCommandExecutor） */
export class RpaCommandExecutor {
  private timeout: number;
  private cursor?: PlaybackCursor;
  private lastCursorX = 0;
  private lastCursorY = 0;
  private cancelled = false;
  private paused = false;

  constructor(timeout = 10000, cursor?: PlaybackCursor) {
    this.timeout = timeout;
    this.cursor = cursor;
  }

  /** 取消当前正在执行的命令（停止回放时由 content script 触发） */
  cancel(): void {
    this.cancelled = true;
  }

  /** 暂停当前正在执行的命令（暂停回放时冻结等待元素轮询） */
  pause(): void {
    this.paused = true;
  }

  /** 恢复当前正在执行的命令 */
  resume(): void {
    this.paused = false;
  }

  /** 执行事件 */
  async execute(
    command: string,
    target: string,
    value: string,
    timeout?: number,
    delay?: number,
  ): Promise<CommandResult> {
    this.timeout = timeout || this.timeout;
    this.cancelled = false;
    this.paused = false;

    try {
      switch (command) {
        case 'click':
          return await this.doClick(target);
        case 'clickAt':
          return await this.doClickAt(target, value);
        case 'doubleClick':
          return await this.doDoubleClick(target);
        case 'rightClick':
          return await this.doRightClick(target);
        case 'type':
          return await this.doType(target, value);
        case 'sendKeys':
          return await this.doSendKeys(target, value);
        case 'select':
          return await this.doSelect(target, value);
        case 'mouseOver':
          return await this.doMouseOver(target);
        case 'scrollTo':
          return await this.doScrollTo(target, delay ?? 0);
        case 'scrollContainerTo':
          return await this.doScrollContainerTo(target, value, delay ?? 0);
        case 'scrollToElement':
          return await this.doScrollToElement(target);
        case 'dragAndDrop':
          return await this.doDragAndDrop(target, value);

        // 等待
        case 'waitForElementPresent':
          return await this.doWaitForElement(target, true);
        case 'waitForElementVisible':
          return await this.doWaitForElementVisible(target);
        case 'waitForElementNotPresent':
          return await this.doWaitForElement(target, false);

        // 验证
        case 'assertElementPresent':
        case 'verifyElementPresent':
          return this.doVerifyElementPresent(target);
        case 'assertText':
        case 'verifyText':
          return this.doVerifyText(target, value);
        case 'assertTitle':
        case 'verifyTitle':
          return this.doVerifyTitle(target);
        case 'assertValue':
        case 'verifyValue':
          return this.doVerifyValue(target, value);

        // 存储
        case 'storeText':
          return this.doStoreText(target);
        case 'storeValue':
          return this.doStoreValue(target);
        case 'storeTitle':
          return { success: true, storedValue: document.title };
        case 'storeAttribute':
          return this.doStoreAttribute(target, value);

        // 执行脚本
        case 'executeScript':
          return this.doExecuteScript(target);
        case 'executeAsyncScript':
          return await this.doExecuteAsyncScript(target);

        default:
          return { success: false, error: `Unknown command: ${command}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ------ 点击 ------

  private async doClick(target: string): Promise<CommandResult> {
    const el = await this.locateElement(target);

    // let node: Element | null = el;
    // for (let i = 0; i < 5 && node; i++) {
    //   node = node.parentElement;
    // }

    // 完整模拟真实点击的鼠标事件序列（mousedown → mouseup → click）：
    // 组件库（如 TDesign）基于 mousedown 实现"点击外部关闭下拉面板"，只派发 click 会导致面板无法关闭
    const rect = el.getBoundingClientRect();
    const mouseOpts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    // 模拟真实点击默认行为：点击可输入/可选择元素后使其获得焦点
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const dbg = (label: string): void =>
        console.log(
          `[RPA-debug:doClick] ${label} | hasFocus=${document.hasFocus()} | active=${
            (document.activeElement as HTMLElement | null)?.tagName
          } | isTarget=${document.activeElement === el}`,
        );
      dbg('before focus');
      if (!document.hasFocus()) {
        window.focus();
        dbg('after window.focus()');
      }
      el.focus();
      dbg('after focus (sync)');
      setTimeout(() => dbg('after focus (+200ms)'), 200);
    }
    el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    el.dispatchEvent(new MouseEvent('click', mouseOpts));
    this.cursor?.tap(this.lastCursorX, this.lastCursorY);
    return { success: true };
  }

  private async doClickAt(target: string, value: string): Promise<CommandResult> {
    const el = await this.locateElement(target);
    const rect = el.getBoundingClientRect();
    const [x, y] = value.split(',').map(Number);
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (x || 0),
        clientY: rect.top + (y || 0),
      }),
    );
    this.cursor?.tap(this.lastCursorX, this.lastCursorY);
    return { success: true };
  }

  private async doDoubleClick(target: string): Promise<CommandResult> {
    const el = await this.locateElement(target);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    this.cursor?.tap(this.lastCursorX, this.lastCursorY);
    return { success: true };
  }

  private async doRightClick(target: string): Promise<CommandResult> {
    const el = await this.locateElement(target);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    this.cursor?.tap(this.lastCursorX, this.lastCursorY);
    return { success: true };
  }

  // ------ 输入 ------

  private async doType(target: string, value: string): Promise<CommandResult> {
    const el = (await this.locateElement(target)) as HTMLInputElement | HTMLTextAreaElement;
    el.focus();

    // 根据元素实际类型选择对应的 value setter：
    // textarea 必须用 HTMLTextAreaElement 的 setter，否则品牌检查会抛 "Illegal invocation"
    const valueProto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(valueProto, 'value')?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  private async doSendKeys(target: string, value: string): Promise<CommandResult> {
    const el = await this.locateElement(target);
    (el as HTMLElement).focus();

    const keyMap: Record<string, string> = {
      '${KEY_ENTER}': 'Enter',
      '${KEY_TAB}': 'Tab',
      '${KEY_ESC}': 'Escape',
      '${KEY_BACKSPACE}': 'Backspace',
      '${KEY_DELETE}': 'Delete',
      '${KEY_UP}': 'ArrowUp',
      '${KEY_DOWN}': 'ArrowDown',
      '${KEY_LEFT}': 'ArrowLeft',
      '${KEY_RIGHT}': 'ArrowRight',
    };

    // 组合键语法：MOD1+MOD2+KEY，例如 CTRL+K、META+SHIFT+F（快捷键录制时生成）
    const parts = value.includes('+') && !value.startsWith('${') ? value.split('+').map((p) => p.trim()) : null;
    if (parts && parts.length > 1) {
      const key = keyMap[parts[parts.length - 1]] || parts[parts.length - 1];
      const upper = parts.map((p) => p.toUpperCase());
      const modifier = {
        metaKey: upper.includes('META') || upper.includes('CMD') || upper.includes('COMMAND'),
        ctrlKey: upper.includes('CTRL') || upper.includes('CONTROL'),
        altKey: upper.includes('ALT') || upper.includes('OPTION'),
        shiftKey: upper.includes('SHIFT'),
      };
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifier }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...modifier }));
      return { success: true };
    }

    const key = keyMap[value] || value;
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    return { success: true };
  }

  // ------ 选择 ------

  private async doSelect(target: string, value: string): Promise<CommandResult> {
    const el = (await this.locateElement(target)) as HTMLSelectElement;
    if (el.tagName !== 'SELECT') {
      return { success: false, error: 'Target is not a SELECT element' };
    }

    const match = value.match(/^(label|value|index)=(.+)$/);
    if (match) {
      const [, selectBy, selectVal] = match;
      if (selectBy === 'label') {
        const option = Array.from(el.options).find((o) => o.text === selectVal);
        if (option) el.value = option.value;
      } else if (selectBy === 'value') {
        el.value = selectVal;
      } else if (selectBy === 'index') {
        el.selectedIndex = parseInt(selectVal, 10);
      }
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  // ------ 鼠标 ------

  private async doMouseOver(target: string): Promise<CommandResult> {
    const el = await this.locateElement(target);
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { success: true };
  }

  // ------ 滚动 ------

  private async doScrollTo(target: string, duration: number): Promise<CommandResult> {
    const [x, y] = target.split(',').map(Number);
    await this.animateScroll(duration, window.scrollX, window.scrollY, x || 0, y || 0, (nx, ny) =>
      window.scrollTo(nx, ny),
    );
    return { success: true };
  }

  /** 滚动到内部容器指定位置：target 为容器定位器，value 为「scrollLeft,scrollTop」 */
  private async doScrollContainerTo(target: string, value: string, duration: number): Promise<CommandResult> {
    const el = await this.waitAndFind(target, false);
    const [x, y] = value.split(',').map(Number);
    await this.animateScroll(duration, el.scrollLeft, el.scrollTop, x || 0, y || 0, (nx, ny) => {
      el.scrollLeft = nx;
      el.scrollTop = ny;
    });
    return { success: true };
  }

  /**
   * 平滑滚动动画：用 rAF + easeInOutQuad 从 (fromX, fromY) 过渡到 (toX, toY)，
   * 每帧通过 apply 回调写入目标位置；时长 duration<=0 或位移为 0 时直接落到终点。
   * 返回 Promise，动画完成（或直接落地）时 resolve，保证回放下一步在滚动结束后执行。
   */
  private animateScroll(
    duration: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    apply: (x: number, y: number) => void,
  ): Promise<void> {
    if (duration <= 0 || (fromX === toX && fromY === toY)) {
      apply(toX, toY);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const startTime = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        apply(fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  private async doScrollToElement(target: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true };
  }

  // ------ 拖拽 ------

  private async doDragAndDrop(target: string, value: string): Promise<CommandResult> {
    const sourceEl = await this.locateElement(target);
    const destEl = RpaLocatorEngine.findUniqueElement(value);
    if (!destEl) return { success: false, error: 'Drop target not found' };

    const sourceRect = sourceEl.getBoundingClientRect();
    const destRect = destEl.getBoundingClientRect();

    const dataTransfer = new DataTransfer();
    sourceEl.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer,
        clientX: sourceRect.left + sourceRect.width / 2,
        clientY: sourceRect.top + sourceRect.height / 2,
      }),
    );
    destEl.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        dataTransfer,
        clientX: destRect.left + destRect.width / 2,
        clientY: destRect.top + destRect.height / 2,
      }),
    );
    sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));

    return { success: true };
  }

  // ------ 等待 ------

  private async doWaitForElement(target: string, shouldExist: boolean): Promise<CommandResult> {
    let deadline = Date.now() + this.timeout;

    while (Date.now() < deadline) {
      if (this.cancelled) throw new Error('回放已停止');
      deadline += await this.waitWhilePaused();
      const el = RpaLocatorEngine.findUniqueElement(target);
      if (shouldExist && el) return { success: true };
      if (!shouldExist && !el) return { success: true };
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      success: false,
      error: `Timeout waiting for element ${shouldExist ? 'present' : 'not present'}: ${target}`,
    };
  }

  private async doWaitForElementVisible(target: string): Promise<CommandResult> {
    let deadline = Date.now() + this.timeout;

    while (Date.now() < deadline) {
      if (this.cancelled) throw new Error('回放已停止');
      deadline += await this.waitWhilePaused();
      const el = RpaLocatorEngine.findUniqueElement(target) as HTMLElement;
      if (el && this.isVisibleForInteraction(el)) {
        return { success: true };
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    return { success: false, error: `Timeout waiting for element visible: ${target}` };
  }

  // ------ 验证 ------

  private doVerifyElementPresent(target: string): CommandResult {
    const el = RpaLocatorEngine.findUniqueElement(target);
    if (el) return { success: true };
    return { success: false, error: `Element not present: ${target}` };
  }

  private doVerifyText(target: string, expected: string): CommandResult {
    const el = RpaLocatorEngine.findUniqueElement(target);
    if (!el) return { success: false, error: `Element not found: ${target}` };
    const actual = el.textContent?.trim() || '';
    if (actual === expected) return { success: true };
    return { success: false, error: `Expected text "${expected}", got "${actual}"` };
  }

  private doVerifyTitle(expected: string): CommandResult {
    if (document.title === expected) return { success: true };
    return { success: false, error: `Expected title "${expected}", got "${document.title}"` };
  }

  private doVerifyValue(target: string, expected: string): CommandResult {
    const el = RpaLocatorEngine.findUniqueElement(target) as HTMLInputElement;
    if (!el) return { success: false, error: `Element not found: ${target}` };
    const actual = el.value || '';
    if (actual === expected) return { success: true };
    return { success: false, error: `Expected value "${expected}", got "${actual}"` };
  }

  // ------ 存储 ------

  private doStoreText(target: string): CommandResult {
    const el = RpaLocatorEngine.findUniqueElement(target);
    if (!el) return { success: false, error: `Element not found: ${target}` };
    return { success: true, storedValue: el.textContent?.trim() || '' };
  }

  private doStoreValue(target: string): CommandResult {
    const el = RpaLocatorEngine.findUniqueElement(target) as HTMLInputElement;
    if (!el) return { success: false, error: `Element not found: ${target}` };
    return { success: true, storedValue: el.value || '' };
  }

  private doStoreAttribute(target: string, attrName: string): CommandResult {
    const atMatch = target.match(/^(.+)@(\w+)$/);
    if (atMatch) {
      const [, locatorStr, attr] = atMatch;
      const el = RpaLocatorEngine.findUniqueElement(locatorStr);
      if (!el) return { success: false, error: `Element not found: ${locatorStr}` };
      return { success: true, storedValue: el.getAttribute(attr) || '' };
    }
    const el = RpaLocatorEngine.findUniqueElement(target);
    if (!el) return { success: false, error: `Element not found: ${target}` };
    return { success: true, storedValue: el.getAttribute(attrName) || '' };
  }

  // ------ 脚本 ------

  private doExecuteScript(script: string): CommandResult {
    try {
      // content script 运行在 isolated world，`new Function` 不受页面 CSP 约束；
      // 与页面共享 DOM，可操作元素、读取数据、触发事件，但无法访问页面的 window 全局变量。
      const result = new Function(script)();
      return { success: true, storedValue: this.serializeValue(result) };
    } catch (err) {
      return { success: false, error: `executeScript 执行失败: ${(err as Error).message}` };
    }
  }

  private async doExecuteAsyncScript(script: string): Promise<CommandResult> {
    try {
      // 将脚本包在 async IIFE 中执行，支持 await / 返回 Promise
      const result = await new Function(`return (async () => { ${script} })()`)();
      return { success: true, storedValue: this.serializeValue(result) };
    } catch (err) {
      return { success: false, error: `executeAsyncScript 执行失败: ${(err as Error).message}` };
    }
  }

  /** 将执行结果序列化为字符串（供 store 变量使用） */
  private serializeValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  // ------ 工具方法 ------

  /** 定位元素（统一入口：定位 → 滚动到视口 → 光标定位到元素） */
  private async locateElement(target: string): Promise<Element> {
    const el = await this.waitAndFind(target);
    this.scrollIntoView(el);
    this.snapCursor(el);
    return el;
  }

  /**
   * 预取：在 delay 间隙提前把光标动画移动到 target 元素（由 background 的 PRE_MOVE_CURSOR 触发）。
   * 动画时长 = delay - 100ms，在 delay 间隙内播完；下一步执行时光标已就位。
   */
  async preMoveCursor(target: string, delay: number): Promise<void> {
    if (!this.cursor) return;
    try {
      const el = await this.waitAndFind(target);
      this.scrollIntoView(el);
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      this.cursor.show();
      // 动画时间 = 步骤间隔 - 100ms
      const animationMs = Math.max(0, delay - CURSOR_SETTLE_MS);
      void this.cursor.moveTo(x, y, { animate: animationMs > 0, duration: animationMs });
    } catch {
      // 预取定位失败（元素未就绪等），静默忽略
    }
  }

  /** 光标直接定位（闪现）到元素中心（若预取动画已就位则为 no-op） */
  private snapCursor(el: Element): void {
    if (!this.cursor) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    this.lastCursorX = x;
    this.lastCursorY = y;
    this.cursor.show();
    void this.cursor.moveTo(x, y, { animate: false, duration: 0 });
  }

  /**
   * 暂停冻结：暂停期间阻塞等待，返回暂停消耗的时长（毫秒），
   * 调用方用其顺延超时时间；若期间被取消则抛错。
   */
  private async waitWhilePaused(): Promise<number> {
    if (!this.paused) return 0;
    const pauseStart = Date.now();
    while (this.paused && !this.cancelled) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.cancelled) throw new Error('回放已停止');
    return Date.now() - pauseStart;
  }

  private async waitAndFind(target: string, waitForVisible = true): Promise<Element> {
    let deadline = Date.now() + this.timeout;

    let el: Element | null = null;
    while (Date.now() < deadline) {
      if (this.cancelled) throw new Error('回放已停止');
      deadline += await this.waitWhilePaused();
      el = RpaLocatorEngine.findUniqueElement(target) as HTMLElement | null;
      if (el) {
        if (!waitForVisible) return el;

        if (this.isVisibleForInteraction(el)) {
          return el;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`未找到目标元素（超时 ${this.timeout}ms）：\n${this.diagnoseFindFailure(target)}`);
  }

  /**
   * 定位失败时生成诊断信息：逐个定位器说明「命中数量」与「可见性」，
   * 帮助用户区分三种失败原因——定位器失效（0 命中）、定位器不唯一（多命中）、
   * 元素存在但不可见（附 display/visibility/opacity/尺寸 具体原因）。
   */
  private diagnoseFindFailure(target: string): string {
    const locators = RpaLocatorEngine.parseTargets(target);
    const details = locators.map(({ type, value }) => {
      const matches = RpaLocatorEngine.findAll(type, value);
      if (matches.length === 1) {
        const el = matches[0];
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const reasons: string[] = [];
        if (style.display === 'none') reasons.push('display:none');
        if (style.visibility === 'hidden') reasons.push('visibility:hidden');
        if (style.opacity === '0') reasons.push('opacity:0');
        if (rect.width === 0 && rect.height === 0) reasons.push('宽高为0');
        if (reasons.length > 0) {
          return `· 命中 1 个但不可见（${reasons.join('、')}）: ${type}=${value}`;
        }
        return `· 命中 1 个且可见: ${type}=${value}`;
      }
      return `· 命中 ${matches.length} 个: ${type}=${value}`;
    });
    return details.length > 0 ? details.join('\n') : '（无可用的定位器）';
  }

  /**
   * 判断元素是否可见（可交互）。
   * 用 getBoundingClientRect 判断尺寸：SVG 元素没有 offsetWidth/offsetHeight（undefined），
   * 会导致可见元素被误判为不可见。
   *
   * 特例：radio/checkbox 的原生 input 被组件库（如 TDesign）用 `opacity: 0` 视觉隐藏、
   * 交互由关联的 label 代理，但仍可通过派发 click 事件正常触发选中，
   * 因此不校验 opacity 与尺寸，只排除真正脱离文档的 display:none / visibility:hidden。
   */
  private isVisibleForInteraction(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    const isCheckableInput = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
    if (isCheckableInput) return true;

    const rect = el.getBoundingClientRect();
    return style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  }

  private scrollIntoView(el: Element): void {
    const rect = el.getBoundingClientRect();
    const isInView =
      rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
    if (!isInView) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }
}
