/**
 * RPA 类型定义（对齐 rocket-agent-plugin/src/types/rpa.ts）
 *
 * 兼容 UI.Vision 格式 + 扩展自定义事件
 */

// ========== 事件定义 ==========

/** RPA 事件类型枚举 */
export enum RpaCommandType {
  // 点击
  Click = 'click',
  ClickAt = 'clickAt',
  DoubleClick = 'doubleClick',
  RightClick = 'rightClick',

  // 输入
  Type = 'type',
  SendKeys = 'sendKeys',

  // 导航
  Open = 'open',
  GoBack = 'goBack',
  GoForward = 'goForward',
  Refresh = 'refresh',

  // 等待
  WaitForElementPresent = 'waitForElementPresent',
  WaitForElementVisible = 'waitForElementVisible',
  WaitForElementNotPresent = 'waitForElementNotPresent',
  Pause = 'pause',

  // 验证
  AssertElementPresent = 'assertElementPresent',
  AssertText = 'assertText',
  AssertTitle = 'assertTitle',
  AssertValue = 'assertValue',
  VerifyElementPresent = 'verifyElementPresent',
  VerifyText = 'verifyText',
  VerifyTitle = 'verifyTitle',
  VerifyValue = 'verifyValue',

  // 选择
  Select = 'select',

  // 存储
  Store = 'store',
  StoreText = 'storeText',
  StoreValue = 'storeValue',
  StoreTitle = 'storeTitle',
  StoreAttribute = 'storeAttribute',

  // 流程控制
  If = 'if',
  Else = 'else',
  ElseIf = 'elseIf',
  End = 'end',
  While = 'while',
  Times = 'times',

  // 截图
  CaptureScreenshot = 'captureScreenshot',

  // Echo
  Echo = 'echo',

  // 滚动
  ScrollTo = 'scrollTo',
  ScrollToElement = 'scrollToElement',

  // 鼠标悬停
  MouseOver = 'mouseOver',

  // 拖拽
  DragAndDrop = 'dragAndDrop',

  // 执行 JS
  ExecuteScript = 'executeScript',
  ExecuteAsyncScript = 'executeAsyncScript',
}

/** 单条 RPA 事件 */
export interface RpaCommand {
  /** 事件 ID（运行时生成） */
  id: string;
  /** 事件类型 */
  command: RpaCommandType | string;
  /** 目标元素定位器 */
  target: string;
  /** 事件参数/值 */
  value: string;
  /** 事件描述（注释） */
  description?: string;
  /** 该步执行完成后的等待时长（毫秒）；未设置时回退到全局 speed */
  delay?: number;
}

// ========== 操作脚本定义 ==========

/** 操作脚本 */
export interface RpaMacro {
  /** 唯一 ID */
  id: string;
  /** 脚本名称 */
  name: string;
  /** 事件列表 */
  commands: RpaCommand[];
  /** 回放速度（1-10，数字越大越快；缺省回退默认 5） */
  speed?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 创建人（已登录显示用户名，未登录显示"匿名"） */
  createdBy?: string;
  /** 标签（用于分类） */
  tags?: string[];
  /** 描述 */
  description?: string;

  // ===== 云同步字段（可选，当前项目未启用云同步） =====

  /** 同步状态 */
  syncStatus?: 'local-only' | 'synced' | 'modified' | 'conflict';
  /** 服务端 ID */
  serverId?: number;
  /** 云端版本号 */
  serverVersion?: number;
  /** 上次同步时的 contentHash */
  lastSyncedContentHash?: string;
  /** 上次同步时间 */
  lastSyncedAt?: number;
  /** Fork 来源 */
  forkedFromId?: number;
  /** 是否公开 */
  isPublic?: boolean;

  // ===== 共享字段（可选，当前项目未启用共享） =====

  /** 是否为共享给我的脚本（只读） */
  isShared?: boolean;
  /** 共享权限 */
  sharePermission?: 'view' | 'fork' | 'edit';
  /** 脚本所有者名称 */
  ownerName?: string;
}

