import { useMemo, useRef, useState } from 'react';
import type { ToolMeta } from '../../types';
import tools from '../../data/tools.json';
import { useScrollReveal } from '../../shared/useScrollReveal';
import './index.css';

type Variant = 'fade-up' | 'slide-in';

const REAL_TOOLS = (tools as ToolMeta[]).filter((t) => t.enabled);

/** 补充占位卡片，保证列表足够长可滚动体验 */
const FAKE_TOOLS: ToolMeta[] = Array.from({ length: 28 }, (_, i) => {
  const n = REAL_TOOLS.length + i + 1;
  return {
    id: `demo-${n}`,
    name: `示例工具 ${String(n).padStart(2, '0')}`,
    description: '用于演示列表滚动入场动画的占位工具卡片，滚动查看效果',
    category: ['开发协作', '数据处理', '自动化', '效率工具'][i % 4],
    keywords: ['demo', '动画', '占位'],
    icon: './public/icons/diff.svg',
    enabled: true,
  };
});

const ALL_TOOLS: ToolMeta[] = [...REAL_TOOLS, ...FAKE_TOOLS];

function resolveIconSrc(icon: string): string {
  return icon.replace(/^\.\/public/, '');
}

export default function ScrollRevealDemo() {
  const [variant, setVariant] = useState<Variant>('fade-up');
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => ALL_TOOLS, []);

  useScrollReveal(listRef, {
    enabled: true,
    items,
    staggerStep: 0,
    direction: 'down',
    itemClassName: variant === 'slide-in' ? 'demo-item-x' : 'demo-item-y',
    inClassName: variant === 'slide-in' ? 'demo-in-x' : 'demo-in-y',
  });

  return (
    <div className="demo-app">
      <div className="demo-bar">
        <div className="demo-bar-text">
          <h1>列表滚动动画 Demo</h1>
          <p>上下滚动体验入场动画，切换类型后重新滚动对比（卡片滚出视口再滚回会重新播放）</p>
        </div>
        <div className="demo-toggle" role="group" aria-label="切换动画类型">
          <button
            type="button"
            className={`demo-toggle-btn${variant === 'fade-up' ? ' active' : ''}`}
            onClick={() => setVariant('fade-up')}
            aria-pressed={variant === 'fade-up'}
          >
            上移淡入
          </button>
          <button
            type="button"
            className={`demo-toggle-btn${variant === 'slide-in' ? ' active' : ''}`}
            onClick={() => setVariant('slide-in')}
            aria-pressed={variant === 'slide-in'}
          >
            横向滑入
          </button>
        </div>
      </div>

      <div className="demo-list" ref={listRef}>
        {items.map((t) => (
          <div key={t.id} className="demo-card">
            <span className="demo-icon-box">
              <img className="demo-icon" src={resolveIconSrc(t.icon)} alt="" />
            </span>
            <span className="demo-main">
              <span className="demo-name-row">
                <span className="demo-name">{t.name}</span>
                <span className="demo-cat">{t.category}</span>
              </span>
              <span className="demo-desc">{t.description}</span>
            </span>
            {t.keywords.length > 0 && (
              <span className="demo-tags">
                {t.keywords.slice(0, 3).map((k) => (
                  <span key={k} className="demo-tag">
                    #{k}
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
