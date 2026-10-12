import { useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import { getToolById } from '../../data/tools';
import { parseJsonDupKey, removeFieldFromText, type FieldSpan } from './parser';
import './index.css';

/** 将 value 原文紧凑化为单行展示（对象/数组会被 JSON.stringify 压成单行） */
function formatValue(text: string, field: FieldSpan): string {
  const raw = text.slice(field.valueStart, field.valueEnd).trim();
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

export default function JsonDupKey() {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const tool = getToolById('json-dup-key');

  const parsed = useMemo(() => parseJsonDupKey(input), [input]);

  /** 删除某一次出现的字段 */
  const handleDelete = (field: FieldSpan) => {
    setInput(removeFieldFromText(input, field));
  };

  /** 一键去重：保留该 key 首次出现，删除其余 */
  const handleDeleteOthers = (fields: FieldSpan[]) => {
    const toDelete = fields.slice(1).sort((a, b) => b.fullStart - a.fullStart);
    let text = input;
    for (const f of toDelete) {
      text = removeFieldFromText(text, f);
    }
    setInput(text);
  };

  const handleCopy = async () => {
    if (parsed.status !== 'ok') return;
    try {
      await navigator.clipboard.writeText(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略复制失败（如非 https 环境） */
    }
  };

  const groupCount = parsed.status === 'ok' ? parsed.groups.length : 0;

  return (
    <div className="dup-app">
      <PageHeader title={tool?.name ?? 'JSON 重复 Key 检测'} subtitle={tool?.description ?? ''} />

      <div className="dup-body">
        <section className="dup-pane">
          <div className="dup-pane-title">
            <span>输入 JSON</span>
          </div>
          <textarea
            className="dup-input"
            placeholder='在此粘贴JSON，例如 {"a":1,"a":2,"b":3}'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
        </section>

        <section className="dup-pane">
          <div className="dup-pane-title">
            <span>{parsed.status === 'ok' && groupCount > 0 ? `重复项（${groupCount}）` : '重复项'}</span>
            <Button size="small" onClick={handleCopy} disabled={parsed.status !== 'ok' || !input.trim()}>
              {copied ? '已复制' : '复制结果'}
            </Button>
          </div>

          <div className="dup-output">
            {parsed.status === 'empty' && <div className="dup-placeholder">先在左侧输入 JSON</div>}

            {parsed.status === 'not-object' && (
              <div className="dup-tip">仅支持最外层为对象（{'{...}'}）的 JSON</div>
            )}

            {parsed.status === 'error' && (
              <div className="dup-error">
                <div className="dup-error-title">JSON 解析失败</div>
                <div className="dup-error-msg">{parsed.message}</div>
              </div>
            )}

            {parsed.status === 'ok' && groupCount === 0 && (
              <div className="dup-placeholder">未发现重复的 key</div>
            )}

            {parsed.status === 'ok' && groupCount > 0 && (
              <div className="dup-groups">
                {parsed.groups.map((g) => (
                  <div className="dup-group" key={g.key}>
                    <div className="dup-group-head">
                      <span className="dup-group-key">{g.rawKey}</span>
                      <span className="dup-group-count">出现 {g.fields.length} 次</span>
                      <Button size="small" onClick={() => handleDeleteOthers(g.fields)}>
                        保留首条
                      </Button>
                    </div>
                    <ul className="dup-group-list">
                      {g.fields.map((f) => {
                        const isFirst = f.index === g.fields[0].index;
                        return (
                          <li className="dup-item" key={f.index}>
                            <span className={`dup-item-badge${isFirst ? '' : ' dup-badge-dup'}`}>
                              {isFirst ? '原始' : '重复'}
                            </span>
                            <code className="dup-item-value" title={input.slice(f.valueStart, f.valueEnd).trim()}>
                              {formatValue(input, f)}
                            </code>
                            <Button size="small" onClick={() => handleDelete(f)}>
                              删除
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
