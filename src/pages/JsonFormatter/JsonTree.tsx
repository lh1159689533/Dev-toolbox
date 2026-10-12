import { useCallback, useState } from 'react';
import Button from '../../components/Button';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 折叠状态集合：存放已折叠节点的 path（如 "root.a.0"） */
type CollapsedSet = Set<string>;

interface JsonTreeNodeProps {
  keyName: string | null;
  value: JsonValue;
  path: string;
  depth: number;
  /** 是否为父容器的最后一项（末项后不加逗号） */
  isLast: boolean;
  collapsed: CollapsedSet;
  onToggle: (path: string) => void;
}

function isContainer(v: JsonValue): v is JsonValue[] | { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null;
}

function containerSummary(v: JsonValue[] | { [key: string]: JsonValue }): string {
  if (Array.isArray(v)) {
    return `Array[${v.length}]`;
  }
  const keys = Object.keys(v);
  return `Object{${keys.length}}`;
}

const KEY_COLOR = 'oklch(42% 0.09 200)';
const STRING_COLOR = 'oklch(45% 0.12 150)';
const NUMBER_COLOR = 'oklch(50% 0.13 55)';
const BOOLEAN_COLOR = 'oklch(42% 0.12 250)';
const NULL_COLOR = 'oklch(55% 0.02 160)';

function PrimitiveValue({ value }: { value: Exclude<JsonValue, object | null> | null }) {
  if (value === null) return <span style={{ color: NULL_COLOR }}>null</span>;
  if (typeof value === 'string') return <span style={{ color: STRING_COLOR }}>&quot;{value}&quot;</span>;
  if (typeof value === 'boolean') return <span style={{ color: BOOLEAN_COLOR }}>{String(value)}</span>;
  return <span style={{ color: NUMBER_COLOR }}>{String(value)}</span>;
}

function JsonNode({ keyName, value, path, depth, isLast, collapsed, onToggle }: JsonTreeNodeProps) {
  const isCollapsed = collapsed.has(path);

  // 该行左侧的缩进（2 空格 / 级），由父容器统一叠加，行内不再额外加 gutter
  const indent = '  '.repeat(depth);

  const keyEl =
    keyName !== null ? (
      <span style={{ color: KEY_COLOR }}>{'"' + keyName + '"'}</span>
    ) : null;

  if (!isContainer(value)) {
    return (
      <div className="json-line">
        <span className="json-indent">{indent}</span>
        {keyEl}
        <span className="json-colon">{keyName !== null ? ': ' : ''}</span>
        <PrimitiveValue value={value as never} />
        {!isLast ? <span className="json-bracket">,</span> : null}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  // 数组元素不展示下标 key（参考 DevTools），对象用自身 key
  const entries: { key: string; val: JsonValue }[] = isArray
    ? (value as JsonValue[]).map((val, i) => ({ key: String(i), val }))
    : Object.entries(value as { [key: string]: JsonValue }).map(([key, val]) => ({ key, val }));

  return (
    <>
      <div className="json-line">
        <span className="json-indent">{indent}</span>
        {keyEl}
        {keyName !== null ? <span className="json-colon">: </span> : null}
        <button
          type="button"
          className="json-toggle"
          onClick={() => onToggle(path)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? '展开' : '折叠'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
        <span className="json-bracket">{openBracket}</span>
        {isCollapsed ? (
          <>
            <span className="json-summary">{containerSummary(value)}</span>
            {/* 折叠时逗号跟在概要后面 */}
            {!isLast ? <span className="json-bracket">,</span> : null}
          </>
        ) : null}
      </div>
      {!isCollapsed && (
        <>
          {entries.map(({ key, val }, i) => (
            <JsonNode
              key={key}
              keyName={isArray ? null : key}
              value={val}
              path={`${path}.${key}`}
              depth={depth + 1}
              isLast={i === entries.length - 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          {/* 闭合括号与所属容器行首对齐（缩进 depth 级） */}
          <div className="json-line">
            <span className="json-indent">{indent}</span>
            <span className="json-bracket">{closeBracket + (!isLast ? ',' : '')}</span>
          </div>
        </>
      )}
    </>
  );
}

interface JsonTreeProps {
  data: JsonValue;
}

export default function JsonTree({ data }: JsonTreeProps) {
  const [collapsed, setCollapsed] = useState<CollapsedSet>(new Set());

  const onToggle = useCallback((path: string) => {
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
    const paths: string[] = [];
    const walk = (v: JsonValue, path: string) => {
      if (!isContainer(v)) return;
      paths.push(path);
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `${path}.${i}`));
      } else {
        Object.entries(v as { [key: string]: JsonValue }).forEach(([k, val]) => walk(val, `${path}.${k}`));
      }
    };
    walk(data, 'root');
    setCollapsed(new Set(paths));
  }, [data]);

  return (
    <div className="json-tree-wrap">
      <div className="json-toolbar">
        <Button size="small" onClick={expandAll}>
          全部展开
        </Button>
        <Button size="small" onClick={collapseAll}>
          全部折叠
        </Button>
      </div>
      <div className="json-tree">
        <JsonNode keyName={null} value={data} path="root" depth={0} isLast collapsed={collapsed} onToggle={onToggle} />
      </div>
    </div>
  );
}
