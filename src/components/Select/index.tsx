import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import '../../styles/tokens.css';
import './index.css';

export interface SelectOption {
  value: string;
  label: string;
  /** 弱化展示（如「默认分支」提示项） */
  hint?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  /** 选中变化回调（直接返回 value，不是事件对象） */
  onChange: (value: string) => void;
  /** 是否可输入搜索，默认 false */
  searchable?: boolean;
  /** searchable 时是否按关键字在本地过滤（远程搜索场景传 false），默认 true */
  localFilter?: boolean;
  /** value 无匹配项时的占位文案 */
  placeholder?: string;
  /** 面板空态文案（可用于加载中 / 出错提示） */
  emptyText?: ReactNode;
  /** 面板列表底部附加内容（如「搜索中…」） */
  footer?: ReactNode;
  disabled?: boolean;
  /** small：紧凑行内场景（RPA 步骤行 / DevTools 命令行） */
  size?: 'default' | 'small';
  className?: string;
  /** 面板展开回调（可用于远程加载选项） */
  onOpen?: () => void;
  /** 搜索关键字变化回调（searchable 时，可用于远程搜索） */
  onSearch?: (keyword: string) => void;
}

/** 统一下拉框：自定义选项面板（支持搜索/键盘导航/高亮标记），替代原生 select */
export default function Select({
  value,
  options,
  onChange,
  searchable = false,
  localFilter = true,
  placeholder,
  emptyText = '暂无数据',
  footer,
  disabled = false,
  size = 'default',
  className,
  onOpen,
  onSearch,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  // 面板动画阶段：in=淡入中/已展开，out=淡出中（结束后卸载面板）
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [renderPanel, setRenderPanel] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayText = selected ? selected.label : (placeholder ?? '');
  const showPlaceholder = !selected && placeholder !== undefined;

  const filtered = useMemo(() => {
    if (!searchable || !localFilter) return options;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return options;
    return options.filter((o) => o.label.toLowerCase().includes(kw) || o.value.toLowerCase().includes(kw));
  }, [options, keyword, searchable, localFilter]);

  // 关闭面板（带淡出动画，动画结束后卸载）
  const closeDropdown = useCallback(() => {
    setOpen(false);
    setPhase('out');
  }, []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeDropdown();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, closeDropdown]);

  // 关键字 / 选项变化：重置高亮并滚回顶部
  useEffect(() => {
    setActiveIndex(-1);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [keyword, options]);

  // 键盘高亮项滚动到可视区
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openDropdown = () => {
    if (disabled || open) return;
    setKeyword('');
    setActiveIndex(-1);
    setPhase('in');
    setRenderPanel(true);
    setOpen(true);
    onOpen?.();
    if (searchable) inputRef.current?.focus();
  };

  // button 触发器：点击切换开/关（注意不要用 onFocus 打开，否则 focus→click 会先开后关）
  const handleTriggerClick = () => {
    if (disabled) return;
    if (open) closeDropdown();
    else openDropdown();
  };

  const handleSelect = (v: string) => {
    onChange(v);
    closeDropdown();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
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
      const item = filtered[activeIndex];
      if (activeIndex >= 0 && item) handleSelect(item.value);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  };

  const triggerCls = ['dt-select', size === 'small' ? 'small' : '', open ? 'open' : '']
    .filter(Boolean)
    .join(' ');
  const rootCls = ['dt-select-root', className].filter(Boolean).join(' ');

  return (
    <div className={rootCls} ref={rootRef}>
      {searchable ? (
        <input
          ref={inputRef}
          type="text"
          className={triggerCls}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          // 展开且已有选中项时，以灰色 placeholder 形式显示当前选中项（参考成熟 UI 组件），
          // 输入关键字后自然被替换
          placeholder={open && selected ? selected.label : placeholder}
          value={open ? keyword : displayText}
          readOnly={!open}
          disabled={disabled}
          onFocus={openDropdown}
          // 选中项通过 mousedown+preventDefault 关闭面板时不会夺走焦点，
          // 已持有焦点的 input 再次点击不触发 focus，需要 onClick 兜底展开
          onClick={() => {
            if (!open) openDropdown();
          }}
          onChange={(e) => {
            setKeyword(e.target.value);
            onSearch?.(e.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button
          type="button"
          className={triggerCls}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={handleTriggerClick}
          onKeyDown={handleKeyDown}
        >
          <span className={`dt-select-label${showPlaceholder ? ' placeholder' : ''}`}>{displayText}</span>
        </button>
      )}

      {renderPanel && (
        <div
          className={`dt-select-dropdown ${phase}`}
          ref={listRef}
          role="listbox"
          onAnimationEnd={(e) => {
            // 淡出动画结束后才真正卸载面板
            if (e.target === e.currentTarget && phase === 'out') setRenderPanel(false);
          }}
        >
          {filtered.length === 0 ? (
            <div className="dt-select-option empty">{emptyText}</div>
          ) : (
            filtered.map((o, i) => (
              <div
                key={o.value || `__option_${i}`}
                role="option"
                aria-selected={o.value === value}
                className={['dt-select-option', i === activeIndex ? 'active' : '', o.value === value ? 'selected' : '', o.hint ? 'hint' : '']
                  .filter(Boolean)
                  .join(' ')}
                // mousedown + preventDefault：避免触发器先失焦导致面板关闭
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(o.value);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {o.label}
              </div>
            ))
          )}
          {footer && <div className="dt-select-option empty">{footer}</div>}
        </div>
      )}
    </div>
  );
}
