import { useEffect, useRef, useState } from 'react';
import { fetchBranches } from '../../api/git';

interface Props {
  projectPath: string;
  value: string; // 空字符串 = 仓库默认分支
  onChange: (branch: string) => void;
}

const DEBOUNCE_MS = 350;

/** 分支可搜索下拉：输入关键字远程搜索（接口 search 参数），首项为仓库默认分支 */
export default function BranchSelect({ projectPath, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 选项列表：首项为「默认分支」（value 为空串，不传 ref_name）
  const options: string[] = ['', ...branches];
  const labelOf = (v: string) =>
    v === '' ? '默认分支（仓库默认）' : v;

  // 仓库路径变化：清空搜索状态并回退到默认分支（跳过首次挂载）
  const prevPathRef = useRef(projectPath);
  useEffect(() => {
    if (prevPathRef.current === projectPath) return;
    prevPathRef.current = projectPath;
    setKeyword('');
    setBranches([]);
    setError('');
    setOpen(false);
    onChange('');
  }, [projectPath, onChange]);

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

  // 远程搜索：打开/清空关键字时立即拉取，输入时防抖
  useEffect(() => {
    if (!open || !projectPath.trim()) {
      if (!open) setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError('');
        fetchBranches(projectPath, keyword, controller.signal)
          .then((list) => setBranches(list))
          .catch((e) => {
            if (controller.signal.aborted) return;
            setError(e instanceof Error ? e.message : String(e));
            setBranches([]);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      keyword ? DEBOUNCE_MS : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // branches 不进依赖：仅在 open/projectPath/keyword 变化时触发请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath, keyword]);

  // 关键字/列表变化时重置高亮并滚回顶部
  useEffect(() => {
    setActiveIndex(-1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [keyword, branches]);

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
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) handleSelect(options[activeIndex]);
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
        placeholder="默认分支（仓库默认）"
        value={open ? keyword : labelOf(value)}
        onChange={(e) => setKeyword(e.target.value)}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        readOnly={!open}
      />

      {open && (
        <div className="branch-dropdown" ref={listRef}>
          {!projectPath.trim() && (
            <div className="branch-empty">请先填写工蜂仓库路径</div>
          )}

          {projectPath.trim() && loading && branches.length === 0 && (
            <div className="branch-empty">分支加载中…</div>
          )}

          {projectPath.trim() && !loading && error && (
            <div className="branch-empty branch-error">{error}</div>
          )}

          {projectPath.trim() && !loading && !error && branches.length === 0 && keyword && (
            <div className="branch-empty">未匹配到分支</div>
          )}

          {options.map((v, i) => (
            <div
              key={v || '__default__'}
              className={[
                'branch-option',
                i === activeIndex ? 'active' : '',
                v === value ? 'selected' : '',
                v === '' ? 'hint' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              // mousedown + preventDefault：避免输入框先失焦导致列表关闭
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(v);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {labelOf(v)}
            </div>
          ))}

          {loading && branches.length > 0 && (
            <div className="branch-empty">搜索中…</div>
          )}
        </div>
      )}
    </div>
  );
}
