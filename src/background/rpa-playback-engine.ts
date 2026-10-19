import {
  RpaCommandType,
  RpaMessageType,
  RpaRunStatus,
  DEFAULT_RPA_CONFIG,
  DEFAULT_RPA_RUN_STATE,
} from '../shared/rpa-types';
import type { RpaCommand, RpaCommandResult, RpaConfig, RpaMacro, RpaRunState } from '../shared/rpa-types';
import { generateFromRegexLiteral, isRegexLiteral } from '../shared/regex-random';
import { rpaCdpInput } from './rpa-cdp-input';

/** 可能触发「新开 tab」的事件（执行后需要检测并切换到新 tab） */
const NEW_TAB_TRIGGER_COMMANDS = new Set(['click', 'clickAt', 'doubleClick', 'rightClick']);

/** 输入类事件：value 支持 /正则/ 字面量，回放时随机生成 */
const INPUT_COMMANDS = new Set([RpaCommandType.Type, RpaCommandType.SendKeys]);

/** 有 DOM 元素定位、需要光标预取的交互命令 */
const CURSOR_COMMANDS = new Set([
  RpaCommandType.Click,
  RpaCommandType.ClickAt,
  RpaCommandType.DoubleClick,
  RpaCommandType.RightClick,
  RpaCommandType.Type,
  RpaCommandType.SendKeys,
  RpaCommandType.Select,
  RpaCommandType.MouseOver,
  RpaCommandType.DragAndDrop,
]);

/** 依赖 DOM 元素定位、失败后可安全重试的命令（智能等待） */
const RETRYABLE_COMMANDS = new Set([
  RpaCommandType.Click,
  RpaCommandType.ClickAt,
  RpaCommandType.DoubleClick,
  RpaCommandType.RightClick,
  RpaCommandType.Type,
  RpaCommandType.SendKeys,
  RpaCommandType.Select,
  RpaCommandType.MouseOver,
  RpaCommandType.ScrollToElement,
  RpaCommandType.ScrollContainerTo,
  RpaCommandType.DragAndDrop,
  RpaCommandType.StoreText,
  RpaCommandType.StoreValue,
  RpaCommandType.StoreAttribute,
]);

/** 速度到延迟的映射（speed 1-10） */
function speedToDelay(speed: number): number {
  // speed 1 = 2000ms, speed 5 = 300ms, speed 10 = 0ms
  // 最快档限制最小间隔 100ms，保证回放时光标有基本停顿可看清
  return Math.max(100, Math.round(2000 * Math.pow(0.7, speed - 1)));
}

/**
 * RPA 回放引擎（Background 端）
 * 负责协调 Content Script 执行事件，管理运行状态、变量、循环
 */
export class RpaPlaybackEngine {
  private state: RpaRunState = { ...DEFAULT_RPA_RUN_STATE };
  private config: RpaConfig = { ...DEFAULT_RPA_CONFIG };
  private macro: RpaMacro | null = null;
  private abortController: AbortController | null = null;
  /** 当前运行的完整生命周期（含收尾）Promise；用于新回放启动前等待旧回放完全退出 */
  private runPromise: Promise<void> | null = null;
  private onStateChange?: (state: RpaRunState) => void;

  constructor(onStateChange?: (state: RpaRunState) => void) {
    this.onStateChange = onStateChange;
  }

  /** 获取当前状态 */
  getState(): RpaRunState {
    return { ...this.state };
  }

