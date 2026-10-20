import type { InputHTMLAttributes } from 'react';
import '../../styles/tokens.css';
import './index.css';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 错误态：红边框 + 红文字 */
  invalid?: boolean;
  /** small：紧凑行内场景（RPA 步骤行 / DevTools 命令行） */
  size?: 'default' | 'small';
}

export default function Input({ invalid, size = 'default', className, ...rest }: InputProps) {
  const cls = ['dt-input', size === 'small' ? 'small' : '', invalid ? 'invalid' : '', className]
    .filter(Boolean)
    .join(' ');
  return <input className={cls} {...rest} />;
}
