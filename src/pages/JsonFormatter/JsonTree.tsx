import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Primitive = null | boolean | number | string;

/** 折叠状态集合：存放已折叠节点的 path（如 "root.a.0"） */
export type CollapsedSet = Set<string>;

/** 缩进宽度（空格数） */
export type IndentSize = 2 | 4;

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

const STRING_COLOR = 'oklch(45% 0.12 150)';
const NUMBER_COLOR = 'oklch(50% 0.13 55)';
const BOOLEAN_COLOR = 'oklch(42% 0.12 250)';
const NULL_COLOR = 'oklch(55% 0.02 160)';

function PrimitiveValue({ value }: { value: Primitive }) {
  if (value === null) return <span style={{ color: NULL_COLOR }}>null</span>;
  if (typeof value === 'string') return <span style={{ color: STRING_COLOR }}>&quot;{value}&quot;</span>;
  if (typeof value === 'boolean') return <span style={{ color: BOOLEAN_COLOR }}>{String(value)}</span>;
  return <span style={{ color: NUMBER_COLOR }}>{String(value)}</span>;
}

/* ===== 扁平化：把可见的逻辑行拍平，便于按逻辑行编号 ===== */

type FlatLine =
  | {
      kind: 'open';
      path: string;
      depth: number;
      key: string | null;
      isArray: boolean;
      isCollapsed: boolean;
      summary: string;
      isLast: boolean;
    }
  | { kind: 'primitive'; path: string; depth: number; key: string | null; value: Primitive; isLast: boolean }
  | { kind: 'close'; path: string; depth: number; isArray: boolean; isLast: boolean };

function flattenInto(
  data: JsonValue,
  key: string | null,
  path: string,
  depth: number,
  isLast: boolean,
  collapsed: CollapsedSet,
  out: FlatLine[],
): void {
  if (!isContainer(data)) {
    out.push({ kind: 'primitive', path, depth, key, value: data as Primitive, isLast });
    return;
  }

  const isArray = Array.isArray(data);
  const isCollapsed = collapsed.has(path);

  out.push({
    kind: 'open',
    path,
    depth,
    key,
    isArray,
    isCollapsed,
    summary: containerSummary(data),
    isLast,
  });

  if (!isCollapsed) {
    const entries = isArray
      ? (data as JsonValue[]).map((val, i) => ({ key: null as string | null, val, path: `${path}.${i}` }))
      : Object.entries(data as { [key: string]: JsonValue }).map(([k, val]) => ({ key: k, val, path: `${path}.${k}` }));

    entries.forEach((e, i) => {
      flattenInto(e.val, e.key, e.path, depth + 1, i === entries.length - 1, collapsed, out);
    });

    out.push({ kind: 'close', path, depth, isArray, isLast });
  }
}

function flatten(data: JsonValue, collapsed: CollapsedSet): FlatLine[] {
  const out: FlatLine[] = [];
  flattenInto(data, null, 'root', 0, true, collapsed, out);
  return out;
}

/* ===== 渲染 ===== */

interface JsonTreeConfig {
  indentSize: IndentSize;
  showLineNumbers: boolean;
  wrap: boolean;
}

function Gutter({ number, width }: { number: number | null; width: string }) {
  return (
    <span className="json-linenum" style={{ width }}>
      {number ?? '\u00A0'}
    </span>
  );
}

interface LineProps {
  line: FlatLine;
  number: number;
  config: JsonTreeConfig;
  /** 行号列宽度（字符数，含分隔），0 表示不显示行号 */
  gutterChars: number;
  isLong: (value: string, key: string | null, depth: number) => boolean;
  onToggle: (path: string) => void;
}

