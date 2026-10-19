/**
 * CDP 真实输入模块（Background 端）
 *
 * 背景：合成事件（dispatchEvent(new MouseEvent(...))）的 isTrusted === false，
 * 浏览器不会据此更新 CSS :hover 匹配，导致「hover 才显示」的按钮在回放时永远不渲染。
 * 通过 chrome.debugger 发送 CDP Input.dispatchMouseEvent（可信事件），
 * 移动真实指针到目标坐标即可触发 :hover，按钮渲染后再执行后续点击。
 *
 * 说明：
 * - 坐标使用 CSS 像素（视口坐标），与 content 端 getBoundingClientRect() 一致，无需换算 DPR。
 * - 采用惰性 attach + 回放结束 detachAll，把「正在调试此浏览器」提示条可见时间压缩到最短。
 */

/** CDP 输入动作类型 */
export type CdpInputAction = 'move' | 'click' | 'doubleClick' | 'rightClick';

class RpaCdpInput {
  /** 已 attach 的 tab（惰性 attach，回放结束统一 detach） */
  private attached = new Set<number>();

  constructor() {
    // 用户手动关闭调试（或 DevTools 抢占）时，同步移除 attach 状态
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.attached.delete(source.tabId);
    });
  }

  /** attach 到 tab；若已被其他调试器（如 DevTools）占用则抛出明确错误 */
  async attach(tabId: number): Promise<void> {
    if (this.attached.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attached.add(tabId);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('Another debugger is already attached')) {
        throw new Error('目标标签页已被 DevTools 或其他调试器占用，请关闭 DevTools 后重试');
      }
      throw e;
    }
  }

  /** detach 单个 tab */
  async detach(tabId: number): Promise<void> {
    if (!this.attached.has(tabId)) return;
    this.attached.delete(tabId);
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // 已 detach 或 tab 已关闭，忽略
    }
  }

  /** detach 全部（回放结束/切换 tab 时调用） */
  async detachAll(): Promise<void> {
    const tabs = Array.from(this.attached);
    this.attached.clear();
    await Promise.all(tabs.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => {})));
  }

  /** 移动真实指针到视口坐标 (x, y) */
  async moveTo(tabId: number, x: number, y: number): Promise<void> {
    await this.attach(tabId);
    await this.dispatch(tabId, 'mouseMoved', { x, y, button: 'none' });
  }

  /** 真实点击：先移动到目标（顺带触发 :hover）再按下/抬起 */
  async click(tabId: number, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
    await this.attach(tabId);
    await this.dispatch(tabId, 'mouseMoved', { x, y, button: 'none' });
    await this.dispatch(tabId, 'mousePressed', { x, y, button, clickCount: 1 });
    await this.dispatch(tabId, 'mouseReleased', { x, y, button, clickCount: 1 });
  }

  /** 真实双击 */
  async doubleClick(tabId: number, x: number, y: number): Promise<void> {
    await this.attach(tabId);
    await this.dispatch(tabId, 'mouseMoved', { x, y, button: 'none' });
    for (let i = 0; i < 2; i++) {
      await this.dispatch(tabId, 'mousePressed', { x, y, button: 'left', clickCount: i + 1 });
      await this.dispatch(tabId, 'mouseReleased', { x, y, button: 'left', clickCount: i + 1 });
    }
  }

  private async dispatch(
    tabId: number,
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...params, type });
    } catch (e) {
      throw new Error(`CDP 输入失败(${type}): ${(e as Error).message}`);
    }
  }
}

export const rpaCdpInput = new RpaCdpInput();
