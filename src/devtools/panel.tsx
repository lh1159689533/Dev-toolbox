import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom/client';
import {
  DEFAULT_RPA_RUN_STATE,
  RpaCommandType,
  RpaMessageType,
  RpaRecordingStatus,
  RpaRunStatus,
} from '../shared/rpa-types';
import type { RpaCommand, RpaMacro, RpaRunState } from '../shared/rpa-types';
import { createId, deleteScript, importScripts, listScripts, renameScript, updateScript } from '../shared/rpa-storage';
import Input from '../components/Input';
import Select from '../components/Select';
import Textarea from '../components/Textarea';
import '../styles/tokens.css';
import '../styles/scrollbar.css';
import './panel.css';

const COMMAND_OPTIONS = Object.values(RpaCommandType);

/** 回放时不读取 value 字段的命令：事件列表里隐藏 value 输入框，避免误填产生歧义 */
const NO_VALUE_COMMANDS = new Set<string>([
  RpaCommandType.Click,
  RpaCommandType.DoubleClick,
  RpaCommandType.RightClick,
  RpaCommandType.MouseOver,
  RpaCommandType.Open,
  RpaCommandType.GoBack,
  RpaCommandType.GoForward,
  RpaCommandType.Refresh,
  RpaCommandType.WaitForElementPresent,
  RpaCommandType.WaitForElementVisible,
  RpaCommandType.WaitForElementNotPresent,
  RpaCommandType.AssertElementPresent,
  RpaCommandType.VerifyElementPresent,
  RpaCommandType.AssertTitle,
  RpaCommandType.VerifyTitle,
  RpaCommandType.If,
  RpaCommandType.Else,
  RpaCommandType.ElseIf,
  RpaCommandType.End,
  RpaCommandType.While,
  RpaCommandType.Times,
  RpaCommandType.CaptureScreenshot,
  RpaCommandType.Echo,
  RpaCommandType.ScrollTo,
  RpaCommandType.ScrollToElement,
]);

type MsgKind = 'success' | 'error' | 'info' | 'loading';
type MsgState = { text: string; kind: MsgKind } | null;

/** 触发 JSON 文件下载 */
function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_') || 'script';
}

/** 将 delay 输入字符串解析为毫秒数；空/非法/负数返回 undefined（表示未设置，回退全局 speed） */
function parseDelay(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}

/** target 显示：把 ` || ` 分隔符转成换行，便于逐类型（xpath/css/id…）查看 */
function targetToLines(target: string): string {
  return target.split(/\s*\|\|\s*/).join('\n');
}

/** target 保存：把多行文本转回 ` || ` 分隔（与 targetToLines 互为逆操作，保证受控组件光标稳定） */
function linesToTarget(text: string): string {
  return text.split('\n').join(' || ');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

// ===== 内联 SVG 图标（fill=currentColor，跟随按钮文字颜色） =====
const ICON_SIZE = 16;

function RecordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z"></path>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M6 6h12v12H6z"></path>
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="currentColor" aria-hidden="true">
      <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="currentColor" aria-hidden="true">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="currentColor" aria-hidden="true">
      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  );
}

function IncreaseIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" width="1em" height="1em">
      <g id="chevron-up">
        <path
          id="stroke1"
          stroke="currentColor"
          d="M17.5 14.5L12 9L6.5 14.5"
          stroke-linecap="square"
          stroke-width="2"
        ></path>
      </g>
    </svg>
  );
}

function DecreaseIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" width="1em" height="1em">
      <g id="chevron-down">
        <path
          id="stroke1"
          stroke="currentColor"
          d="M17.5 9.5L12 15L6.5 9.5"
          stroke-linecap="square"
          stroke-width="2"
        ></path>
      </g>
    </svg>
  );
}

