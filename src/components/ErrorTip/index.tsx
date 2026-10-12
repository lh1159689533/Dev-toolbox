import type { ReactNode } from 'react';
import './index.css';

export default function ErrorTip({ children }: { children: ReactNode }) {
  return <div className="error">{children}</div>;
}
