import type { InputHTMLAttributes } from 'react';
import Input from '../Input';
import './index.css';

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'clearable' | 'size'>;

/** 带搜索图标的输入框，内含 clearable，供各页面工具条复用 */
export default function SearchInput(props: SearchInputProps) {
  return (
    <div className="search-input">
      <span className="search-input-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-4-4"></path>
        </svg>
      </span>
      <Input type="text" clearable {...props} />
    </div>
  );
}