function ResumePlayIcon() {
  return (
    <svg viewBox="0 0 1042 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55355" width="14" height="14">
      <path
        d="M506.514286 91.428571c-102.4-1.828571-197.485714 31.085714-274.285715 93.257143l21.942858-73.142857L184.685714 91.428571l-45.714285 151.771429c-5.485714 20.114286 5.485714 40.228571 23.771428 45.714286l151.771429 45.714285 20.114285-69.485714-62.171428-18.285714c60.342857-47.542857 131.657143-76.8 210.285714-80.457143 197.485714-9.142857 371.2 144.457143 384 341.942857 12.8 212.114286-155.428571 389.485714-365.714286 389.485714-201.142857 0-365.714286-164.571429-365.714285-365.714285h-73.142857c0 241.371429 197.485714 438.857143 438.857142 438.857143 246.857143 0 446.171429-202.971429 438.857143-451.657143C934.4 285.257143 740.571429 93.257143 506.514286 91.428571z"
        p-id="55356"
      ></path>
      <path
        d="M444.342857 782.628571c9.142857 0 18.285714-3.657143 25.6-10.971428l219.428572-219.428572c14.628571-14.628571 14.628571-36.571429 0-51.2l-219.428572-219.428571c-10.971429-10.971429-25.6-12.8-40.228571-7.314286-12.8 5.485714-21.942857 18.285714-21.942857 32.914286v438.857143c0 14.628571 9.142857 27.428571 21.942857 32.914286 5.485714 3.657143 10.971429 3.657143 14.628571 3.657142z m36.571429-387.657142l131.657143 131.657142-131.657143 131.657143V394.971429z"
        p-id="55357"
      ></path>
    </svg>
  );
}