  /** 开始回放（startIndex 支持断点续跑：从指定步骤重新开始） */
  async start(macro: RpaMacro, tabId: number, startIndex = 0): Promise<void> {
    // 已有回放在进行中/暂停时：先终止旧回放并等待其完全退出，
    // 避免新旧两个循环共享 state/macro 造成状态互相污染（表现为两个脚本状态串台）
    await this.cancelPreviousRun();

    this.config = { ...DEFAULT_RPA_CONFIG, speed: macro.speed ?? DEFAULT_RPA_CONFIG.speed };
    this.macro = macro;
    this.abortController = new AbortController();

    const normalizedStart = Math.min(Math.max(0, startIndex), macro.commands.length);
    this.state = {
      status: RpaRunStatus.Running,
      macroId: macro.id,
      currentCommandIndex: normalizedStart,
      results: [],
      startTime: Date.now(),
      variables: {},
      loopStack: [],
      tabId,
    };
    this.notifyStateChange();

    this.runPromise = this.run();
    await this.runPromise;
  }

  /** 本次回放主体（含收尾）：独立成 runPromise，供新回放等待旧回放完全退出 */
  private async run(): Promise<void> {
    try {
      await this.executeLoop();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.state.status = RpaRunStatus.Stopped;
      } else {
        this.state.status = RpaRunStatus.Error;
        this.state.error = (error as Error).message;
      }
    } finally {
      // 回放结束，解除 CDP attach（缩短「正在调试此浏览器」提示条可见时间）
      void rpaCdpInput.detachAll().catch(() => {});
      this.state.endTime = Date.now();
      if (this.state.status === RpaRunStatus.Running) {
        this.state.status = RpaRunStatus.Completed;
      }
      this.notifyStateChange();
      await this.notifyContentProgress();
    }
  }

  /** 终止上一段仍在进行/暂停的回放，并等待其完整退出 */
  private async cancelPreviousRun(): Promise<void> {
    if (!this.runPromise) return;

    if (this.state.status === RpaRunStatus.Running || this.state.status === RpaRunStatus.Paused) {
      this.abortController?.abort();
      const prevTabId = this.state.tabId;
      if (prevTabId) {
        // 解除 content script 中被冻结/等待中的命令，避免旧循环永久阻塞
        void chrome.tabs.sendMessage(prevTabId, { type: RpaMessageType.CANCEL_EXECUTION }).catch(() => {});
      }
    }

    await this.runPromise.catch(() => {});
    this.runPromise = null;
  }

  /** 停止回放 */
  stop(): void {
    this.abortController?.abort();
    this.state.status = RpaRunStatus.Stopped;
    this.notifyStateChange();
    void this.notifyContentProgress();
    // 通知 content script 取消正在执行的命令（等待元素出现的轮询）
    const tabId = this.state.tabId;
    if (tabId) {
      void chrome.tabs.sendMessage(tabId, { type: RpaMessageType.CANCEL_EXECUTION }).catch(() => {});
    }
  }

  /** 暂停回放 */
  pause(): void {
    if (this.state.status === RpaRunStatus.Running) {
      this.state.status = RpaRunStatus.Paused;
      this.notifyStateChange();
      void this.notifyContentProgress();
      // 通知 content script 冻结正在执行的命令（等待元素出现的轮询）
      const tabId = this.state.tabId;
      if (tabId) {
        void chrome.tabs.sendMessage(tabId, { type: RpaMessageType.PAUSE_EXECUTION }).catch(() => {});
      }
    }
  }

  /** 恢复回放 */
  resume(): void {
    if (this.state.status === RpaRunStatus.Paused) {
      this.state.status = RpaRunStatus.Running;
      this.notifyStateChange();
      void this.notifyContentProgress();
      // 通知 content script 恢复被冻结的命令
      const tabId = this.state.tabId;
      if (tabId) {
        void chrome.tabs.sendMessage(tabId, { type: RpaMessageType.RESUME_EXECUTION }).catch(() => {});
      }
    }
  }

  /** 单步执行 */
  async step(macro: RpaMacro, tabId: number): Promise<void> {
    if (this.state.status === RpaRunStatus.Idle) {
      this.config = { ...DEFAULT_RPA_CONFIG, speed: macro.speed ?? DEFAULT_RPA_CONFIG.speed };
      this.macro = macro;
      this.state = {
        ...DEFAULT_RPA_RUN_STATE,
        status: RpaRunStatus.Paused,
        macroId: macro.id,
        currentCommandIndex: 0,
        startTime: Date.now(),
        tabId,
      };
    }

    if (!this.macro) return;

    // 跳过被禁用（眼睛关闭）的命令
    while (
      this.state.currentCommandIndex < this.macro.commands.length &&
      this.macro.commands[this.state.currentCommandIndex].enabled === false
    ) {
      this.state.currentCommandIndex++;
    }

    const idx = this.state.currentCommandIndex;
    if (idx >= this.macro.commands.length) {
      this.state.status = RpaRunStatus.Completed;
      this.state.endTime = Date.now();
      this.notifyStateChange();
      return;
    }

    const cmd = this.macro.commands[idx];
    const result = await this.executeCommand(cmd, idx);
    this.state.results.push(result);

    const nextIdx = this.getNextCommandIndex(cmd, idx, result);
    this.state.currentCommandIndex = nextIdx;
    this.notifyStateChange();
  }

  /** 主执行循环 */
  private async executeLoop(): Promise<void> {
    if (!this.macro) return;

    while (this.state.currentCommandIndex < this.macro.commands.length) {
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Playback aborted', 'AbortError');
      }

      while (this.state.status === RpaRunStatus.Paused) {
        await this.sleep(100);
        if (this.abortController?.signal.aborted) {
          throw new DOMException('Playback aborted', 'AbortError');
        }
      }

      const idx = this.state.currentCommandIndex;
      const cmd = this.macro.commands[idx];

      // 跳过被禁用（眼睛关闭）的命令：不执行、不记录结果、不计失败
      if (cmd.enabled === false) {
        this.state.currentCommandIndex = idx + 1;
        continue;
      }

      this.notifyStateChange();
      await this.notifyContentProgress(cmd);

      const result = await this.executeCommandWithRetry(cmd, idx);
      this.state.results.push(result);

      if (!result.success && !cmd.command.startsWith('verify')) {
        await this.captureFailureScreenshot(result);
        this.state.status = RpaRunStatus.Error;
        this.state.error = result.error;
        return;
      }

      const nextIdx = this.getNextCommandIndex(cmd, idx, result);
      this.state.currentCommandIndex = nextIdx;

      const delay = this.getCommandDelay(cmd);

      // 预取下一步光标动画：下一步是 DOM 交互命令时，在 delay 间隙提前把光标移到目标
      if (delay > 0 && nextIdx < this.macro.commands.length) {
        const nextCmd = this.macro.commands[nextIdx];
        if (CURSOR_COMMANDS.has(nextCmd.command as RpaCommandType) && nextCmd.target) {
          void this.preMoveCursor(nextCmd, delay);
        }
      }

      if (delay > 0) {
        await this.sleep(delay);
      }
    }
  }

  /** 执行单条事件 */
  private async executeCommand(cmd: RpaCommand, index: number): Promise<RpaCommandResult> {
    const startTime = Date.now();

    try {
      const processedCmd = this.replaceVariables(cmd);

      if (this.isFlowControlCommand(processedCmd.command as RpaCommandType)) {
        return this.handleFlowControl(processedCmd, index, startTime);
      }

      if (this.isBackgroundCommand(processedCmd.command as RpaCommandType)) {
        return await this.handleBackgroundCommand(processedCmd, index, startTime);
      }

      // 对可能「新开 tab」的事件，先注册新 tab 监听（避免同步 window.open 漏事件），再执行并等待
      let followNewTab: Promise<void> | null = null;
      if (NEW_TAB_TRIGGER_COMMANDS.has(processedCmd.command)) {
        const beforeTabIds = new Set(
          (await chrome.tabs.query({ currentWindow: true }))
            .map((t) => t.id)
            .filter((id): id is number => id !== undefined),
        );
        followNewTab = this.maybeFollowNewTab(beforeTabIds);
      }

      const result = await this.sendToContentScript(processedCmd);

      if (followNewTab) {
        await followNewTab;
      }

      if (result.storedValue !== undefined) {
        if (processedCmd.command.startsWith('store')) {
          const varName = processedCmd.value || processedCmd.target;
          this.state.variables[varName] = result.storedValue;
        } else if (
          processedCmd.command === RpaCommandType.ExecuteScript ||
          processedCmd.command === RpaCommandType.ExecuteAsyncScript
        ) {
          // executeScript 的 value 字段作为「存储到哪个变量」；为空则不存
          if (processedCmd.value) {
            this.state.variables[processedCmd.value] = result.storedValue;
          }
        }
      }

      return {
        index,
        command: cmd,
        success: result.success,
        duration: Date.now() - startTime,
        error: result.error,
        storedValue: result.storedValue,
      };
    } catch (error) {
      return {
        index,
        command: cmd,
        success: false,
        duration: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  /** 执行单条事件（带智能等待重试）：DOM 命令失败时按 maxRetries 自动重试 */
  private async executeCommandWithRetry(cmd: RpaCommand, index: number): Promise<RpaCommandResult> {
    const maxRetries = this.config.maxRetries ?? 0;
    let result = await this.executeCommand(cmd, index);
    result.retries = 0;

    if (result.success || maxRetries <= 0 || !this.isRetryableCommand(cmd.command)) {
      return result;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Playback aborted', 'AbortError');
      }
      await this.sleep(500 * attempt);
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Playback aborted', 'AbortError');
      }
      result = await this.executeCommand(cmd, index);
      result.retries = attempt;
      if (result.success) return result;
    }

    return result;
  }

  /** 判断命令是否可安全重试（依赖 DOM 元素定位、失败通常因异步渲染未就绪） */
  private isRetryableCommand(command: string): boolean {
    return RETRYABLE_COMMANDS.has(command as RpaCommandType);
  }

  /** 回放失败时自动截图并记录页面 URL（失败诊断） */
  private async captureFailureScreenshot(result: RpaCommandResult): Promise<void> {
    if (!this.config.screenshotOnError) return;
    const tabId = this.state.tabId;
    if (!tabId) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      result.screenshot = dataUrl;
      result.pageUrl = tab.url;
    } catch {
      // 截图失败（如标签页不可见/无权限）时静默忽略，不影响回放结果
    }
  }

  /** 向 Content Script 发送事件执行请求 */
  private async sendToContentScript(cmd: RpaCommand): Promise<{
    success: boolean;
    error?: string;
    storedValue?: string;
  }> {
    const tabId = this.state.tabId;
    if (!tabId) {
      throw new Error('No active tab');
    }

    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: RpaMessageType.EXECUTE_COMMAND,
        payload: {
          command: cmd.command,
          target: cmd.target,
          value: cmd.value,
          timeout: this.config.elementTimeout,
          // 滚动命令的平滑过渡时长：跟随回放速度（步骤间隔 delay）
          delay: this.getCommandDelay(cmd),
        },
      });
      return (
        (response as { success: boolean; error?: string; storedValue?: string }) || {
          success: false,
          error: 'No response',
        }
      );
    } catch (e) {
      throw new Error(chrome.runtime.lastError?.message || (e as Error).message);
    }
  }

  /** 检测事件执行后是否新开了 tab，若新开则等待加载完成并切换当前 tab */
  private async maybeFollowNewTab(beforeTabIds: Set<number>): Promise<void> {
    const newTab = await new Promise<chrome.tabs.Tab | null>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let listener: ((tab: chrome.tabs.Tab) => void) | null = null;

      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        if (listener) chrome.tabs.onCreated.removeListener(listener);
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, 1500);

      listener = (tab: chrome.tabs.Tab) => {
        if (tab.id !== undefined && !beforeTabIds.has(tab.id)) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(tab);
        }
      };

      chrome.tabs.onCreated.addListener(listener);
    });

    if (!newTab?.id) return;

    // 等待新 tab 加载完成（超时抛错，由上层按事件失败处理）
    const current = await chrome.tabs.get(newTab.id);
    if (current.status !== 'complete') {
      await this.waitForTabComplete(newTab.id);
    }

    // 通知旧 tab：回放已转移到新标签页，清理其进度指示器并提示
    const prevTabId = this.state.tabId;
    if (prevTabId && prevTabId !== newTab.id) {
      void chrome.tabs
        .sendMessage(prevTabId, {
          type: RpaMessageType.PLAYBACK_PROGRESS,
          payload: {
            status: RpaRunStatus.Idle,
            currentIndex: this.state.currentCommandIndex,
            totalCommands: this.macro?.commands.length ?? 0,
            commandName: '',
            commandTarget: '',
            macroName: this.macro?.name ?? '',
          },
        })
        .catch(() => {
          // 旧 tab 可能已关闭
        });
      void chrome.tabs
        .sendMessage(prevTabId, {
          type: RpaMessageType.SHOW_PAGE_TOAST,
          payload: { text: '回放已切换到新标签页', kind: 'info' },
        })
        .catch(() => {});
    }

    this.state.tabId = newTab.id;
    this.notifyStateChange();
  }

  /** 处理 Background 端事件（open, goBack 等） */
  private async handleBackgroundCommand(cmd: RpaCommand, index: number, startTime: number): Promise<RpaCommandResult> {
    const tabId = this.state.tabId;

    switch (cmd.command) {
      case RpaCommandType.Open: {
        let url = cmd.target;
        if (url.startsWith('/')) {
          const tab = await chrome.tabs.get(tabId!);
          const origin = new URL(tab.url!).origin;
          url = origin + url;
        }
        await chrome.tabs.update(tabId!, { url });
        await this.waitForTabComplete(tabId!);
        await this.notifyContentProgress(cmd);
        return { index, command: cmd, success: true, duration: Date.now() - startTime };
      }

      case RpaCommandType.GoBack:
        await chrome.tabs.goBack(tabId!);
        await this.waitForTabComplete(tabId!);
        await this.notifyContentProgress(cmd);
        return { index, command: cmd, success: true, duration: Date.now() - startTime };

      case RpaCommandType.GoForward:
        await chrome.tabs.goForward(tabId!);
        await this.waitForTabComplete(tabId!);
        await this.notifyContentProgress(cmd);
        return { index, command: cmd, success: true, duration: Date.now() - startTime };

      case RpaCommandType.Refresh:
        await chrome.tabs.reload(tabId!);
        await this.waitForTabComplete(tabId!);
        await this.notifyContentProgress(cmd);
        return { index, command: cmd, success: true, duration: Date.now() - startTime };

      case RpaCommandType.Pause: {
        const ms = parseInt(cmd.target || cmd.value, 10) || 1000;
        await this.sleep(ms);
        return { index, command: cmd, success: true, duration: Date.now() - startTime };
      }

      case RpaCommandType.Echo:
        return {
          index,
          command: cmd,
          success: true,
          duration: Date.now() - startTime,
          storedValue: cmd.target,
        };

      case RpaCommandType.Store:
        this.state.variables[cmd.value] = cmd.target;
        return {
          index,
          command: cmd,
          success: true,
          duration: Date.now() - startTime,
          storedValue: cmd.target,
        };

      case RpaCommandType.CaptureScreenshot: {
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined as unknown as number, {
          format: 'png',
        });
        return {
          index,
          command: cmd,
          success: true,
          duration: Date.now() - startTime,
          screenshot: dataUrl,
        };
      }

      default:
        return {
          index,
          command: cmd,
          success: false,
          duration: Date.now() - startTime,
          error: `Unknown background command: ${cmd.command}`,
        };
    }
  }

  /** 处理流程控制 */
  private handleFlowControl(cmd: RpaCommand, index: number, startTime: number): RpaCommandResult {
    return { index, command: cmd, success: true, duration: Date.now() - startTime };
  }

  /** 计算下一条事件索引 */
  private getNextCommandIndex(cmd: RpaCommand, currentIdx: number, _result: RpaCommandResult): number {
    switch (cmd.command) {
      case RpaCommandType.Times: {
        const times = parseInt(cmd.target, 10) || 0;
        this.state.loopStack.push({
          type: 'times',
          startIndex: currentIdx,
          currentIteration: 0,
          maxIterations: times,
        });
        return currentIdx + 1;
      }

      case RpaCommandType.While: {
        const conditionMet = this.evaluateCondition(cmd.target);
        if (conditionMet) {
          this.state.loopStack.push({
            type: 'while',
            startIndex: currentIdx,
            currentIteration: 0,
            condition: cmd.target,
          });
          return currentIdx + 1;
        }
        return this.findMatchingEnd(currentIdx) + 1;
      }

      case RpaCommandType.End: {
        const loop = this.state.loopStack[this.state.loopStack.length - 1];
        if (!loop) return currentIdx + 1;

        if (loop.type === 'times') {
          loop.currentIteration++;
          if (loop.currentIteration < (loop.maxIterations ?? 0)) {
            return loop.startIndex + 1;
          }
          this.state.loopStack.pop();
          return currentIdx + 1;
        }

        if (loop.type === 'while') {
          if (this.evaluateCondition(loop.condition ?? '')) {
            loop.currentIteration++;
            return loop.startIndex + 1;
          }
          this.state.loopStack.pop();
          return currentIdx + 1;
        }

        return currentIdx + 1;
      }

      case RpaCommandType.If: {
        const conditionMet = this.evaluateCondition(cmd.target);
        if (conditionMet) {
          return currentIdx + 1;
        }
        return this.findNextElseOrEnd(currentIdx) + 1;
      }

      case RpaCommandType.Else:
      case RpaCommandType.ElseIf:
        return this.findMatchingEnd(currentIdx) + 1;

      default:
        return currentIdx + 1;
    }
  }

  /** 查找匹配的 end 事件 */
  private findMatchingEnd(fromIdx: number): number {
    if (!this.macro) return fromIdx + 1;
    let depth = 1;
    for (let i = fromIdx + 1; i < this.macro.commands.length; i++) {
      const c = this.macro.commands[i].command;
      if (c === RpaCommandType.If || c === RpaCommandType.Times || c === RpaCommandType.While) {
        depth++;
      } else if (c === RpaCommandType.End) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return this.macro.commands.length;
  }

  /** 查找下一个 else/elseIf/end */
  private findNextElseOrEnd(fromIdx: number): number {
    if (!this.macro) return fromIdx + 1;
    let depth = 0;
    for (let i = fromIdx + 1; i < this.macro.commands.length; i++) {
      const c = this.macro.commands[i].command;
      if (c === RpaCommandType.If || c === RpaCommandType.Times || c === RpaCommandType.While) {
        depth++;
      } else if (c === RpaCommandType.End) {
        if (depth === 0) return i;
        depth--;
      } else if (depth === 0 && (c === RpaCommandType.Else || c === RpaCommandType.ElseIf)) {
        return i;
      }
    }
    return this.macro.commands.length;
  }

  /** 评估条件表达式 */
  private evaluateCondition(condition: string): boolean {
    const processed = this.replaceVariableString(condition);
    try {
      const match = processed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
      if (match) {
        const [, left, op, right] = match;
        const l = left.trim();
        const r = right.trim();
        switch (op) {
          case '==':
            return l === r;
          case '!=':
            return l !== r;
          case '>':
            return Number(l) > Number(r);
          case '<':
            return Number(l) < Number(r);
          case '>=':
            return Number(l) >= Number(r);
          case '<=':
            return Number(l) <= Number(r);
        }
      }
      return processed.trim() !== '' && processed.trim() !== 'false' && processed.trim() !== '0';
    } catch {
      return false;
    }
  }

  /** 变量替换 */
  private replaceVariables(cmd: RpaCommand): RpaCommand {
    return {
      ...cmd,
      target: this.replaceVariableString(cmd.target),
      value: this.resolveValue(cmd),
    };
  }

  /** 解析事件 value：输入类事件的 /正则/ 字面量随机生成，否则走 ${varName} 变量替换 */
  private resolveValue(cmd: RpaCommand): string {
    if (INPUT_COMMANDS.has(cmd.command as RpaCommandType) && isRegexLiteral(cmd.value)) {
      return generateFromRegexLiteral(cmd.value);
    }
    return this.replaceVariableString(cmd.value);
  }

  /** 替换字符串中的 ${varName} 变量 */
  private replaceVariableString(str: string): string {
    if (!str) return str;
    return str.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return this.state.variables[varName] ?? `\${${varName}}`;
    });
  }

  /** 判断是否流程控制事件 */
  private isFlowControlCommand(cmd: RpaCommandType): boolean {
    return [
      RpaCommandType.If,
      RpaCommandType.Else,
      RpaCommandType.ElseIf,
      RpaCommandType.End,
      RpaCommandType.Times,
      RpaCommandType.While,
    ].includes(cmd);
  }

  /** 判断是否 Background 端事件 */
  private isBackgroundCommand(cmd: RpaCommandType): boolean {
    return [
      RpaCommandType.Open,
      RpaCommandType.GoBack,
      RpaCommandType.GoForward,
      RpaCommandType.Refresh,
      RpaCommandType.Pause,
      RpaCommandType.Echo,
      RpaCommandType.Store,
      RpaCommandType.CaptureScreenshot,
    ].includes(cmd);
  }

  /** 等待标签页加载完成 */
  private waitForTabComplete(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Page load timeout'));
      }, this.config.pageLoadTimeout);

      const listener = (updatedTabId: number, info: { status?: string }) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 500);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /** 计算某条命令执行后的步骤间隔（显式 delay 优先，否则按速度换算；speed 默认值已限 100ms 下限） */
  private getCommandDelay(cmd: RpaCommand): number {
    return cmd.delay !== undefined && cmd.delay >= 0 ? cmd.delay : speedToDelay(this.config.speed);
  }

  /** sleep 工具 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 通知状态变化 */
  private notifyStateChange(): void {
    this.onStateChange?.({ ...this.state });
  }

  /** 预取：在 delay 间隙通知 content 提前把光标动画移动到下一步目标 */
  private async preMoveCursor(nextCmd: RpaCommand, delay: number): Promise<void> {
    const tabId = this.state.tabId;
    if (!tabId) return;
    try {
      const processed = this.replaceVariables(nextCmd);
      await chrome.tabs.sendMessage(tabId, {
        type: RpaMessageType.PRE_MOVE_CURSOR,
        payload: {
          target: processed.target,
          delay,
        },
      });
    } catch {
      // 预取失败静默忽略（下一步执行时会直接定位）
    }
  }

  /** 向 Content Script 发送回放进度，驱动页面端指示器 */
  private async notifyContentProgress(cmd?: RpaCommand): Promise<void> {
    const tabId = this.state.tabId;
    if (!tabId || !this.macro) return;
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: RpaMessageType.PLAYBACK_PROGRESS,
        payload: {
          status: this.state.status,
          currentIndex: this.state.currentCommandIndex,
          totalCommands: this.macro.commands.length,
          commandName: cmd?.command || '',
          commandTarget: cmd?.target || '',
          macroName: this.macro.name,
          error: this.state.error,
        },
      });
    } catch {
      // tab 可能已关闭或 content script 未注入，静默忽略
    }
  }
}
