import type { ButtonHTMLAttributes } from 'react';
import '../../styles/tokens.css';
import './index.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'default' | 'small';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({ variant = 'secondary', size = 'default', className, ...rest }: ButtonProps) {
  const cls = ['btn', variant !== 'secondary' ? variant : '', size === 'small' ? 'small' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} {...rest} />;
}
