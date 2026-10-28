import { Fragment, type ReactNode } from 'react';

/**
 * 自研轻量 Markdown 渲染器（只读、零依赖）。
 * 支持：标题、粗体、斜体、行内代码、代码块、无序/有序列表、链接、引用、分割线、段落。
 * 输出 React 元素而非 HTML 字符串，天然避免 XSS（链接仅放行 http/https）。
 */

/** 链接协议白名单：仅 http/https，拒绝 javascript: 等 */
function safeHref(raw: string): string | undefined {
  const u = raw.trim();
  return /^https?:\/\//i.test(u) ? u : undefined;
}

/**
 * 将 markdown 文本转为纯文本摘要（去掉各类标记符号），用于卡片上的单行/截断展示。
 * 与 renderMarkdown 支持的语法范围保持一致。
 */
export function markdownToPlain(md: string): string {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`([^`]+)`/g, '$1') // 行内代码
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接（保留文字）
    .replace(/^#{1,6}\s+/gm, '') // 标题
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // 粗体
    .replace(/(\*|_)([^*_]*?)\1/g, '$2') // 斜体
    .replace(/^>\s?/gm, '') // 引用
    .replace(/^\s*[-*+]\s+/gm, '') // 无序列表
    .replace(/^\s*\d+[.)]\s+/gm, '') // 有序列表
    .replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, '') // 分割线
    .replace(/\s+/g, ' ')
    .trim();
}

/** 行内元素匹配：code | bold | italic | link */
const INLINE_TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]\n]*\]\([^)\s]+\))/g;

/** 渲染一行内的行内元素 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = new RegExp(INLINE_TOKEN.source, 'g');
  let lastIndex = 0;
  let j = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const token = m[0];
    const k = `${keyPrefix}-${j++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={k}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={k}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const mm = token.match(/^\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (mm) {
        const href = safeHref(mm[2]);
        nodes.push(
          href ? (
            <a key={k} href={href} target="_blank" rel="noopener noreferrer">
              {mm[1]}
            </a>
          ) : (
            <span key={k}>{mm[1]}</span>
          ),
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** 判断某行是否是块级元素的起始（用于段落收集时截断） */
function isBlockStart(line: string): boolean {
  return /^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>|```|([-*_])\s*(\1\s*){2,})/.test(line);
}

/** 按级别创建标题元素 */
function heading(level: number, children: ReactNode, key: string): ReactNode {
  switch (level) {
    case 1:
      return <h1 key={key}>{children}</h1>;
    case 2:
      return <h2 key={key}>{children}</h2>;
    case 3:
      return <h3 key={key}>{children}</h3>;
    case 4:
      return <h4 key={key}>{children}</h4>;
    case 5:
      return <h5 key={key}>{children}</h5>;
    default:
      return <h6 key={key}>{children}</h6>;
  }
}

/** 渲染 markdown 文本为 React 元素列表（空文本返回空 Fragment） */
export function renderMarkdown(md: string): ReactNode {
  if (!md) return null;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyBase = `md-${k++}`;

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 代码块
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```（可能不存在，安全忽略）
      out.push(
        <pre key={keyBase}>
          <code data-lang={lang || undefined}>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push(<hr key={keyBase} />);
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(heading(h[1].length, renderInline(h[2].trim(), keyBase), keyBase));
      i++;
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        items.push(<li key={`${keyBase}-${items.length}`}>{renderInline(m[1], `${keyBase}-${items.length}`)}</li>);
        i++;
      }
      out.push(<ul key={keyBase}>{items}</ul>);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m) break;
        items.push(<li key={`${keyBase}-${items.length}`}>{renderInline(m[1], `${keyBase}-${items.length}`)}</li>);
        i++;
      }
      out.push(<ol key={keyBase}>{items}</ol>);
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*>\s?(.*)$/);
        if (!m) break;
        buf.push(m[1]);
        i++;
      }
      out.push(<blockquote key={keyBase}>{renderInline(buf.join(' '), keyBase)}</blockquote>);
      continue;
    }

    // 段落：收集连续普通行
    const buf: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(<p key={keyBase}>{renderInline(buf.join(' '), keyBase)}</p>);
  }

  return <Fragment>{out}</Fragment>;
}
