import { useCallback, useEffect, useRef, useState } from 'react';
import { RpaCommandType, RpaMessageType } from '../../shared/rpa-types';
import type { RpaCommand, RpaLocator, RpaMacro } from '../../shared/rpa-types';
import {
  createId,
  deleteScript,
  getScript,
  importScripts,
  listScripts,
  renameScript,
  updateScript,
} from '../../shared/rpa-storage';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import './index.css';

const COMMAND_OPTIONS = Object.values(RpaCommandType);

type ViewMode = 'form' | 'json';

/** 单条事件的编辑草稿 */
interface EditDraft {
  index: number;
  command: string;
  target: string;
  value: string;
  delay: string;
}

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

/** 根据事件类型返回样式分类 */
function commandCategory(cmd: string): string {
  if (['open', 'goBack', 'goForward', 'refresh'].includes(cmd)) return 'navigate';
  if (['pause', 'waitForElementPresent', 'waitForElementVisible', 'waitForElementNotPresent'].includes(cmd)) {
    return 'wait';
  }
  return '';
}

/** 将 delay 输入字符串解析为毫秒数；空/非法/负数返回 undefined（表示未设置，回退全局 speed） */
function parseDelay(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}

export default function RpaRecorder() {
  const tool = getToolById('rpa-recorder');
  const [scripts, setScripts] = useState<RpaMacro[]>([]);
  const [msg, setMsg] = useState('');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  // 每脚本同时仅一条事件处于编辑态：scriptId -> commandIndex
  const [editingCommand, setEditingCommand] = useState<Record<string, number | undefined>>({});
  // 每脚本的编辑草稿（未保存前不回写 storage）
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft | undefined>>({});
  // JSON 视图的文本草稿与解析错误
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  // 元素取点（保留能力，当前列表页不触发取点入口）
  const [pickTarget, setPickTarget] = useState<{ scriptId: string; commandIndex: number } | null>(null);
  const pickTargetRef = useRef(pickTarget);
  pickTargetRef.current = pickTarget;
  const fileRef = useRef<HTMLInputElement>(null);
  // JSON 防抖保存的定时器
  const jsonDebounceRef = useRef<Record<string, number>>({});

  const reload = useCallback(async () => {
    setScripts(await listScripts());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 监听元素选择结果，回填到「当前选中的事件」的 target（能力保留，供后续扩展使用）
  useEffect(() => {
    const listener = (message: { type?: string; payload?: unknown }): void => {
      if (message.type !== RpaMessageType.ELEMENT_PICKED) return;
      const payload = message.payload as { locators?: RpaLocator[] };
      const locator = payload.locators?.[0];
      if (!locator) return;

      const current = pickTargetRef.current;
      if (!current) return;

      const target = `${locator.type}=${locator.value}`;
      void (async () => {
        const script = await getScript(current.scriptId);
        if (!script) return;
        const next: RpaMacro = {
          ...script,
          commands: script.commands.map((c, i) => (i === current.commandIndex ? { ...c, target } : c)),
        };
        await updateScript(next);
        pickTargetRef.current = null;
        setPickTarget(null);
        setMsg(`已回填元素定位：${target}`);
        await reload();
      })();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [reload]);

  /** 就地修改某个脚本并写回 storage，同时更新本地状态 */
  const mutateScript = async (scriptId: string, updater: (s: RpaMacro) => RpaMacro) => {
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const next = updater(script);
    await updateScript(next);
    setScripts((prev) => prev.map((s) => (s.id === scriptId ? next : s)));
  };

  // ===== 脚本级操作 =====
  const handleExport = (script: RpaMacro) => {
    downloadJson(`${safeFilename(script.name)}.json`, script);
  };

  const handleExportAll = () => {
    downloadJson('rpa-scripts.json', scripts);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const valid: RpaMacro[] = [];
        for (const item of list) {
          if (item && typeof item === 'object') {
            const s = item as RpaMacro;
            if (typeof s.id === 'string' && Array.isArray(s.commands)) valid.push(s);
          }
        }
        if (valid.length === 0) {
          setMsg('导入失败：未找到有效脚本');
          return;
        }
        void importScripts(valid).then(async () => {
          await reload();
          setMsg(`已导入 ${valid.length} 个脚本`);
        });
      } catch {
        setMsg('导入失败：JSON 解析错误');
      }
    };
    reader.readAsText(file);
  };

  const startRename = (script: RpaMacro) => {
    setRenamingId(script.id);
    setRenamingName(script.name);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const name = renamingName.trim();
    if (name) await renameScript(renamingId, name);
    setRenamingId(null);
    await reload();
  };

  const handleDelete = async (script: RpaMacro) => {
    if (!window.confirm(`确定删除脚本「${script.name}」吗？`)) return;
    await deleteScript(script.id);
    setExpandedIds((prev) => prev.filter((id) => id !== script.id));
    await reload();
  };

  // ===== 展开 / 收起 =====
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const isExpanded = (id: string) => expandedIds.includes(id);

  // ===== 视图切换 =====
  const switchView = (id: string, mode: ViewMode) => {
    setViewModes((prev) => ({ ...prev, [id]: mode }));
    if (mode === 'json') {
      const script = scripts.find((s) => s.id === id);
      if (script) {
        setJsonDrafts((prev) => ({
          ...prev,
          [id]: JSON.stringify(script.commands, null, 2),
        }));
      }
    }
  };

  // ===== 事件级操作 =====
  const moveCommand = (scriptId: string, from: number, to: number) => {
    void mutateScript(scriptId, (s) => {
      const commands = [...s.commands];
      const [item] = commands.splice(from, 1);
      commands.splice(to, 0, item);
      return { ...s, commands };
    });
  };

  const removeCommand = (scriptId: string, index: number) => {
    void mutateScript(scriptId, (s) => ({
      ...s,
      commands: s.commands.filter((_, i) => i !== index),
    }));
  };

  const addCommand = (scriptId: string) => {
    void mutateScript(scriptId, (s) => ({
      ...s,
      commands: [...s.commands, { id: createId(), command: RpaCommandType.Click, target: '', value: '' }],
    }));
  };

  /** 行内就地更新某条事件的 delay（毫秒；留空即未设置） */
  const updateCommandDelay = (scriptId: string, index: number, raw: string) => {
    void mutateScript(scriptId, (s) => ({
      ...s,
      commands: s.commands.map((c, i) => (i === index ? { ...c, delay: parseDelay(raw) } : c)),
    }));
  };

  // ===== 行级编辑态 =====
  const startEdit = (scriptId: string, index: number) => {
    const script = scripts.find((s) => s.id === scriptId);
    const cmd = script?.commands[index];
    if (!cmd) return;
    setEditingCommand((prev) => ({ ...prev, [scriptId]: index }));
    setEditDrafts((prev) => ({
      ...prev,
      [scriptId]: {
        index,
        command: cmd.command,
        target: cmd.target,
        value: cmd.value,
        delay: cmd.delay?.toString() ?? '',
      },
    }));
  };

  const updateDraftField = (scriptId: string, field: 'command' | 'target' | 'value' | 'delay', value: string) => {
    setEditDrafts((prev) => {
      const draft = prev[scriptId];
      if (!draft) return prev;
      return { ...prev, [scriptId]: { ...draft, [field]: value } };
    });
  };

  const saveEdit = async (scriptId: string) => {
    const draft = editDrafts[scriptId];
    if (!draft) return;
    await mutateScript(scriptId, (s) => ({
      ...s,
      commands: s.commands.map((c, i) =>
        i === draft.index
          ? {
              ...c,
              command: draft.command,
              target: draft.target,
              value: draft.value,
              delay: parseDelay(draft.delay),
            }
          : c,
      ),
    }));
    setEditingCommand((prev) => ({ ...prev, [scriptId]: undefined }));
    setEditDrafts((prev) => ({ ...prev, [scriptId]: undefined }));
  };

  const cancelEdit = (scriptId: string) => {
    setEditingCommand((prev) => ({ ...prev, [scriptId]: undefined }));
    setEditDrafts((prev) => ({ ...prev, [scriptId]: undefined }));
  };

  // ===== JSON 视图（实时防抖保存） =====
  const onJsonChange = (scriptId: string, text: string) => {
    setJsonDrafts((prev) => ({ ...prev, [scriptId]: text }));
    const existing = jsonDebounceRef.current[scriptId];
    if (existing) window.clearTimeout(existing);
    jsonDebounceRef.current[scriptId] = window.setTimeout(() => {
      void commitJson(scriptId, text);
    }, 500);
  };

  const commitJson = async (scriptId: string, text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        setJsonErrors((prev) => ({ ...prev, [scriptId]: 'commands 必须是数组' }));
        return;
      }
      const commands: RpaCommand[] = parsed.map((item) => {
        if (!item || typeof item !== 'object') {
          throw new Error('每条事件必须是对象');
        }
        const obj = item as Record<string, unknown>;
        return {
          id: typeof obj.id === 'string' && obj.id ? obj.id : createId(),
          command: typeof obj.command === 'string' ? obj.command : '',
          target: typeof obj.target === 'string' ? obj.target : '',
          value: typeof obj.value === 'string' ? obj.value : '',
          ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
          ...(typeof obj.delay === 'number' && Number.isFinite(obj.delay) ? { delay: obj.delay } : {}),
        };
      });
      // 从 storage 读取最新脚本，避免闭包过期
      const script = await getScript(scriptId);
      if (!script) return;
      const next: RpaMacro = { ...script, commands };
      await updateScript(next);
      setScripts((prev) => prev.map((s) => (s.id === scriptId ? next : s)));
      setJsonErrors((prev) => {
        const nextErr = { ...prev };
        delete nextErr[scriptId];
        return nextErr;
      });
    } catch (e) {
      setJsonErrors((prev) => ({
        ...prev,
        [scriptId]: e instanceof Error ? e.message : 'JSON 解析错误',
      }));
    }
  };

  const renderCommandRow = (s: RpaMacro, cmd: RpaCommand, i: number) => {
    const editingIndex = editingCommand[s.id];
    const draft = editDrafts[s.id];
    const isEditingThis = editingIndex === i;
    const hasEditing = typeof editingIndex === 'number';

    if (isEditingThis && draft) {
      return (
        <div key={cmd.id ?? i} className="rpa-step rpa-step-editing">
          <span className="rpa-step-index">{i + 1}</span>
          <Select
            size="small"
            className="rpa-cmd-select"
            value={draft.command}
            options={COMMAND_OPTIONS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => updateDraftField(s.id, 'command', v)}
          />
          <Input
            size="small"
            placeholder="target（定位器）"
            value={draft.target}
            onChange={(e) => updateDraftField(s.id, 'target', e.target.value)}
          />
          <Input
            size="small"
            placeholder="value（参数）"
            value={draft.value}
            onChange={(e) => updateDraftField(s.id, 'value', e.target.value)}
          />
          <Input
            size="small"
            placeholder="delay(ms)"
            title="该步执行后等待的毫秒数（留空则用全局速度）"
            value={draft.delay}
            onChange={(e) => updateDraftField(s.id, 'delay', e.target.value)}
          />
          <span className="rpa-step-actions">
            <button type="button" className="rpa-step-btn" onClick={() => void saveEdit(s.id)}>
              保存
            </button>
            <button type="button" className="rpa-step-btn" onClick={() => cancelEdit(s.id)}>
              取消
            </button>
          </span>
        </div>
      );
    }

    return (
      <div key={cmd.id ?? i} className="rpa-step">
        <span className="rpa-step-index">{i + 1}</span>
        <span className={`rpa-step-type type-${commandCategory(cmd.command)}`}>{cmd.command}</span>
        <span className="rpa-step-field" title={cmd.target}>
          {cmd.target || '-'}
        </span>
        <span className="rpa-step-field" title={cmd.value}>
          {cmd.value || '-'}
        </span>
        <Input
          size="small"
          placeholder="delay(ms)"
          title="该步执行后等待的毫秒数（留空则用全局速度）"
          defaultValue={cmd.delay ?? ''}
          key={`delay-${cmd.id ?? i}`}
          onBlur={(e) => updateCommandDelay(s.id, i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="rpa-step-actions">
          <button type="button" className="rpa-step-btn" disabled={i === 0} onClick={() => moveCommand(s.id, i, i - 1)}>
            ↑
          </button>
          <button
            type="button"
            className="rpa-step-btn"
            disabled={i === s.commands.length - 1}
            onClick={() => moveCommand(s.id, i, i + 1)}
          >
            ↓
          </button>
          <button type="button" className="rpa-step-btn" disabled={hasEditing} onClick={() => startEdit(s.id, i)}>
            编辑
          </button>
          <button type="button" className="rpa-step-btn danger" onClick={() => removeCommand(s.id, i)}>
            删除
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="rpa-app">
      <PageHeader title={tool?.name ?? '操作录制'} subtitle={tool?.description ?? ''} />

      <div className="rpa-toolbar">
        <Button size="small" onClick={() => fileRef.current?.click()}>
          导入
        </Button>
        <Button size="small" onClick={handleExportAll} disabled={scripts.length === 0}>
          导出全部
        </Button>
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

      {msg && <div className="rpa-msg">{msg}</div>}

      {scripts.length === 0 ? (
        <div className="rpa-empty">
          暂无录制脚本。点击扩展图标 → 「显示悬浮条」→ 点击悬浮条的开始按钮录制一段操作后，脚本会出现在这里。
        </div>
      ) : (
        <ul className="rpa-list">
          {scripts.map((s) => {
            const mode = viewModes[s.id] ?? 'form';
            const editingIndex = editingCommand[s.id];
            const hasEditing = typeof editingIndex === 'number';
            return (
              <li key={s.id} className="rpa-item">
                <div className="rpa-item-row">
                  <div className="rpa-item-main">
                    {renamingId === s.id ? (
                      <Input
                        size="small"
                        value={renamingName}
                        onChange={(e) => setRenamingName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <span className="rpa-name">{s.name}</span>
                    )}
                    <span className="rpa-meta">
                      {s.commands.length} 条事件 · {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="rpa-item-actions">
                    <Button size="small" onClick={() => toggleExpand(s.id)}>
                      {isExpanded(s.id) ? '收起' : '展开'}
                    </Button>
                    <Button size="small" onClick={() => startRename(s)}>
                      重命名
                    </Button>
                    <Button size="small" onClick={() => handleExport(s)}>
                      导出
                    </Button>
                    <Button size="small" variant="danger" onClick={() => handleDelete(s)}>
                      删除
                    </Button>
                  </div>
                </div>

                {isExpanded(s.id) && (
                  <div className="rpa-steps">
                    <div className="rpa-steps-toolbar">
                      <span className="rpa-steps-title">
                        事件列表
                        {pickTarget?.scriptId === s.id ? ' · 请在网页点击悬浮条「取点」按钮选择元素' : ''}
                      </span>
                      <div className="rpa-steps-toolbar-actions">
                        <span className="rpa-view-toggle">
                          <button
                            type="button"
                            className={`rpa-view-btn${mode === 'form' ? ' active' : ''}`}
                            onClick={() => switchView(s.id, 'form')}
                          >
                            表单
                          </button>
                          <button
                            type="button"
                            className={`rpa-view-btn${mode === 'json' ? ' active' : ''}`}
                            onClick={() => switchView(s.id, 'json')}
                          >
                            JSON
                          </button>
                        </span>
                        {mode === 'form' && (
                          <Button size="small" onClick={() => addCommand(s.id)} disabled={hasEditing}>
                            插入事件
                          </Button>
                        )}
                      </div>
                    </div>

                    {mode === 'json' ? (
                      <div className="rpa-json-editor-wrap">
                        <Textarea
                          size="small"
                          className="rpa-json-editor"
                          spellCheck={false}
                          value={jsonDrafts[s.id] ?? JSON.stringify(s.commands, null, 2)}
                          onChange={(e) => onJsonChange(s.id, e.target.value)}
                        />
                        {jsonErrors[s.id] && <div className="rpa-json-error">{jsonErrors[s.id]}</div>}
                      </div>
                    ) : s.commands.length === 0 ? (
                      <div className="rpa-steps-empty">暂无事件</div>
                    ) : (
                      s.commands.map((cmd, i) => renderCommandRow(s, cmd, i))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
