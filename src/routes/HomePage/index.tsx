import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ToolMeta } from '../../types';
import tools from '../../data/tools.json';
import { saveToolsMeta } from '../../data/tools';
import './index.css';

const allTools = tools as ToolMeta[];

/** 将 icon 的相对路径（如 ./public/foo.png）转换为静态资源根访问路径（如 /foo.png） */
function resolveIconSrc(icon: string): string {
  return icon.replace(/^\.\/public/, '');
}

/** 点击工具卡片：external 新开 tab，internal 走本地路由 */
function openTool(tool: ToolMeta, navigate: (path: string) => void) {
  if (tool.type === 'external') {
    if (tool.url) window.open(tool.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (tool.path) navigate(tool.path);
}

export default function HomePage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');

  // 将工具元信息写入 localStorage，供各工具页面统一读取标题/描述
  saveToolsMeta(allTools);

  // 仅展示 enabled 的工具
  const enabledTools = useMemo(() => allTools.filter((t) => t.enabled), []);

  // 分类列表：去重，保持数据出现顺序
  const categories = useMemo(() => {
    const set: string[] = [];
    for (const t of enabledTools) {
      if (!set.includes(t.category)) set.push(t.category);
    }
    return set;
  }, [enabledTools]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return enabledTools.filter((t) => {
      if (category !== '全部' && t.category !== category) return false;
      if (!kw) return true;
      const haystack = `${t.name} ${t.description} ${t.keywords.join(' ')}`.toLowerCase();
      return haystack.includes(kw);
    });
  }, [enabledTools, keyword, category]);

  const countByCategory = useMemo(() => {
    const map: Record<string, number> = { 全部: enabledTools.length };
    for (const t of enabledTools) {
      map[t.category] = (map[t.category] ?? 0) + 1;
    }
    return map;
  }, [enabledTools]);

  return (
    <div className="home">
      <header className="home-header">
        <h1>开发者工具集</h1>
        <p className="home-subtitle">常用开发小工具</p>
      </header>

      <div className="home-body">
        <aside className="home-sidebar">
          <div className="home-search">
            <input type="text" placeholder="搜索工具…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
          <nav className="home-categories">
            <button
              type="button"
              className={`home-cat${category === '全部' ? ' active' : ''}`}
              onClick={() => setCategory('全部')}
            >
              <span>全部</span>
              <span className="home-count">{countByCategory['全部'] ?? 0}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`home-cat${category === c ? ' active' : ''}`}
                onClick={() => setCategory(c)}
              >
                <span>{c}</span>
                <span className="home-count">{countByCategory[c] ?? 0}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="home-main">
          {filtered.length === 0 ? (
            <div className="home-empty">没有匹配的工具</div>
          ) : (
            <div className="home-grid">
              {filtered.map((t) => (
                <button key={t.id} type="button" className="tool-card" onClick={() => openTool(t, navigate)}>
                  {t.type === 'external' && (
                    <span className="tool-external">
                      <svg fill="none" viewBox="0 0 24 24" width="1em" height="1em" className="t-icon t-icon-jump">
                        <g id="jump">
                          <path
                            id="stroke1"
                            stroke="currentColor"
                            d="M9 4L4 4L4 20L20 20L20 15"
                            stroke-linecap="square"
                            stroke-width="2"
                          ></path>
                          <path
                            id="stroke2"
                            stroke="currentColor"
                            d="M19.25 4.75L12 12M14 4H20L20 10"
                            stroke-linecap="square"
                            stroke-width="2"
                          ></path>
                        </g>
                      </svg>
                    </span>
                  )}
                  <div className="tool-header">
                    <img className="tool-icon" src={resolveIconSrc(t.icon)} alt="" />
                    <span className="tool-name">{t.name}</span>
                  </div>
                  <span className="tool-desc">{t.description}</span>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
