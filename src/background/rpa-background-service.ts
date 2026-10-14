import { RpaMessageType, RpaRecordingStatus } from '../shared/rpa-types';
import type { PageToastKind, RpaCommand, RpaMacro, RpaRecordedEvent, RpaRunState } from '../shared/rpa-types';
import { createId, createMacroId, getScript, saveScript, updateScript } from '../shared/rpa-storage';
import { RpaPlaybackEngine } from './rpa-playback-engine';

/**
 * RPA Background 服务
 * 处理 RPA 相关消息：录制事件收集组装、回放调度、元素选择转发
 */
class BackgroundRpaService {
  private playbackEngine: RpaPlaybackEngine;
  private recordingStatus: RpaRecordingStatus = RpaRecordingStatus.Idle;
  private recordedEvents: RpaRecordedEvent[] = [];
  /** 参与录制的所有 tab（支持点击新开 tab 后跨页签续录） */
  private recordingTabIds = new Set<number>();
  /** 录制起始 tab 的 origin，用于限制「仅同域名新开 tab 续录」 */
  private recordingOrigin = '';
  /** DevTools panel 长连接（广播无法路由到 devtools panel，用 port 点对点推送） */
  private panelPorts = new Set<chrome.runtime.Port>();

  /** 注册 DevTools panel 长连接 */
  registerPanelPort(port: chrome.runtime.Port): void {
    this.panelPorts.add(port);
    port.onDisconnect.addListener(() => {
      this.panelPorts.delete(port);
    });
    // 连接建立后立即推送一次当前录制状态，作为面板的初始状态
    this.notifyRecordingStatus();
  }

  /** 点对点推送消息给 DevTools panel（广播无法路由到 devtools panel） */
  private notifyPanel(message: { type: string; payload?: unknown }): void {
    for (const port of this.panelPorts) {
      try {
        port.postMessage(message);
      } catch {
        this.panelPorts.delete(port);
      }
    }
  }

  /** 推送当前录制状态给所有 DevTools panel（录制/停止/暂停/恢复时调用） */
  private notifyRecordingStatus(): void {
    this.notifyPanel({
      type: RpaMessageType.RECORDING_STATUS_CHANGED,
      payload: { status: this.recordingStatus, eventCount: this.recordedEvents.length },
    });
  }

  constructor() {
    this.playbackEngine = new RpaPlaybackEngine((state) => {
      this.broadcastState(state);
    });
  }

