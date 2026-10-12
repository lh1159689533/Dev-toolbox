import { diffArrays } from 'diff';

export type InlineType = 'unchanged' | 'removed' | 'added';
export type RowType = 'unchanged' | 'removed' | 'added' | 'modified';

export interface InlinePart {
  text: string;
  type: InlineType;
}

export interface Line {
  /** 整行文本（不含换行符） */
  text: string;
  /** 行内片段（仅 modified 行用于字符级高亮） */
  parts: InlinePart[];
}

export interface DiffRow {
  type: RowType;
  left: Line | null;
  right: Line | null;
  /** 左侧原始行号（0-based），无则为 -1 */
  leftLine: number;
  /** 右侧原始行号（0-based），无则为 -1 */
  rightLine: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  /** 左侧行号 -> 右侧行号（用于滚动同步），无对应时回退到最近有效行 */
  leftToRight: number[];
  /** 右侧行号 -> 左侧行号 */
  rightToLeft: number[];
}

/** 按 textarea 的换行语义拆行：空文本 => 0 行，否则按 \n 分割（保留末尾空行） */
function splitIntoLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

function plainLine(text: string, type: InlineType): Line {
  return { text, parts: [{ text, type }] };
}

/**
 * 行内分词：英文/数字连续序列作为一个 token（按词，对齐 vscode 的词级 diff），
 * 其余（中文、标点、空白、emoji）逐字符，兼顾中英文精确高亮。
 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|./gu) ?? [];
}

/** 对一行修改做行内 diff，得到左右两侧的行内片段 */
function modifiedPair(leftText: string, rightText: string): { left: Line; right: Line } {
  const parts = diffArrays(tokenize(leftText), tokenize(rightText));
  const leftParts: InlinePart[] = [];
  const rightParts: InlinePart[] = [];
  for (const p of parts) {
    const value = p.value.join('');
    if (p.added) {
      rightParts.push({ text: value, type: 'added' });
    } else if (p.removed) {
      leftParts.push({ text: value, type: 'removed' });
    } else {
      leftParts.push({ text: value, type: 'unchanged' });
      rightParts.push({ text: value, type: 'unchanged' });
    }
  }
  return { left: { text: leftText, parts: leftParts }, right: { text: rightText, parts: rightParts } };
}

/** 用最近的另一侧有效行号填充 -1，保证滚动映射单调可用 */
function fillGaps(arr: number[]): void {
  const n = arr.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (arr[i] >= 0) last = arr[i];
    else if (last >= 0) arr[i] = last;
  }
  if (n > 0 && arr[0] === -1) {
    let j = 0;
    while (j < n && arr[j] === -1) j++;
    const v = j < n ? arr[j] : 0;
    for (let i = 0; i < j; i++) arr[i] = v;
  }
}

export function computeDiff(leftText: string, rightText: string): DiffResult {
  const leftLines = splitIntoLines(leftText);
  const rightLines = splitIntoLines(rightText);

  const changes = diffArrays(leftLines, rightLines);

  const rows: DiffRow[] = [];
  const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
  let leftIdx = 0;
  let rightIdx = 0;

  // 待配对的左侧 removed 行（与紧随其后的 added 行配对成 modified）
  let pending: { line: Line; leftIdx: number }[] = [];

  const flushPending = () => {
    for (const { line, leftIdx: li } of pending) {
      rows.push({ type: 'removed', left: line, right: null, leftLine: li, rightLine: -1 });
      stats.removed++;
    }
    pending = [];
  };

  for (const change of changes) {
    const lines = change.value;
    if (change.added) {
      const pairCount = Math.min(pending.length, lines.length);
      for (let i = 0; i < pairCount; i++) {
        const pair = modifiedPair(pending[i].line.text, lines[i]);
        rows.push({
          type: 'modified',
          left: pair.left,
          right: pair.right,
          leftLine: pending[i].leftIdx,
          rightLine: rightIdx + i,
        });
        stats.modified++;
      }
      for (let i = pairCount; i < lines.length; i++) {
        rows.push({
          type: 'added',
          left: null,
          right: plainLine(lines[i], 'added'),
          leftLine: -1,
          rightLine: rightIdx + i,
        });
        stats.added++;
      }
      pending = pending.slice(pairCount);
      rightIdx += lines.length;
    } else if (change.removed) {
      for (const line of lines) {
        pending.push({ line: plainLine(line, 'removed'), leftIdx });
        leftIdx++;
      }
    } else {
      flushPending();
      for (const line of lines) {
        rows.push({
          type: 'unchanged',
          left: plainLine(line, 'unchanged'),
          right: plainLine(line, 'unchanged'),
          leftLine: leftIdx,
          rightLine: rightIdx,
        });
        leftIdx++;
        rightIdx++;
      }
    }
  }
  flushPending();

  const leftToRight = new Array<number>(leftIdx).fill(-1);
  const rightToLeft = new Array<number>(rightIdx).fill(-1);

  for (const row of rows) {
    if (row.leftLine >= 0 && row.rightLine >= 0) {
      leftToRight[row.leftLine] = row.rightLine;
      rightToLeft[row.rightLine] = row.leftLine;
    }
  }

  fillGaps(leftToRight);
  fillGaps(rightToLeft);

  return { rows, stats, leftToRight, rightToLeft };
}
