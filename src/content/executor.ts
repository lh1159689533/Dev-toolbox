import { RpaLocatorEngine } from './locator';

export interface CommandResult {
  success: boolean;
  error?: string;
  storedValue?: string;
}

/** 事件执行器：在页面内执行 RPA 事件（对齐 rocket-agent-plugin RpaCommandExecutor） */
export class RpaCommandExecutor {
  private timeout: number;

  constructor(timeout = 10000) {
    this.timeout = timeout;
  }

  /** 执行事件 */
  async execute(command: string, target: string, value: string, timeout?: number): Promise<CommandResult> {
    this.timeout = timeout || this.timeout;

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
          return this.doScrollTo(target);
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

        default:
          return { success: false, error: `Unknown command: ${command}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ------ 点击 ------

  private async doClick(target: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
    this.scrollIntoView(el);

    let node: Element | null = el;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement;
    }

    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { success: true };
  }

  private async doClickAt(target: string, value: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
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
    return { success: true };
  }

  private async doDoubleClick(target: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
    this.scrollIntoView(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return { success: true };
  }

  private async doRightClick(target: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
    this.scrollIntoView(el);
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    return { success: true };
  }

  // ------ 输入 ------

  private async doType(target: string, value: string): Promise<CommandResult> {
    const el = (await this.waitAndFind(target)) as HTMLInputElement | HTMLTextAreaElement;
    this.scrollIntoView(el);
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
    const el = await this.waitAndFind(target);
    this.scrollIntoView(el);
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

    const key = keyMap[value] || value;
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    return { success: true };
  }

  // ------ 选择 ------

  private async doSelect(target: string, value: string): Promise<CommandResult> {
    const el = (await this.waitAndFind(target)) as HTMLSelectElement;
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
    const el = await this.waitAndFind(target);
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return { success: true };
  }

  // ------ 滚动 ------

  private doScrollTo(target: string): CommandResult {
    const [x, y] = target.split(',').map(Number);
    window.scrollTo(x || 0, y || 0);
    return { success: true };
  }

  private async doScrollToElement(target: string): Promise<CommandResult> {
    const el = await this.waitAndFind(target);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true };
  }

  // ------ 拖拽 ------

  private async doDragAndDrop(target: string, value: string): Promise<CommandResult> {
    const sourceEl = await this.waitAndFind(target);
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
    const deadline = Date.now() + this.timeout;

    while (Date.now() < deadline) {
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
    const deadline = Date.now() + this.timeout;

    while (Date.now() < deadline) {
      const el = RpaLocatorEngine.findUniqueElement(target) as HTMLElement;
      if (el) {
        const style = window.getComputedStyle(el);
        // 同 waitAndFind：用 getBoundingClientRect 兼容 SVG 元素
        const rect = el.getBoundingClientRect();
        if (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          return { success: true };
        }
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

  private doExecuteScript(_script: string): CommandResult {
    // 注意：CSP 限制，不能用 eval；与参考项目保持一致，返回不支持提示
    return {
      success: false,
      error: 'executeScript requires page context injection (not yet implemented)',
    };
  }

  // ------ 工具方法 ------

  private async waitAndFind(target: string, waitForVisible = true): Promise<Element> {
    const deadline = Date.now() + this.timeout;

    while (Date.now() < deadline) {
      const el = RpaLocatorEngine.findUniqueElement(target) as HTMLElement | null;
      if (el) {
        if (!waitForVisible) return el;

        const style = window.getComputedStyle(el);
        // 用 getBoundingClientRect 判断尺寸：SVG 元素没有 offsetWidth/offsetHeight（undefined），
        // 会导致可见元素被误判为不可见、轮询到超时报 "Element not found"
        const rect = el.getBoundingClientRect();
        const isVisible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0;

        if (isVisible) return el;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`Element not found within ${this.timeout}ms: ${target}`);
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