  /**
   * 查找一个可用的普通网页 Tab（排除扩展页面、chrome:// 等）
   */
  private async findTargetTab(): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const normalTabs = tabs.filter((t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
    if (normalTabs.length === 0) return null;
    const activeNormal = normalTabs.find((t) => t.active);
    return activeNormal || normalTabs[normalTabs.length - 1];
  }

  /** 处理来自 popup/editor/content script 的消息 */
  async handleMessage(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> {
    switch (message.type) {
      // ====== 录制 ======
      case RpaMessageType.START_RECORDING: {
        const payload = message.payload as { tabId?: number } | undefined;
        const tabId = payload?.tabId || sender.tab?.id;
        return this.startRecording(tabId);
      }

      case RpaMessageType.STOP_RECORDING: {
        const stopPayload = message.payload as { mergeIntoMacroId?: string } | undefined;
        return this.stopRecording(stopPayload?.mergeIntoMacroId);
      }

      case RpaMessageType.PAUSE_RECORDING:
        this.recordingStatus = RpaRecordingStatus.Paused;
        this.notifyRecordingStatus();
        return { success: true };

      case RpaMessageType.RESUME_RECORDING:
        this.recordingStatus = RpaRecordingStatus.Recording;
        this.notifyRecordingStatus();
        return { success: true };

      case RpaMessageType.RECORDING_EVENT:
        return this.handleRecordingEvent(message.payload as RpaRecordedEvent);

      case RpaMessageType.GET_RECORDING_STATUS: {
        // content script 启动时自查询录制状态；若正在录制，登记该 tab 以便停止时广播
        if (this.recordingStatus === RpaRecordingStatus.Recording && sender.tab?.id !== undefined) {
          this.recordingTabIds.add(sender.tab.id);
        }
        return {
          success: true,
          data: {
            status: this.recordingStatus,
            eventCount: this.recordedEvents.length,
            recordingOrigin: this.recordingOrigin,
          },
        };
      }

      // ====== 回放 ======
      case RpaMessageType.START_PLAYBACK: {
        const plPayload = message.payload as { macroId: string; tabId?: number };
        const tabId = plPayload.tabId || sender.tab?.id;
        return this.startPlayback(plPayload.macroId, tabId);
      }

      case RpaMessageType.STOP_PLAYBACK:
        this.playbackEngine.stop();
        return { success: true };

      case RpaMessageType.PAUSE_PLAYBACK:
        this.playbackEngine.pause();
        return { success: true };

      case RpaMessageType.RESUME_PLAYBACK:
        this.playbackEngine.resume();
        return { success: true };

      case RpaMessageType.STEP_PLAYBACK: {
        const stPayload = message.payload as { macroId: string; tabId?: number };
        const tabId = stPayload.tabId || sender.tab?.id;
        return this.stepPlayback(stPayload.macroId, tabId);
      }

      case RpaMessageType.GET_RUN_STATE:
        return { success: true, data: this.playbackEngine.getState() };

      // ====== 元素选择 ======
      case RpaMessageType.START_ELEMENT_PICKER: {
        const pickerPayload = message.payload as { tabId?: number } | undefined;
        const tabId = pickerPayload?.tabId || sender.tab?.id;
        return this.startElementPicker(tabId);
      }

      case RpaMessageType.STOP_ELEMENT_PICKER:
        return { success: true };

      case RpaMessageType.ELEMENT_PICKED: {
        // content script 选中元素后发此消息，转发给页面端
        // 1) 广播给普通扩展页面（如工具集的 RpaRecorder 页）
        void chrome.runtime
          .sendMessage({
            type: RpaMessageType.ELEMENT_PICKED,
            payload: message.payload,
          })
          .catch(() => {
            // 页面可能已关闭
          });
        // 2) 点对点推送给 DevTools panel（广播无法路由到 devtools panel）
        for (const port of this.panelPorts) {
          try {
            port.postMessage({
              type: RpaMessageType.ELEMENT_PICKED,
              payload: message.payload,
            });
          } catch {
            this.panelPorts.delete(port);
          }
        }
        return { success: true };
      }

      // ====== 页面 Toast ======
      case RpaMessageType.SHOW_PAGE_TOAST: {
        const toastPayload = message.payload as { tabId?: number; text: string; kind: PageToastKind };
        const tabId = toastPayload.tabId || sender.tab?.id;
        return this.showPageToast(tabId, { text: toastPayload.text, kind: toastPayload.kind });
      }

      // ====== 悬浮条控制 ======
      case RpaMessageType.SHOW_BAR:
        return this.toggleBar(true);

      case RpaMessageType.HIDE_BAR:
        return this.toggleBar(false);

      default:
        return { success: false, error: `Unknown RPA message type: ${message.type}` };
    }
  }

  /** 开始录制 */
  private async startRecording(tabId?: number): Promise<unknown> {
    let targetTabId = tabId;
    if (!targetTabId) {
      const targetTab = await this.findTargetTab();
      targetTabId = targetTab?.id;
    }

    if (!targetTabId) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }

    this.recordingStatus = RpaRecordingStatus.Recording;
    this.recordedEvents = [];
    this.recordingTabIds = new Set([targetTabId]);
    this.recordingOrigin = '';

    // 记录起始 tab 的 origin，作为「仅同域名新开 tab 续录」的判断基准
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab.url) {
        try {
          this.recordingOrigin = new URL(tab.url).origin;
        } catch {
          this.recordingOrigin = '';
        }
      }
    } catch {
      // ignore
    }

    try {
      await chrome.tabs.sendMessage(targetTabId, {
        type: RpaMessageType.START_RECORDING,
      });
    } catch (e) {
      console.warn('[RPA Background] 通知 content script 开始录制失败:', e);
      return { success: false, error: '当前页面无法注入脚本，请刷新页面后重试' };
    }

