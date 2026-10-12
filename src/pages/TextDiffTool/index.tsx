import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { computeDiff } from './diff';
import type { Line, RowType } from './diff';
import { getToolById } from '../../data/tools';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import './index.css';

/** 与 index.css 中 .diff-line 的 height / line-height 保持一致 */
const LINE_HEIGHT = 20;

type Side = 'left' | 'right';

function rowClassName(type: RowType, side: Side, active: boolean): string {
  let cls = 'diff-line';
  if (type === 'removed') cls += ' diff-line-removed';
  else if (type === 'added') cls += ' diff-line-added';
  else if (type === 'modified') cls += side === 'left' ? ' diff-line-modified-left' : ' diff-line-modified-right';
  if (active) cls += ' diff-line-active';
  return cls;
}

function renderLineContent(line: Line, type: RowType): ReactNode {
  if (type !== 'modified') return line.text;
  return line.parts.map((p, i) => (
    <span
      key={i}
      className={p.type === 'removed' ? 'diff-ins-removed' : p.type === 'added' ? 'diff-ins-added' : undefined}
    >
      {p.text}
    </span>
  ));
}

export default function TextDiffTool() {
  const tool = getToolById('text-diff');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [activeChange, setActiveChange] = useState(-1);

  const leftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rightTextareaRef = useRef<HTMLTextAreaElement>(null);
  const leftBackdropRef = useRef<HTMLDivElement>(null);
  const rightBackdropRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const diff = useMemo(() => computeDiff(left, right), [left, right]);
  const { rows, stats, leftToRight, rightToLeft } = diff;

  // 变更块（用于导航与高亮当前块）
  const { blocks, blockOfRow } = useMemo(() => {
    const blocks: { leftLine: number; rightLine: number }[] = [];
    const blockOfRow: number[] = new Array(rows.length).fill(-1);
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type === 'unchanged') {
        i++;
        continue;
      }
      const idx = blocks.length;
      blocks.push({ leftLine: rows[i].leftLine, rightLine: rows[i].rightLine });
      while (i < rows.length && rows[i].type !== 'unchanged') {
        blockOfRow[i] = idx;
        i++;
      }
    }
    return { blocks, blockOfRow };
  }, [rows]);

  // diff 变化后，重新对齐两侧 backdrop 的滚动位置
  useEffect(() => {
    if (leftBackdropRef.current && leftTextareaRef.current) {
      leftBackdropRef.current.scrollTop = leftTextareaRef.current.scrollTop;
      leftBackdropRef.current.scrollLeft = leftTextareaRef.current.scrollLeft;
    }
    if (rightBackdropRef.current && rightTextareaRef.current) {
      rightBackdropRef.current.scrollTop = rightTextareaRef.current.scrollTop;
      rightBackdropRef.current.scrollLeft = rightTextareaRef.current.scrollLeft;
    }
  }, [diff]);

  const scrollToLine = (ta: HTMLTextAreaElement | null, line: number) => {
    if (!ta) return;
    ta.scrollTop = Math.max(0, line * LINE_HEIGHT - ta.clientHeight / 2);
  };

  const scrollToBlock = (idx: number) => {
    const block = blocks[idx];
    if (!block) return;
    setActiveChange(idx);
    const leftTarget = block.leftLine >= 0 ? block.leftLine : block.rightLine >= 0 ? (rightToLeft[block.rightLine] ?? 0) : 0;
    const rightTarget = block.rightLine >= 0 ? block.rightLine : block.leftLine >= 0 ? (leftToRight[block.leftLine] ?? 0) : 0;
    scrollToLine(leftTextareaRef.current, leftTarget);
    scrollToLine(rightTextareaRef.current, rightTarget);
    if (leftBackdropRef.current && leftTextareaRef.current) leftBackdropRef.current.scrollTop = leftTextareaRef.current.scrollTop;
    if (rightBackdropRef.current && rightTextareaRef.current) rightBackdropRef.current.scrollTop = rightTextareaRef.current.scrollTop;
  };

  const nextChange = () => {
    if (blocks.length === 0) return;
    scrollToBlock(activeChange + 1 >= blocks.length ? 0 : activeChange + 1);
  };

  const prevChange = () => {
    if (blocks.length === 0) return;
    scrollToBlock(activeChange - 1 < 0 ? blocks.length - 1 : activeChange - 1);
  };

  const handleScroll = (side: Side) => {
    if (syncing.current) return;
    const src = side === 'left' ? leftTextareaRef.current : rightTextareaRef.current;
    if (!src) return;
    syncing.current = true;
    try {
      const srcBackdrop = side === 'left' ? leftBackdropRef.current : rightBackdropRef.current;
      if (srcBackdrop) {
        srcBackdrop.scrollTop = src.scrollTop;
        srcBackdrop.scrollLeft = src.scrollLeft;
      }

      const dst = side === 'left' ? rightTextareaRef.current : leftTextareaRef.current;
      const dstBackdrop = side === 'left' ? rightBackdropRef.current : leftBackdropRef.current;
      if (dst) {
        const srcLine = Math.round(src.scrollTop / LINE_HEIGHT);
        const map = side === 'left' ? leftToRight : rightToLeft;
        if (map.length > 0) {
          const clamped = Math.max(0, Math.min(srcLine, map.length - 1));
          const targetTop = map[clamped] * LINE_HEIGHT;
          if (Math.abs(dst.scrollTop - targetTop) > 1) dst.scrollTop = targetTop;
        }
        if (Math.abs(dst.scrollLeft - src.scrollLeft) > 1) dst.scrollLeft = src.scrollLeft;
        if (dstBackdrop) {
          dstBackdrop.scrollTop = dst.scrollTop;
          dstBackdrop.scrollLeft = dst.scrollLeft;
        }
      }
    } finally {
      window.setTimeout(() => {
        syncing.current = false;
      }, 50);
    }
  };

  return (
    <div className="diff-app">
      <PageHeader title={tool?.name ?? '文本对比'} subtitle={tool?.description ?? ''} />

      <div className="diff-toolbar">
        <div className="diff-stats">
          <span className="diff-stat diff-stat-added">新增 {stats.added}</span>
          <span className="diff-stat diff-stat-removed">删除 {stats.removed}</span>
          <span className="diff-stat diff-stat-modified">修改 {stats.modified}</span>
        </div>
        <div className="diff-nav">
          <Button size="small" onClick={prevChange} disabled={blocks.length === 0}>
            上一处
          </Button>
          <Button size="small" onClick={nextChange} disabled={blocks.length === 0}>
            下一处
          </Button>
        </div>
      </div>

      <div className="diff-body">
        <section className="diff-pane">
          <div className="diff-pane-title">原始文本</div>
          <div className="diff-editor">
            <div className="diff-backdrop" ref={leftBackdropRef} aria-hidden>
              {rows.map((row, i) => {
                if (!row.left) return null;
                return (
                  <div key={i} className={rowClassName(row.type, 'left', blockOfRow[i] === activeChange)}>
                    {renderLineContent(row.left, row.type)}
                  </div>
                );
              })}
            </div>
            <textarea
              ref={leftTextareaRef}
              className="diff-input"
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              onScroll={() => handleScroll('left')}
              placeholder="在此粘贴或输入原始文本…"
              spellCheck={false}
            />
          </div>
        </section>

        <section className="diff-pane">
          <div className="diff-pane-title">对比文本</div>
          <div className="diff-editor">
            <div className="diff-backdrop" ref={rightBackdropRef} aria-hidden>
              {rows.map((row, i) => {
                if (!row.right) return null;
                return (
                  <div key={i} className={rowClassName(row.type, 'right', blockOfRow[i] === activeChange)}>
                    {renderLineContent(row.right, row.type)}
                  </div>
                );
              })}
            </div>
            <textarea
              ref={rightTextareaRef}
              className="diff-input"
              value={right}
              onChange={(e) => setRight(e.target.value)}
              onScroll={() => handleScroll('right')}
              placeholder="在此粘贴或输入对比文本…"
              spellCheck={false}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