// ========== 运行状态 ==========

/** 运行状态 */
export enum RpaRunStatus {
  Idle = 'idle',
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Error = 'error',
  Stopped = 'stopped',
}

/** 单条事件执行结果 */
export interface RpaCommandResult {
  /** 事件索引 */
  index: number;
  /** 事件 */
  command: RpaCommand;
  /** 是否成功 */
  success: boolean;
  /** 耗时（ms） */
  duration: number;
  /** 错误信息 */
  error?: string;
  /** 存储的值（store 事件） */
  storedValue?: string;
  /** 截图 base64（captureScreenshot） */
  screenshot?: string;
  /** 执行/失败时的页面 URL（失败诊断用） */
  pageUrl?: string;
  /** 智能等待自动重试的次数（0 表示未重试） */
  retries?: number;
}

/** 操作脚本运行状态 */
export interface RpaRunState {
  /** 运行状态 */
  status: RpaRunStatus;
  /** 当前执行的宏 ID */
  macroId?: string;
  /** 当前执行到的事件索引 */
  currentCommandIndex: number;
  /** 事件执行结果 */
  results: RpaCommandResult[];
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 全局错误 */
  error?: string;
  /** 运行时变量存储 */
  variables: Record<string, string>;
  /** 循环计数器栈 */
  loopStack: LoopContext[];
  /** 当前 Tab ID */
  tabId?: number;
}

/** 循环上下文 */
export interface LoopContext {
  /** 循环类型 */
  type: 'times' | 'while';
  /** 循环起始事件索引 */
  startIndex: number;
  /** 当前迭代次数 */
  currentIteration: number;
  /** 最大迭代次数（times） */
  maxIterations?: number;
  /** 条件表达式（while） */
  condition?: string;
}

// ========== 元素定位 ==========

/** 定位器类型 */
export enum RpaLocatorType {
  CSS = 'css',
  XPath = 'xpath',
  ID = 'id',
  Name = 'name',
  LinkText = 'linkText',
  PartialLinkText = 'partialLinkText',
  TagName = 'tagName',
}

/** 定位器信息 */
export interface RpaLocator {
  /** 定位器类型 */
  type: RpaLocatorType;
  /** 定位器值 */
  value: string;
  /** 可信度（0-1） */
  confidence: number;
}

// ========== 录制 ==========

/** 录制状态 */
export enum RpaRecordingStatus {
  Idle = 'idle',
  Recording = 'recording',
  Paused = 'paused',
}

/** 录制事件类型 */
export enum RpaRecordEventType {
  Click = 'click',
  DblClick = 'dblclick',
  ContextMenu = 'contextmenu',
  Input = 'input',
  Change = 'change',
  KeyDown = 'keydown',
  MouseOver = 'mouseOver',
  Select = 'select',
  Submit = 'submit',
  Scroll = 'scroll',
  Navigate = 'navigate',
}

/** 录制的原始事件 */
export interface RpaRecordedEvent {
  /** 事件类型 */
  type: RpaRecordEventType;
  /** 目标元素定位器列表（多策略） */
  locators: RpaLocator[];
  /** 事件相关值 */
  value?: string;
  /** 时间戳 */
  timestamp: number;
  /** 页面 URL */
  url: string;
  /** 额外数据 */
  meta?: Record<string, unknown>;
}

// ========== 消息类型 ==========

/** RPA 消息类型枚举 */
export enum RpaMessageType {
  // 录制控制
  START_RECORDING = 'RPA_START_RECORDING',
  STOP_RECORDING = 'RPA_STOP_RECORDING',
  PAUSE_RECORDING = 'RPA_PAUSE_RECORDING',
  RESUME_RECORDING = 'RPA_RESUME_RECORDING',
  RECORDING_EVENT = 'RPA_RECORDING_EVENT',
  RECORDING_STATUS_CHANGED = 'RPA_RECORDING_STATUS_CHANGED',
  RECORDING_COMPLETED = 'RPA_RECORDING_COMPLETED',

