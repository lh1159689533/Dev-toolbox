import { useCallback, useEffect, useMemo, useState } from 'react';
import JsonTree, { type IndentSize, type JsonValue } from './JsonTree';
import { jsonToTs } from './jsonToTs';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import { type JsonHistoryEntry, getHistory, addHistory, removeHistory, clearHistory } from '../../shared/json-history';
import './index.css';

type ParseState =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: JsonValue; pretty: string };

function HistoryIcon() {
  return (
    <svg fill="none" viewBox="0 0 20 20">
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5"></rect>
      <rect x="2.5" y="3.5" width="5" height="13" rx="1.5" fill="currentColor" opacity="0.2"></rect>
      <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" stroke="currentColor" stroke-width="1.5"></line>
    </svg>
  );
}

/** 解析左侧输入，返回状态对象；空串为 empty，非法为 error，合法为 ok */
function parseJson(raw: string): ParseState {
  if (!raw.trim()) return { status: 'empty' };
  try {
    const data = JSON.parse(raw) as JsonValue;
    const pretty = JSON.stringify(data, null, 2);
    return { status: 'ok', data, pretty };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** 将内容压缩为单行摘要，超长截断 */
function summarize(content: string, max = 60): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 格式化为「YYYY-MM-DD HH:mm」 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 收集所有容器节点 path（用于全部折叠） */
function collectAllPaths(data: JsonValue): string[] {
  const paths: string[] = [];
  const walk = (v: JsonValue, path: string) => {
    if (typeof v !== 'object' || v === null) return;
    paths.push(path);
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}.${i}`));
    } else {
      Object.entries(v).forEach(([k, val]) => walk(val, `${path}.${k}`));
    }
  };
  walk(data, 'root');
  return paths;
}

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [tsCopied, setTsCopied] = useState(false);
  const [history, setHistory] = useState<JsonHistoryEntry[]>([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  // 格式化结果展示配置（工具栏位于「格式化结果」标题行）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [indentSize, setIndentSize] = useState<IndentSize>(2);

  const tool = getToolById('json-formatter');

  const parsed = useMemo(() => parseJson(input), [input]);

  // 启动时加载历史列表
  useEffect(() => {
    void getHistory().then(setHistory);
  }, []);

  // 输入框失焦时记录：仅当内容非空且解析成功
  const handleBlur = useCallback(() => {
    if (parsed.status !== 'ok') return;
    void addHistory(input).then(setHistory);
  }, [parsed.status, input]);

  const handleCopy = async () => {
    if (parsed.status !== 'ok') return;
    try {
      await navigator.clipboard.writeText(parsed.pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略复制失败（如非 https 环境） */
    }
  };

  const handleCopyTs = async () => {
    if (parsed.status !== 'ok') return;
    try {
      await navigator.clipboard.writeText(jsonToTs(parsed.data));
      setTsCopied(true);
      setTimeout(() => setTsCopied(false), 1500);
    } catch {
      /* 忽略复制失败（如非 https 环境） */
    }
  };

  const handlePick = (content: string) => {
    setInput(content);
  };

  const handleDelete = (id: string) => {
    void removeHistory(id).then(setHistory);
  };

  const handleClear = () => {
    void clearHistory().then(setHistory);
  };

  // 折叠/展开单个节点
  const handleToggleNode = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // 全局展开：清空折叠集合
  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  // 全局折叠：折叠所有容器节点
  const collapseAll = useCallback(() => {
    if (parsed.status !== 'ok') return;
    setCollapsed(new Set(collectAllPaths(parsed.data)));
  }, [parsed]);

  return (
    <div className="json-app">
      <PageHeader title={tool?.name ?? 'JSON 格式化'} subtitle={tool?.description ?? ''} />

      <div className="json-body">
        {/* 历史记录侧边栏：onMouseDown preventDefault 避免点击历史区导致输入框失焦触发记录 */}
        <aside
          className={`json-history${historyCollapsed ? ' json-history-collapsed' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!historyCollapsed && (
            <>
              <div className="json-history-header">
                <span>历史记录</span>
                <Button size="small" onClick={handleClear} disabled={history.length === 0}>
                  清空
                </Button>
              </div>
              <div className="json-history-list">
                {history.length === 0 ? (
                  <div className="json-history-empty">暂无历史记录</div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="json-history-item">
                      <button
                        type="button"
                        className="json-history-pick"
                        onClick={() => handlePick(item.content)}
                        title={item.content}
                      >
                        <span className="json-history-summary">{summarize(item.content)}</span>
                        <span className="json-history-time">{formatTime(item.timestamp)}</span>
                      </button>
                      <button
                        type="button"
                        className="json-history-delete"
                        onClick={() => handleDelete(item.id)}
                        aria-label="删除该条记录"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
          {/* 展开/收起按钮：固定在侧边栏底部，水平居中；收起后仅保留该按钮 */}
          <div className="json-history-footer">
            <button
              type="button"
              className="json-history-toggle"
              onClick={() => setHistoryCollapsed((prev) => !prev)}
              aria-label={historyCollapsed ? '展开历史记录' : '折叠历史记录'}
              title={historyCollapsed ? '展开历史记录' : '折叠历史记录'}
            >
              <HistoryIcon />
            </button>
          </div>
        </aside>

        <section className="json-pane json-input">
          <div className="json-pane-title">
            <span>输入</span>
          </div>
          <textarea
            className="json-input-text"
            placeholder='在此粘贴JSON，例如 {"name":"Alice","age":30}'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={handleBlur}
            spellCheck={false}
          />
        </section>

        <section className="json-pane json-output">
          <div className="json-pane-title">
            <span>格式化结果</span>
            <div className="json-pane-actions">
              <Button size="small" onClick={handleCopy} disabled={parsed.status !== 'ok'}>
                {copied ? '已复制' : '复制'}
              </Button>
              <Button size="small" onClick={handleCopyTs} disabled={parsed.status !== 'ok'}>
                {tsCopied ? '已复制' : '复制为TS类型'}
              </Button>
              <Button size="small" onClick={expandAll} disabled={parsed.status !== 'ok'}>
                全部展开
              </Button>
              <Button size="small" onClick={collapseAll} disabled={parsed.status !== 'ok'}>
                全部折叠
              </Button>
              <label className="json-config">
                <input
                  type="checkbox"
                  checked={showLineNumbers}
                  onChange={(e) => setShowLineNumbers(e.target.checked)}
                />
                行号
              </label>
              <label className="json-config">
                <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
                换行
              </label>
              <label className="json-config">
                缩进
                <select value={indentSize} onChange={(e) => setIndentSize(Number(e.target.value) as IndentSize)}>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </label>
            </div>
          </div>

          <div className="json-output">
            {parsed.status === 'empty' && <div className="json-placeholder">先在左侧输入需要格式化的 JSON</div>}
            {parsed.status === 'error' && (
              <div className="json-error">
                <div className="json-error-title">JSON 解析失败</div>
                <div className="json-error-msg">{parsed.message}</div>
              </div>
            )}
            {parsed.status === 'ok' && (
              <JsonTree
                data={parsed.data}
                collapsed={collapsed}
                showLineNumbers={showLineNumbers}
                wrap={wrap}
                indentSize={indentSize}
                onToggle={handleToggleNode}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