function JsonLine({ line, number, config, gutterChars, isLong, onToggle }: LineProps) {
  const { indentSize, showLineNumbers } = config;
  const indent = ' '.repeat(line.depth * indentSize);
  const gutter = showLineNumbers ? <Gutter number={number} width={`${gutterChars}ch`} /> : null;

  if (line.kind === 'primitive') {
    const keyEl = line.key !== null ? <span className="json-key">{'"' + line.key + '"'}</span> : null;
    const comma = !line.isLast ? <span className="json-bracket">,</span> : null;

    // 换行开启 + 长字符串：值下移到 key 下一行显示（图1 样式），逗号紧跟 value 末尾。
    // paddingLeft 计入行号列宽度，使折行续行与 key 左侧对齐
    if (typeof line.value === 'string' && config.wrap && isLong(line.value, line.key, line.depth)) {
      return (
        <>
          <div className="json-line">
            {gutter}
            <span className="json-indent">{indent}</span>
            {keyEl}
            <span className="json-colon">:</span>
          </div>
          <div
            className="json-text-line"
            style={{ paddingLeft: `${gutterChars + line.depth * indentSize}ch` }}
          >
            <PrimitiveValue value={line.value} />
            {comma}
          </div>
        </>
      );
    }

    return (
      <div className="json-text-line">
        {gutter}
        <span className="json-indent">{indent}</span>
        {keyEl}
        {line.key !== null ? <span className="json-colon">: </span> : null}
        <PrimitiveValue value={line.value} />
        {comma}
      </div>
    );
  }

  if (line.kind === 'close') {
    return (
      <div className="json-line">
        {gutter}
        <span className="json-indent">{indent}</span>
        <span className="json-bracket">{(line.isArray ? ']' : '}') + (line.isLast ? '' : ',')}</span>
      </div>
    );
  }

  // open
  const keyEl = line.key !== null ? <span className="json-key">{'"' + line.key + '"'}</span> : null;
  const openBracket = line.isArray ? '[' : '{';

  return (
    <div className="json-line">
      {gutter}
      <span className="json-indent">{indent}</span>
      {keyEl}
      {line.key !== null ? <span className="json-colon">: </span> : null}
      <button
        type="button"
        className="json-toggle"
        onClick={() => onToggle(line.path)}
        aria-expanded={!line.isCollapsed}
        aria-label={line.isCollapsed ? '展开' : '折叠'}
      >
        {line.isCollapsed ? '+' : '−'}
      </button>
      <span className="json-bracket">{openBracket}</span>
      {line.isCollapsed ? (
        <>
          <span className="json-summary">{line.summary}</span>
          {!line.isLast ? <span className="json-bracket">,</span> : null}
        </>
      ) : null}
    </div>
  );
}

interface JsonTreeProps {
  data: JsonValue;
  /** 折叠状态（由父组件持有，配合标题栏的全局展开/折叠按钮） */
  collapsed: CollapsedSet;
  showLineNumbers: boolean;
  wrap: boolean;
  indentSize: IndentSize;
  onToggle: (path: string) => void;
}

export default function JsonTree({ data, collapsed, showLineNumbers, wrap, indentSize, onToggle }: JsonTreeProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [charWidth, setCharWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // 测量等宽字体单字符宽度（用于判断长字符串是否换行）
  useLayoutEffect(() => {
    const span = document.createElement('span');
    span.style.position = 'absolute';
    span.style.visibility = 'hidden';
    span.style.whiteSpace = 'pre';
    span.style.fontFamily = "'SF Mono', Menlo, Consolas, monospace";
    span.style.fontSize = '13px';
    span.textContent = '0000000000';
    document.body.appendChild(span);
    const w = span.getBoundingClientRect().width / 10;
    document.body.removeChild(span);
    setCharWidth(w);
  }, []);

  // 测量 .json-tree 内容区宽度（排除左右 padding 16px）
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth - 32);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = useMemo(() => flatten(data, collapsed), [data, collapsed]);

  const maxDigits = String(lines.length).length;
  const gutterChars = showLineNumbers ? maxDigits + 1 : 0;
  const availableChars = charWidth > 0 ? Math.floor(containerWidth / charWidth) : 0;

  // 判断字符串值是否需要换到下一行：同行渲染不下即视为「多行」
  const isLong = useCallback(
    (value: string, key: string | null, depth: number) => {
      if (availableChars <= 0) return false;
      const indent = depth * indentSize;
      const keyPart = key !== null ? key.length + 4 : 0; // "key" + ": "
      const head = indent + keyPart + 1; // +1 逗号
      const total = gutterChars + head + value.length + 2;
      // +2 安全边际：避免临界情况下误判为「短」而走单行分支折行后顶格
      return total + 2 > availableChars;
    },
    [availableChars, indentSize, gutterChars],
  );

  const config: JsonTreeConfig = { indentSize, showLineNumbers, wrap };

  return (
    <div className="json-tree-wrap">
      <div className={`json-tree${wrap ? '' : ' json-tree-nowrap'}`} ref={treeRef}>
        {lines.map((line, i) => (
          <JsonLine
            key={`${line.kind}:${line.path}`}
            line={line}
            number={i + 1}
            config={config}
            gutterChars={gutterChars}
            isLong={isLong}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
