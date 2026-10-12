import { useMemo, useState } from 'react';
import JsonTree, { type JsonValue } from './JsonTree';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
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

export default function JsonFormatter() {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const tool = getToolById('json-formatter');

  const parsed = useMemo(() => parseJson(input), [input]);

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

  return (
    <div className="json-app">
      <PageHeader title={tool?.name ?? 'JSON 格式化'} subtitle={tool?.description ?? ''} />

      <div className="json-body">
        <section className="json-pane">
          <div className="json-pane-title">
            <span>输入</span>
          </div>
          <textarea
            className="json-input"
            placeholder='在此粘贴JSON，例如 {"name":"Alice","age":30}'
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