function DevtoolsPanel() {
  const [scripts, setScripts] = useState<RpaMacro[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const [selectedCmdIndex, setSelectedCmdIndex] = useState<number | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  const [playbackState, setPlaybackState] = useState<RpaRunState>({ ...DEFAULT_RPA_RUN_STATE });
  const [recordingStatus, setRecordingStatus] = useState<RpaRecordingStatus>(RpaRecordingStatus.Idle);
  // 诊断视图开关：回放失败后点击错误行「诊断」按钮切换到诊断视图
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const scriptsRef = useRef<RpaMacro[]>([]);
  // 串行写队列：保证 storage 写入顺序一致，避免并发覆盖
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  // 供消息监听器读取最新状态
  const selectedIdRef = useRef<string | null>(null);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 长连接端口：MV3 service worker 空闲回收会断开端口，改用「下次使用时按需重连」
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    scriptsRef.current = scripts;
  }, [scripts]);
  useEffect(() => {
    return () => {
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    };
  }, []);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;

  /** 显示一条消息：success/info 5 秒后自动消失，error/loading 保持常驻 */
  const showMsg = useCallback((text: string, kind: MsgKind = 'info') => {
    if (msgTimerRef.current) {
      clearTimeout(msgTimerRef.current);
      msgTimerRef.current = null;
    }
    setMsg({ text, kind });
    if (kind === 'success' || kind === 'info') {
      msgTimerRef.current = setTimeout(() => setMsg(null), 5000);
    }
  }, []);

  const clearMsg = useCallback(() => {
    if (msgTimerRef.current) {
      clearTimeout(msgTimerRef.current);
      msgTimerRef.current = null;
    }
    setMsg(null);
  }, []);

  /** 在目标网页右下角显示 Toast 提示（经 background 转发到 content script） */
  const showPageToast = useCallback((text: string, kind: MsgKind) => {
    void chrome.runtime
      .sendMessage({
        type: RpaMessageType.SHOW_PAGE_TOAST,
        payload: { text, kind, tabId: chrome.devtools.inspectedWindow.tabId },
      })
      .catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    const list = await listScripts();
    setScripts(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await reload();
      if (list.length) setSelectedId(list[0].id);
    })();
  }, [reload]);

  // 监听网页取点结果，回填到「选中行事件」的 target
  // 注：DevTools panel 收不到 runtime.sendMessage 的广播，改用长连接点对点接收
  const handlePortMessage = useCallback(
    (message: { type?: string; payload?: unknown }): void => {
      if (message.type === RpaMessageType.PLAYBACK_STATUS_CHANGED) {
        const nextState = message.payload as RpaRunState;
        setPlaybackState(nextState);
        return;
      }
      if (message.type === RpaMessageType.RECORDING_STATUS_CHANGED) {
        const status = (message.payload as { status?: RpaRecordingStatus } | undefined)?.status;
        if (status) setRecordingStatus(status);
        return;
      }
      if (message.type === RpaMessageType.RECORDING_COMPLETED) {
        void reload();
        return;
      }
    },
    [reload],
  );

  /** 建立与 background 的长连接（连接成功后同步一次当前运行状态） */
  const connectPort = useCallback(() => {
    if (disposedRef.current || portRef.current) return;
    const port = chrome.runtime.connect({ name: 'rpa-devtools-panel' });
    portRef.current = port;
    port.onMessage.addListener(handlePortMessage);
    // SW 被回收会断开端口：这里只标记失效，不立即重连，等下次使用时由 ensurePort 按需重建
    port.onDisconnect.addListener(() => {
      if (portRef.current === port) portRef.current = null;
    });
    // 面板可能后于回放启动（或重连时错过了推送），连接成功后查询一次当前运行状态
    void chrome.runtime
      .sendMessage({ type: RpaMessageType.GET_RUN_STATE })
      .then((res) => {
        const data = (res as { data?: RpaRunState } | undefined)?.data;
        if (data && !disposedRef.current) setPlaybackState(data);
      })
      .catch(() => {});
  }, [handlePortMessage]);

  /** 下次使用时按需重连：若端口已被 SW 回收断开，则重建连接 */
  const ensurePort = useCallback(() => {
    if (!portRef.current) connectPort();
  }, [connectPort]);

  useEffect(() => {
    disposedRef.current = false;
    connectPort();
    return () => {
      disposedRef.current = true;
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [connectPort]);

  /** 串行写入 storage（每次调用立即入队，保证顺序） */
  const persistScript = (script: RpaMacro): Promise<void> => {
    const run = writeChainRef.current.then(() => updateScript(script));
    writeChainRef.current = run.catch(() => {});
    return run;
  };

  /** 就地更新某个脚本：本地状态即时更新，storage 串行写 */
  const mutate = (scriptId: string, updater: (s: RpaMacro) => RpaMacro) => {
    const script = scriptsRef.current.find((s) => s.id === scriptId);
    if (!script) return;
    const next = updater(script);
    setScripts((prev) => prev.map((s) => (s.id === scriptId ? next : s)));
    void persistScript(next);
  };

  // ===== 事件级操作（即时保存） =====
  const updateCommandField = (
    scriptId: string,
    index: number,
    field: 'command' | 'target' | 'value',
    value: string,
  ) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: s.commands.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    }));
  };

  /** 就地更新某条事件的 delay（毫秒；留空即未设置） */
  const updateCommandDelay = (scriptId: string, index: number, raw: string) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: s.commands.map((c, i) => (i === index ? { ...c, delay: parseDelay(raw) } : c)),
    }));
  };

  /** 切换某条事件的启用状态（眼睛开关；open 事件由 UI 层禁止调用） */
  const toggleCommandEnabled = (scriptId: string, index: number) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: s.commands.map((c, i) => (i === index ? { ...c, enabled: c.enabled === false } : c)),
    }));
  };

  /** 步进调整某条事件的 delay（毫秒），最小 0 */
  const stepDelay = (scriptId: string, index: number, delta: number) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: s.commands.map((c, i) => (i === index ? { ...c, delay: Math.max(0, (c.delay ?? 0) + delta) } : c)),
    }));
  };

  const moveCommand = (scriptId: string, from: number, to: number) => {
    mutate(scriptId, (s) => {
      const commands = [...s.commands];
      const [item] = commands.splice(from, 1);
      commands.splice(to, 0, item);
      return { ...s, updatedAt: Date.now(), commands };
    });
  };

  const removeCommand = (scriptId: string, index: number) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: s.commands.filter((_, i) => i !== index),
    }));
    setSelectedCmdIndex((prev) => {
      if (prev == null) return null;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
  };

  const addCommand = (scriptId: string) => {
    mutate(scriptId, (s) => ({
      ...s,
      updatedAt: Date.now(),
      commands: [...s.commands, { id: createId(), command: RpaCommandType.Click, target: '', value: '' }],
    }));
  };

  /** 在指定行之后插入一条新事件 */
  const addCommandAfter = (scriptId: string, index: number) => {
    mutate(scriptId, (s) => {
      const commands = [...s.commands];
      commands.splice(index + 1, 0, { id: createId(), command: RpaCommandType.Click, target: '', value: '' });
      return { ...s, updatedAt: Date.now(), commands };
    });
  };

  /** 更新当前脚本的回放速度（1-10） */
  const updateSpeed = (scriptId: string, value: number) => {
    mutate(scriptId, (s) => ({ ...s, speed: value, updatedAt: Date.now() }));
  };

  // ===== 脚本级操作 =====
  const handleExport = (script: RpaMacro) => {
    showMsg('导出中...', 'loading');
    window.setTimeout(() => {
      try {
        downloadJson(`${safeFilename(script.name)}.json`, script);
        showMsg('导出成功', 'success');
      } catch {
        showMsg('导出失败', 'error');
      }
    }, 300);
  };

  const handleExportAll = () => {
    showMsg('导出中...', 'loading');
    window.setTimeout(() => {
      try {
        downloadJson('rpa-scripts.json', scripts);
        showMsg('导出成功', 'success');
      } catch {
        showMsg('导出失败', 'error');
      }
    }, 300);
  };

  const handleImportFile = (file: File) => {
    // 选择文件后立即显示 loading，覆盖「读文件 + 解析 + 写入」全过程
    showMsg('导入中...', 'loading');
    const reader = new FileReader();
    reader.onerror = () => {
      showMsg('导入失败：文件读取失败', 'error');
    };
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const valid: RpaMacro[] = [];
        for (const item of list) {
          if (item && typeof item === 'object') {
            const s = item as RpaMacro;
            if (Array.isArray(s.commands)) valid.push(s);
          }
        }
        if (valid.length === 0) {
          showMsg('导入失败：未找到有效脚本', 'error');
          return;
        }
        // 保证 loading 至少可见（storage 写入极快，否则会被成功提示瞬间覆盖）
        const minDelay = new Promise<void>((resolve) => window.setTimeout(resolve, 300));
        void Promise.all([importScripts(valid), minDelay])
          .then(async ([{ imported, skipped }]) => {
            const next = await reload();
            if (!selectedIdRef.current && next.length) setSelectedId(next[0].id);
            showMsg(skipped > 0 ? `已导入 ${imported} 个，跳过 ${skipped} 个` : `已导入 ${imported} 个`, 'success');
          })
          .catch(() => {
            showMsg('导入失败', 'error');
          });
      } catch {
        showMsg('导入失败：JSON 解析错误', 'error');
      }
    };
    reader.readAsText(file);
  };

  const startRename = (script: RpaMacro) => {
    setRenamingId(script.id);
    setRenamingName(script.name);
  };

  const commitRename = async (scriptId: string) => {
    const script = scriptsRef.current.find((s) => s.id === scriptId);
    const name = renamingName.trim();
    if (script && name && name !== script.name) {
      await renameScript(scriptId, name);
      await reload();
    }
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenamingName('');
  };

  const handleDeleteScript = async (scriptId: string) => {
    const script = scriptsRef.current.find((s) => s.id === scriptId);
    if (!script) return;
    if (!window.confirm(`确定删除脚本「${script.name}」吗？`)) return;
    await deleteScript(scriptId);
    const idx = scriptsRef.current.findIndex((s) => s.id === scriptId);
    const remaining = scriptsRef.current.filter((s) => s.id !== scriptId);
    setScripts(remaining);
    if (selectedIdRef.current === scriptId) {
      setSelectedCmdIndex(null);
      setSelectedId(remaining.length ? remaining[Math.min(idx, remaining.length - 1)].id : null);
    }
  };

  // ===== 录制 =====
  const isRecording = recordingStatus === RpaRecordingStatus.Recording;

  const handleRecordToggle = () => {
    ensurePort();
    if (isRecording) {
      void chrome.runtime.sendMessage({ type: RpaMessageType.STOP_RECORDING }).catch(() => {});
    } else {
      void chrome.runtime
        .sendMessage({
          type: RpaMessageType.START_RECORDING,
          payload: { tabId: chrome.devtools.inspectedWindow.tabId },
        })
        .then((res) => {
          const result = res as { success?: boolean; error?: string } | undefined;
          if (result && result.success === false) {
            showMsg(result.error || '启动录制失败', 'error');
          }
        })
        .catch(() => {});
    }
  };

  // ===== 回放 =====
  const handlePlay = (startIndex?: number) => {
    if (!selected) return;
    ensurePort();
    void chrome.runtime.sendMessage({
      type: RpaMessageType.START_PLAYBACK,
      payload: { macroId: selected.id, tabId: chrome.devtools.inspectedWindow.tabId, startIndex },
    });
    showPageToast(startIndex != null ? `已从第 ${startIndex + 1} 步开始回放` : '已开始回放', 'success');
  };

  // 失败诊断：回放失败时的最后一条结果（含截图、URL、重试次数）
  const failedResult =
    playbackState.status === RpaRunStatus.Error
      ? (playbackState.results[playbackState.results.length - 1] ?? null)
      : null;

  // 回放控件只对「正在回放/暂停的那个脚本」显示；其它脚本显示正常的「回放」按钮
  const isActivePlayback =
    selected != null &&
    playbackState.macroId === selected.id &&
    (playbackState.status === RpaRunStatus.Running || playbackState.status === RpaRunStatus.Paused);

  const handlePause = () => {
    void chrome.runtime.sendMessage({ type: RpaMessageType.PAUSE_PLAYBACK });
  };

  const handleResume = () => {
    void chrome.runtime.sendMessage({ type: RpaMessageType.RESUME_PLAYBACK });
  };

  const handleStop = () => {
    void chrome.runtime.sendMessage({ type: RpaMessageType.STOP_PLAYBACK });
  };

  const selectScript = (id: string) => {
    setSelectedId(id);
    setSelectedCmdIndex(null);
    // 切换脚本时退出「回放失败诊断」视图，避免右侧仍停留在上一个脚本的错误页
    setShowDiagnosis(false);
  };

  const renderCommand = (cmd: RpaCommand, i: number) => {
    const scriptId = selected!.id;
    const isExecuting =
      (playbackState.status === RpaRunStatus.Running || playbackState.status === RpaRunStatus.Paused) &&
      selected!.id === playbackState.macroId &&
      playbackState.currentCommandIndex === i;
    const isFailed =
      playbackState.status === RpaRunStatus.Error &&
      selected!.id === playbackState.macroId &&
      playbackState.currentCommandIndex === i;
    return (
      <div
        key={cmd.id ?? i}
        className={`dt-cmd-row${selectedCmdIndex === i ? ' selected' : ''}${
          isExecuting ? ' executing' : ''
        }${isFailed ? ' failed' : ''}${cmd.enabled === false ? ' disabled' : ''}`}
        onClick={() => setSelectedCmdIndex(i)}
      >
        <span className="dt-cmd-index">{i + 1}</span>
        <Select
          size="small"
          className="dt-cmd-select"
          value={cmd.command}
          options={COMMAND_OPTIONS.map((c) => ({ value: c, label: c }))}
          onChange={(v) => updateCommandField(scriptId, i, 'command', v)}
        />
        <Textarea
          size="small"
          className="dt-cmd-input dt-cmd-target"
          rows={1}
          placeholder="target（定位器）"
          value={targetToLines(cmd.target)}
          onChange={(e) => updateCommandField(scriptId, i, 'target', linesToTarget(e.target.value))}
        />
        {
          <Input
            size="small"
            className="dt-cmd-value"
            placeholder="value（参数）"
            value={cmd.value}
            onChange={(e) => updateCommandField(scriptId, i, 'value', e.target.value)}
            style={{ visibility: NO_VALUE_COMMANDS.has(cmd.command) ? 'hidden' : 'visible' }}
          />
        }
        <div className="dt-cmd-delay-wrap" onClick={(e) => e.stopPropagation()}>
          <Input
            size="small"
            className="dt-cmd-delay"
            placeholder="delay(ms)"
            type="number"
            min={0}
            step={100}
            title="该步执行后等待的毫秒数（留空则用全局速度）"
            value={cmd.delay ?? ''}
            onChange={(e) => updateCommandDelay(scriptId, i, e.target.value)}
          />
          <span className="dt-delay-stepper">
            <button
              type="button"
              className="dt-delay-btn increase"
              title="增加 100ms"
              onClick={() => stepDelay(scriptId, i, 100)}
            >
              <IncreaseIcon />
            </button>
            <button
              type="button"
              className={`dt-delay-btn decrease ${cmd.delay === 0 ? 'disabled' : ''}`}
              title="减少 100ms"
              onClick={() => stepDelay(scriptId, i, -100)}
            >
              <DecreaseIcon />
            </button>
          </span>
        </div>
        <span className="dt-cmd-actions" onClick={(e) => e.stopPropagation()}>
          {isFailed && (
            <>
              <button type="button" className="dt-icon-btn danger" onClick={() => setShowDiagnosis(true)}>
                详情
              </button>
              <button type="button" className="dt-icon-btn icon" onClick={() => handlePlay(i)} title="继续回放">
                <ResumePlayIcon />
              </button>
            </>
          )}
          <button
            type="button"
            className="dt-icon-btn icon"
            disabled={i === 0}
            onClick={() => moveCommand(scriptId, i, i - 1)}
            title="上移"
          >
            ↑
          </button>
          <button
            type="button"
            className="dt-icon-btn icon"
            disabled={i === selected!.commands.length - 1}
            onClick={() => moveCommand(scriptId, i, i + 1)}
            title="下移"
          >
            ↓
          </button>
          {cmd.command !== RpaCommandType.Open && (
            <button
              type="button"
              className={`dt-icon-btn icon${cmd.enabled === false ? ' eye-off' : ''}`}
              onClick={() => toggleCommandEnabled(scriptId, i)}
              title={cmd.enabled === false ? '回放时跳过，点击启用' : '回放时执行，点击跳过'}
            >
              {cmd.enabled === false ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
          <button
            type="button"
            className="dt-icon-btn icon"
            onClick={() => addCommandAfter(scriptId, i)}
            title="新增事件"
          >
            <PlusIcon />
          </button>
          {cmd.command !== RpaCommandType.Open && (
            <button
              type="button"
              className="dt-icon-btn danger icon"
              onClick={() => removeCommand(scriptId, i)}
              title="删除"
            >
              <TrashIcon />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="dt-app">
      {/* 左侧：脚本列表 */}
      <aside className="dt-left">
        <div className="dt-left-head">
          <div className="dt-left-title">操作脚本</div>
          <div className="dt-left-actions">
            <button
              type="button"
              className={`icon dt-icon-action${isRecording ? ' danger' : ''}`}
              onClick={handleRecordToggle}
              title={isRecording ? '停止录制' : '开始录制'}
            >
              {isRecording ? <StopIcon /> : <RecordIcon />}
            </button>
            <button type="button" className="dt-icon-action icon" onClick={() => fileRef.current?.click()} title="导入">
              <ImportIcon />
            </button>
            <button
              type="button"
              className="dt-icon-action icon"
              onClick={handleExportAll}
              disabled={scripts.length === 0}
              title="导出全部"
            >
              <ExportIcon />
            </button>
            <button type="button" className="dt-icon-action icon" onClick={() => void reload()} title="刷新">
              <RefreshIcon />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {scripts.length === 0 ? (
          <div className="dt-empty">暂无脚本，点击「导入」或通过悬浮条录制</div>
        ) : (
          <ul className="dt-script-list">
            {scripts.map((s) => {
              const isPlaying = s.id === playbackState.macroId && playbackState.status === RpaRunStatus.Running;
              const isPaused = s.id === playbackState.macroId && playbackState.status === RpaRunStatus.Paused;
              const playbackCls = isPlaying ? ' playing' : isPaused ? ' paused' : '';
              return (
                <li
                  key={s.id}
                  className={`dt-script-item${s.id === selectedId ? ' selected' : ''}${playbackCls}`}
                  onClick={() => selectScript(s.id)}
                >
                  <div className="dt-script-name-row">
                    {renamingId === s.id ? (
                      <Input
                        size="small"
                        className="dt-rename-input"
                        value={renamingName}
                        onChange={(e) => setRenamingName(e.target.value)}
                        onBlur={() => void commitRename(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(s.id);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <div className="dt-script-name" title={s.name}>
                        {s.name}
                      </div>
                    )}
                    {isPlaying && <span className="dt-script-badge dt-script-badge--playing">▶ 回放中</span>}
                    {isPaused && <span className="dt-script-badge dt-script-badge--paused">⏸ 已暂停</span>}
                    <span className="dt-script-item-actions" onClick={(e) => e.stopPropagation()}>
                      <span onClick={() => startRename(s)} title="重命名">
                        <EditIcon />
                      </span>
                      <span onClick={() => handleExport(s)} title="导出">
                        <ExportIcon />
                      </span>
                      <span onClick={() => void handleDeleteScript(s.id)} title="删除" className="danger">
                        <TrashIcon />
                      </span>
                    </span>
                  </div>
                  <div className="dt-script-meta">
                    {formatTime(s.createdAt)} · {s.commands.length} 条事件
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* 右侧：脚本详情 */}
      <section className="dt-right">
        {msg && (
          <div className={`dt-msg dt-msg--${msg.kind}`}>
            {msg.kind === 'loading' && <span className="dt-msg-spinner" aria-hidden="true" />}
            <span className="dt-msg-text">{msg.text}</span>
            {msg.kind === 'error' && (
              <button type="button" className="dt-msg-close icon" onClick={clearMsg} aria-label="关闭">
                ×
              </button>
            )}
          </div>
        )}

        {!selected ? (
          <div className="dt-empty">请选择一个脚本</div>
        ) : showDiagnosis && failedResult ? (
          <div className="dt-failure-view">
            <div className="dt-failure-head">
              <span className="dt-failure-title">回放失败诊断</span>
              <button type="button" className="dt-btn" onClick={() => setShowDiagnosis(false)}>
                返回事件列表
              </button>
            </div>
            <div className="dt-failure-body">
              <div className="dt-failure-step">
                第 {playbackState.currentCommandIndex + 1} 步 · {failedResult.command.command}
                {failedResult.retries ? ` · 已自动重试 ${failedResult.retries} 次` : ''}
              </div>
              <div className="dt-failure-error">{failedResult.error || playbackState.error}</div>
              {failedResult.pageUrl && <div className="dt-failure-url">{failedResult.pageUrl}</div>}
              {failedResult.screenshot && (
                <img className="dt-failure-screenshot" src={failedResult.screenshot} alt="失败页面截图" />
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="dt-cmd-toolbar">
              <span className="dt-cmd-title">事件列表</span>
              <div className="dt-cmd-toolbar-right">
                <span className="dt-speed-word">慢</span>
                <input
                  type="range"
                  className="dt-speed-range"
                  min={1}
                  max={10}
                  step={1}
                  value={selected.speed ?? 5}
                  style={{ '--speed-fill': `${(((selected.speed ?? 5) - 1) / 9) * 100}%` } as CSSProperties}
                  onChange={(e) => updateSpeed(selected.id, Number(e.target.value))}
                />
                <span className="dt-speed-word">快</span>
                <span className="dt-speed-value">{selected.speed ?? 5}</span>
                {isActivePlayback && playbackState.status === RpaRunStatus.Running && (
                  <button type="button" className="dt-icon-btn" onClick={handlePause}>
                    暂停
                  </button>
                )}
                {isActivePlayback && playbackState.status === RpaRunStatus.Paused && (
                  <button type="button" className="dt-icon-btn" onClick={handleResume}>
                    继续
                  </button>
                )}
                {isActivePlayback && (
                  <button type="button" className="dt-icon-btn" onClick={handleStop}>
                    停止
                  </button>
                )}
                {!isActivePlayback && (
                  <button type="button" className="dt-icon-btn" onClick={() => handlePlay()}>
                    回放
                  </button>
                )}
              </div>
            </div>

            <div className="dt-cmd-list">
              {selected.commands.length === 0 ? (
                <div className="dt-empty">
                  <span>暂无事件</span>
                  <button
                    type="button"
                    className="dt-icon-btn"
                    onClick={() => addCommand(selected.id)}
                    title="新增事件"
                  >
                    <PlusIcon />
                  </button>
                </div>
              ) : (
                selected.commands.map((cmd, i) => renderCommand(cmd, i))
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DevtoolsPanel />);
