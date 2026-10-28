import { useRef } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import '../../styles/tokens.css';
import './index.css';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 错误态：红边框 + 红文字 */
  invalid?: boolean;
  /** small：紧凑行内场景（RPA 步骤行 / DevTools 命令行） */
  size?: 'default' | 'small';
  /** 可清空：输入框有内容时右侧显示 × 按钮，点击清空并重新聚焦 */
  clearable?: boolean;
}

export default function Input({
  invalid,
  size = 'default',
  clearable,
  className,
  value,
  onChange,
  ...rest
}: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const cls = ['dt-input', size === 'small' ? 'small' : '', invalid ? 'invalid' : '', className]
    .filter(Boolean)
    .join(' ');

  const input = <input ref={inputRef} className={cls} value={value} onChange={onChange} {...rest} />;

  if (!clearable) return input;

  const hasValue = value != null && String(value).length > 0;

  const handleClear = () => {
    onChange?.({ target: { value: '' } } as ChangeEvent<HTMLInputElement>);
    inputRef.current?.focus();
  };

  return (
    <span className="dt-input-wrap">
      {input}
      {hasValue && (
        <button type="button" className="dt-input-clear" onClick={handleClear} aria-label="清空输入">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