  // 回放控制
  START_PLAYBACK = 'RPA_START_PLAYBACK',
  STOP_PLAYBACK = 'RPA_STOP_PLAYBACK',
  PAUSE_PLAYBACK = 'RPA_PAUSE_PLAYBACK',
  RESUME_PLAYBACK = 'RPA_RESUME_PLAYBACK',
  STEP_PLAYBACK = 'RPA_STEP_PLAYBACK',
  PLAYBACK_STATUS_CHANGED = 'RPA_PLAYBACK_STATUS_CHANGED',
  PLAYBACK_COMMAND_RESULT = 'RPA_PLAYBACK_COMMAND_RESULT',

  // Content Script 事件执行
  EXECUTE_COMMAND = 'RPA_EXECUTE_COMMAND',
  EXECUTE_COMMAND_RESULT = 'RPA_EXECUTE_COMMAND_RESULT',

  // 回放进度通知（Background → Content Script）
  PLAYBACK_PROGRESS = 'RPA_PLAYBACK_PROGRESS',

  // 元素选择
  START_ELEMENT_PICKER = 'RPA_START_ELEMENT_PICKER',
  STOP_ELEMENT_PICKER = 'RPA_STOP_ELEMENT_PICKER',
  ELEMENT_PICKED = 'RPA_ELEMENT_PICKED',

  // 状态查询
  GET_RUN_STATE = 'RPA_GET_RUN_STATE',
  GET_RECORDING_STATUS = 'RPA_GET_RECORDING_STATUS',

  // 页面 Toast 提示（Panel/Background → Content Script）
  SHOW_PAGE_TOAST = 'RPA_SHOW_PAGE_TOAST',

  // 悬浮条控制（本项目扩展）
  SHOW_BAR = 'RPA_SHOW_BAR',
  HIDE_BAR = 'RPA_HIDE_BAR',
}

/** RPA 消息基础结构 */
export interface RpaMessage {
  type: RpaMessageType;
  payload?: unknown;
}

// ========== 配置 ==========

/** RPA 全局配置 */
export interface RpaConfig {
  /** 事件间默认延迟（ms） */
  defaultDelay: number;
  /** 元素等待超时（ms） */
  elementTimeout: number;
  /** 页面加载超时（ms） */
  pageLoadTimeout: number;
  /** 失败时截图 */
  screenshotOnError: boolean;
  /** 运行速度（1-10） */
  speed: number;
  /** 命令失败自动重试次数（智能等待，0 表示不重试） */
  maxRetries: number;
}

/** 默认配置 */
export const DEFAULT_RPA_CONFIG: RpaConfig = {
  defaultDelay: 300,
  elementTimeout: 10000,
  pageLoadTimeout: 30000,
  screenshotOnError: true,
  speed: 5,
  maxRetries: 3,
};

/** 默认运行状态 */
export const DEFAULT_RPA_RUN_STATE: RpaRunState = {
  status: RpaRunStatus.Idle,
  currentCommandIndex: -1,
  results: [],
  variables: {},
  loopStack: [],
};

// ========== 回放进度 ==========

/** 回放进度通知 Payload（Background → Content Script） */
export interface RpaPlaybackProgressPayload {
  /** 运行状态 */
  status: RpaRunStatus;
  /** 当前步骤索引（0-based） */
  currentIndex: number;
  /** 总事件数 */
  totalCommands: number;
  /** 当前事件名称 */
  commandName: string;
  /** 当前事件目标 */
  commandTarget: string;
  /** 脚本名称 */
  macroName: string;
  /** 错误信息（Error 状态时） */
  error?: string;
}

// ========== 页面 Toast ==========

/** 页面 Toast 提示类型 */
export type PageToastKind = 'success' | 'error' | 'info' | 'picking';

/** 页面 Toast 提示 Payload（Panel/Background → Content Script） */
export interface RpaPageToastPayload {
  /** 提示文本 */
  text: string;
  /** 提示类型 */
  kind: PageToastKind;
}
