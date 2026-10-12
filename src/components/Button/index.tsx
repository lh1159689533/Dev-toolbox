import type { ButtonHTMLAttributes } from 'react';
import './index.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary';
  size?: 'default' | 'small';
}

export default function Button({ variant = 'default', size = 'default', className, ...rest }: ButtonProps) {
  const cls = ['btn', variant === 'primary' ? 'primary' : '', size === 'small' ? 'small' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} {...rest} />;
}
