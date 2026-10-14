import { useCallback, useEffect, useMemo, useState } from 'react';
import JsonTree, { type JsonValue } from './JsonTree';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import {
  type JsonHistoryEntry,
  getHistory,
  addHistory,
  removeHistory,
  clearHistory,
} from '../../shared/json-history';
import './index.css';

type ParseState =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: JsonValue; pretty: string };

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

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<JsonHistoryEntry[]>([]);

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

  const handlePick = (content: string) => {
    setInput(content);
  };

  const handleDelete = (id: string) => {
    void removeHistory(id).then(setHistory);
  };

  const handleClear = () => {
    void clearHistory().then(setHistory);
  };

  return (
    <div className="json-app">
      <PageHeader title={tool?.name ?? 'JSON 格式化'} subtitle={tool?.description ?? ''} />

      <div className="json-body">
        {/* 历史记录侧边栏：onMouseDown preventDefault 避免点击历史区导致输入框失焦触发记录 */}
        <aside className="json-history" onMouseDown={(e) => e.preventDefault()}>
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
        </aside>

        <section className="json-pane">
          <div className="json-pane-title">
            <span>输入</span>
          </div>
          <textarea
            className="json-input"
            placeholder='在此粘贴JSON，例如 {"name":"Alice","age":30}'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={handleBlur}
            spellCheck={false}
          />
        </section>

        <section className="json-pane">
          <div className="json-pane-title">
            <span>格式化结果</span>
            <Button size="small" onClick={handleCopy} disabled={parsed.status !== 'ok'}>
              {copied ? '已复制' : '复制'}
            </Button>
          </div>

          <div className="json-output">
            {parsed.status === 'empty' && <div className="json-placeholder">先在左侧输入需要格式化的 JSON</div>}
            {parsed.status === 'error' && (
              <div className="json-error">
                <div className="json-error-title">JSON 解析失败</div>
                <div className="json-error-msg">{parsed.message}</div>
              </div>
            )}
            {parsed.status === 'ok' && <JsonTree data={parsed.data} />}
          </div>
        </section>
      </div>
    </div>
  );
}
