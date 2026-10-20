import type { TextareaHTMLAttributes } from 'react';
import '../../styles/tokens.css';
import './index.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** small：紧凑行内场景 */
  size?: 'default' | 'small';
}

export default function Textarea({ size = 'default', className, ...rest }: TextareaProps) {
  const cls = ['dt-textarea', size === 'small' ? 'small' : '', className].filter(Boolean).join(' ');
  return <textarea className={cls} {...rest} />;
}
