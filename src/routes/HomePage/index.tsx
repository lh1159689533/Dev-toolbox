import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ToolMeta } from '../../types';
import tools from '../../data/tools.json';
import SearchInput from '../../components/SearchInput';
import { useScrollReveal } from '../../shared/useScrollReveal';
import './index.css';

const allTools = tools as ToolMeta[];

/** 视图模式持久化 key（网格 / 列表） */
const VIEW_MODE_KEY = 'dev-toolbox:home-view-mode';

/** 吸顶窄条 header 高度，需与 index.css 中 .home-narrow-header 的 height 保持一致 */
const HEADER_HEIGHT = 56;

type ViewMode = 'grid' | 'list';

/** 将 icon 的相对路径（如 ./public/foo.png）转换为静态资源根访问路径（如 /foo.png） */
function resolveIconSrc(icon: string): string {
  return icon.replace(/^\.\/public/, '');
}

/** url 有值 = 外部工具；否则 path 有值 = 内部工具 */
function isExternal(tool: ToolMeta): boolean {
  return Boolean(tool.url);
}

/** 打开工具：外部工具新开 tab，内部工具走本地路由 */
function openTool(tool: ToolMeta, navigate: (path: string) => void) {
  if (tool.url) {
    window.open(tool.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (tool.path) navigate(tool.path);
}

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth={active ? 2 : 1.6} />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M4 6h16" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" />
      <path d="M4 18h16" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" />
    </svg>
  );
}

/** 外部跳转图标 */
function JumpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M9 4H4v16h16v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M19.25 4.75 12 12M14 4h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [stuck, setStuck] = useState(false);
  const [catStuck, setCatStuck] = useState(false);
  const cardsRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const catRef = useRef<HTMLElement>(null);

  // 吸顶状态：滚动超过大标题区高度后显示窄条 header；分类贴到窄条 header 下方时吸附
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const header = headerRef.current;
      setStuck(header ? window.scrollY > header.offsetHeight : window.scrollY > 0);
      const cat = catRef.current;
      setCatStuck(!!cat && cat.getBoundingClientRect().top <= HEADER_HEIGHT);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // 视图模式写入本地存储，下次进入保持上次选择
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [viewMode]);

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

  // 卡片滚动入场动画：grid 淡入上移、list 横向滑入，仅向下滚动时触发
  useScrollReveal(cardsRef, {
    enabled: true,
    items: filtered,
    direction: 'down',
    itemClassName: viewMode === 'list' ? 'reveal-item-x' : 'reveal-item',
    inClassName: viewMode === 'list' ? 'reveal-in-x' : 'reveal-in',
  });

  return (
    <div className="home">
      <header className={`home-narrow-header${stuck ? ' show' : ''}`}>
        <div className="home-narrow-inner">
          <h1>开发者工具集</h1>
        </div>
      </header>

      <header ref={headerRef} className="home-header">
        <div className="home-header-inner">
          <h1>开发者工具集</h1>
          <p className="home-subtitle">常用开发小工具，按名称、功能或分类搜索，找到刚好能帮上忙的那一个</p>
        </div>
      </header>

      <div className="home-search-row">
        <SearchInput
          placeholder="搜索工具、功能或标签…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索工具"
        />
      </div>

      <nav ref={catRef} className={`home-categories${catStuck ? ' stuck' : ''}`}>
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

      <div className="home-content">
        <div className="home-content-bar">
          <div className="home-view-toggle" role="group" aria-label="切换展示模式">
            <button
              type="button"
              className={`home-view-btn${viewMode === 'grid' ? ' active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="网格模式"
            >
              <GridIcon active={viewMode === 'grid'} />
            </button>
            <button
              type="button"
              className={`home-view-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="列表模式"
            >
              <ListIcon active={viewMode === 'list'} />
            </button>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="home-empty">没有匹配的工具</div>
        ) : (
          <div ref={cardsRef} className={`home-cards ${viewMode}`}>
            {filtered.map((t) => {
              const tags =
                t.keywords.length > 0 ? (
                  <span className="tool-tags">
                    {t.keywords.slice(0, 3).map((k) => (
                      <span key={k} className="tool-tag">
                        #{k}
                      </span>
                    ))}
                  </span>
                ) : null;
              const trail = <span className="tool-trail">{isExternal(t) ? <JumpIcon /> : null}</span>;

              if (viewMode === 'list') {
                return (
                  <button key={t.id} type="button" className="tool-card" onClick={() => openTool(t, navigate)}>
                    <span className="tool-icon-box">
                      <img className="tool-icon" src={resolveIconSrc(t.icon)} alt="" />
                    </span>
                    <span className="tool-main">
                      <span className="tool-name-row">
                        <span className="tool-name">{t.name}</span>
                        <span className="tool-category">{t.category}</span>
                      </span>
                      <span className="tool-desc">{t.description}</span>
                    </span>
                    {tags}
                    {trail}
                  </button>
                );
              }

              return (
                <button key={t.id} type="button" className="tool-card" onClick={() => openTool(t, navigate)}>
                  <span className="tool-head">
                    <span className="tool-icon-box">
                      <img className="tool-icon" src={resolveIconSrc(t.icon)} alt="" />
                    </span>
                    <span className="tool-title-wrap">
                      <span className="tool-name">{t.name}</span>
                      <span className="tool-category">{t.category}</span>
                    </span>
                  </span>
                  <span className="tool-desc">{t.description}</span>
                  {tags}
                  {trail}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
