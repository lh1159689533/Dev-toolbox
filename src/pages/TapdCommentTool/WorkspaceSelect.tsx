import { useEffect, useMemo, useRef, useState } from 'react';
import type { TapdWorkspace } from '../../types';

interface Props {
  workspaces: TapdWorkspace[];
  value: string; // 空字符串 = 未选择
  loading?: boolean;
  onChange: (workspaceId: string) => void;
}

/** 项目可搜索下拉：与分支 UI 一致，基于本地列表按名称/ID 关键字过滤 */
export default function WorkspaceSelect({ workspaces, value, loading = false, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = workspaces.find((w) => w.id === value);

  // 本地关键字过滤：匹配项目名称或 ID
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return workspaces;
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(kw) || w.id.toLowerCase().includes(kw),
    );
  }, [workspaces, keyword]);

  const labelOf = (v: string) => {
    if (v === '') return loading ? '项目加载中…' : workspaces.length > 0 ? '请选择项目' : '暂无可用项目';
    return selected ? `${selected.name} (${selected.id})` : v;
  };

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // 关键字/列表变化时重置高亮并滚回顶部
  useEffect(() => {
    setActiveIndex(-1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [keyword, workspaces]);

  const openDropdown = () => {
    setKeyword('');
    setOpen(true);
    inputRef.current?.focus();
  };

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') openDropdown();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) handleSelect(filtered[activeIndex].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`branch-select${open ? ' open' : ''}`} ref={rootRef}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        placeholder="请选择项目"
        value={open ? keyword : labelOf(value)}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        readOnly={!open}
      />

      {open && (
        <div className="branch-dropdown" ref={listRef}>
          {loading && (
            <div className="branch-empty">项目加载中…</div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="branch-empty">
              {workspaces.length === 0 ? '暂无可用项目' : '未匹配到项目'}
            </div>
          )}

          {filtered.map((w, i) => (
            <div
              key={w.id}
              className={[
                'branch-option',
                i === activeIndex ? 'active' : '',
                w.id === value ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              // mousedown + preventDefault：避免输入框先失焦导致列表关闭
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(w.id);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {w.name} ({w.id})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