    try {
      await chrome.tabs.update(targetTabId, { active: true });
    } catch (e) {
      console.warn('[RPA Background] 激活目标 Tab 失败:', e);
    }

    this.notifyRecordingStatus();
    return { success: true, data: { tabId: targetTabId } };
  }

  /** 停止录制，生成操作脚本 */
  private async stopRecording(mergeIntoMacroId?: string): Promise<unknown> {
    this.recordingStatus = RpaRecordingStatus.Idle;
    this.notifyRecordingStatus();

    for (const tabId of this.recordingTabIds) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: RpaMessageType.STOP_RECORDING,
        });
      } catch {
        // ignore
      }
    }

    const commands = this.eventsToCommands(this.recordedEvents);

    if (commands.length === 0) {
      return { success: true, data: null };
    }

    let macro: RpaMacro;

    if (mergeIntoMacroId) {
      const existing = await getScript(mergeIntoMacroId);
      if (existing) {
        const now = Date.now();
        macro = { ...existing, commands, updatedAt: now, tags: ['recorded'] };
        await updateScript(macro);
      } else {
        macro = this.createRecordingMacro(commands);
        await saveScript(macro);
      }
    } else {
      macro = this.createRecordingMacro(commands);
      await saveScript(macro);
    }

    // 录制完成，通知 DevTools panel 刷新脚本列表
    this.notifyPanel({
      type: RpaMessageType.RECORDING_COMPLETED,
      payload: { macroId: macro.id },
    });

    this.recordedEvents = [];
    this.recordingTabIds = new Set();
    this.recordingOrigin = '';

    return { success: true, data: macro };
  }

  /** 创建录制操作脚本对象 */
  private createRecordingMacro(commands: RpaCommand[]): RpaMacro {
    const now = Date.now();
    return {
      id: createMacroId(),
      name: `录制 ${new Date().toLocaleString()}`,
      commands,
      createdAt: now,
      updatedAt: now,
      createdBy: '匿名',
      tags: ['recorded'],
    };
  }

  /** 处理录制事件 */
  private handleRecordingEvent(event: RpaRecordedEvent): unknown {
    if (this.recordingStatus !== RpaRecordingStatus.Recording) {
      return { success: false, error: 'Not recording' };
    }
    this.recordedEvents.push(event);
    return { success: true };
  }

  /** 开始回放 */
  private async startPlayback(macroId: string, tabId?: number): Promise<unknown> {
    const macro = await getScript(macroId);
    if (!macro) {
      return { success: false, error: 'Macro not found' };
    }

    let targetTabId = tabId;
    if (!targetTabId) {
      const targetTab = await this.findTargetTab();
      targetTabId = targetTab?.id;
    }
    if (!targetTabId) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }

    try {
      await chrome.tabs.sendMessage(targetTabId, { type: RpaMessageType.GET_RECORDING_STATUS });
    } catch (e) {
      console.warn('[RPA Background] content script 未注入:', e);
      return { success: false, error: '当前页面无法注入脚本，请刷新页面后重试' };
    }

    // 异步执行，不等待完成
    this.playbackEngine.start(macro, targetTabId).catch(() => {
      // 错误已经在 engine 内部处理
    });

    return { success: true };
  }

  /** 单步回放 */
  private async stepPlayback(macroId: string, tabId?: number): Promise<unknown> {
    const macro = await getScript(macroId);
    if (!macro) {
      return { success: false, error: 'Macro not found' };
    }

    let targetTabId = tabId;
    if (!targetTabId) {
      const targetTab = await this.findTargetTab();
      targetTabId = targetTab?.id;
    }
    if (!targetTabId) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }

    try {
      await chrome.tabs.sendMessage(targetTabId, { type: RpaMessageType.GET_RECORDING_STATUS });
    } catch (e) {
      console.warn('[RPA Background] content script 未注入:', e);
      return { success: false, error: '当前页面无法注入脚本，请刷新页面后重试' };
    }

    await this.playbackEngine.step(macro, targetTabId);
    return { success: true, data: this.playbackEngine.getState() };
  }

  /** 将录制事件转换为 RPA 事件 */
  private eventsToCommands(events: RpaRecordedEvent[]): RpaCommand[] {
    const commands: RpaCommand[] = [];

    // 添加起始 open 事件
    if (events.length > 0) {
      commands.push({
        id: createId(),
        command: 'open',
        target: events[0].url,
        value: '',
      });
    }

    for (const event of events) {
      // 保存完整的多策略定位器（用 ` || ` 分隔），回放时逐个尝试、只接受唯一命中
      const target = event.locators.length > 0 ? event.locators.map((l) => `${l.type}=${l.value}`).join(' || ') : '';

      switch (event.type) {
        case 'click':
          commands.push({ id: createId(), command: 'click', target, value: '' });
          break;

        case 'dblclick':
          commands.push({ id: createId(), command: 'doubleClick', target, value: '' });
          break;

        case 'contextmenu':
          commands.push({ id: createId(), command: 'rightClick', target, value: '' });
          break;

        case 'input':
        case 'change': {
          // 合并对同一 target 的连续 type 事件，只保留最后一次的值
          const lastCmd = commands[commands.length - 1];
          if (lastCmd && lastCmd.command === 'type' && lastCmd.target === target) {
            lastCmd.value = event.value || '';
          } else {
            commands.push({ id: createId(), command: 'type', target, value: event.value || '' });
          }
          break;
        }

        case 'select':
          commands.push({ id: createId(), command: 'select', target, value: event.value || '' });
          break;

        case 'navigate':
          commands.push({
            id: createId(),
            command: 'open',
            target: event.value || event.url,
            value: '',
          });
          break;

        case 'submit':
          // submit 事件不需要特殊处理，input 事件已经覆盖
          break;
      }
    }

    return commands;
  }

  /** 启动元素选择器 */
  private async startElementPicker(tabId?: number): Promise<unknown> {
    let targetTabId = tabId;
    if (!targetTabId) {
      const targetTab = await this.findTargetTab();
      targetTabId = targetTab?.id;
    }
    if (!targetTabId) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }

    try {
      await chrome.tabs.sendMessage(targetTabId, {
        type: RpaMessageType.START_ELEMENT_PICKER,
      });
    } catch (e) {
      console.warn('[RPA Background] 启动元素选取失败:', e);
      return { success: false, error: 'Failed to start element picker' };
    }

    try {
      await chrome.tabs.update(targetTabId, { active: true });
    } catch {
      // ignore
    }

    return { success: true };
  }

  /** 在目标网页右下角显示 Toast 提示 */
  private async showPageToast(
    tabId: number | undefined,
    data: { text: string; kind: PageToastKind },
  ): Promise<unknown> {
    if (!tabId) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: RpaMessageType.SHOW_PAGE_TOAST,
        payload: { text: data.text, kind: data.kind },
      });
      return { success: true };
    } catch {
      return { success: false, error: '当前页面无法注入脚本，请刷新页面后重试' };
    }
  }

  /** 显示/隐藏目标网页的悬浮条 */
  private async toggleBar(show: boolean): Promise<unknown> {
    const targetTab = await this.findTargetTab();
    if (!targetTab?.id) {
      return { success: false, error: '未找到目标网页标签页，请先打开一个网页' };
    }
    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        type: show ? RpaMessageType.SHOW_BAR : RpaMessageType.HIDE_BAR,
      });
      return { success: true };
    } catch {
      return { success: false, error: '当前页面无法注入脚本，请刷新页面后重试' };
    }
  }

  /** 广播状态变化到页面端 */
  private broadcastState(state: RpaRunState): void {
    void chrome.runtime
      .sendMessage({
        type: RpaMessageType.PLAYBACK_STATUS_CHANGED,
        payload: state,
      })
      .catch(() => {
        // Popup/页面可能已关闭
      });
    // 点对点推送给 DevTools panel（广播无法路由到 devtools panel）
    for (const port of this.panelPorts) {
      try {
        port.postMessage({
          type: RpaMessageType.PLAYBACK_STATUS_CHANGED,
          payload: state,
        });
      } catch {
        this.panelPorts.delete(port);
      }
    }
  }
}

export const backgroundRpaService = new BackgroundRpaService();
