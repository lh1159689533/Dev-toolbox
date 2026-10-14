import React, { useEffect, useState } from 'react';
import './index.css';

interface LoadingProps {
  className?: string;
  style?: React.CSSProperties;
  content?: React.ReactNode;
}

// 省略号动画组件
export const LoadingDots = () => {
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 300);

    return () => clearInterval(interval);
  }, []);

  return <span>{'.'.repeat(dotCount)}</span>;
};

export const Loading = ({ className = '', style, content = '加载中' }: LoadingProps) => {
  return (
    <div className={`loading ${className}`} style={style}>
      <svg
        className="loading__gradient icon-loading"
        viewBox="0 0 12 12"
        version="1.1"
        width="1em"
        height="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <foreignObject x="0" y="0" width="12" height="12">
          <div
            className="loading__gradient-conic"
            style={{
              background: 'conic-gradient(from 90deg, rgba(0, 82, 217, 0) 0deg, oklch(50% 0.07 160) 360deg)',
            }}
          ></div>
        </foreignObject>
      </svg>
      {content}
    </div>
  );
};
