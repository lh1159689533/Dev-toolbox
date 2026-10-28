import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import SearchInput from '../../components/SearchInput';
import { getToolById } from '../../data/tools';
import {
  EXPORT_VERSION,
  UNCATEGORIZED_LABEL,
  applyDiff,
  buildDiff,
  genSiteId,
  getCategories,
  getSites,
  isSameOrder,
  normalizeUrl,
  saveCategories,
  saveSites,
  type SiteItem,
} from '../../shared/sites';
import SiteFormModal from './SiteFormModal';
import SiteDetailModal from './SiteDetailModal';
import ImportDialog from './ImportDialog';
import type { DiffRow } from '../../shared/sites';
import { markdownToPlain } from '../../shared/markdown';
import { useScrollReveal } from '../../shared/useScrollReveal';
import './index.css';

const VIEW_MODE_KEY = 'dev-toolbox:sites-view-mode';
/** 吸顶 header 高度，需与 index.css 中 --sc-header-h 保持一致 */
const HEADER_HEIGHT = 56;

type ViewMode = 'grid' | 'list';

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** 新增表单提交的数据（不含 id / createdAt） */
export interface SiteFormData {
  name: string;
  logo: string;
  description: string;
  category: string;
  tags: string[];
  url: string;
}

/* ===== 图标 ===== */

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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <path d="M12 20V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m7 13 5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 4h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <path d="M12 4v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m7 11 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="sc-spinner" viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** logo 展示：有图显示图，无图显示名称首字 */
function SiteLogo({ site, size = 40 }: { site: SiteItem; size?: number }) {
  if (site.logo.trim()) {
    return (
      <span className="site-logo-box" style={{ width: size, height: size }}>
        <img className="site-logo" src={site.logo.trim()} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className="site-logo-box site-logo-fallback" style={{ width: size, height: size }}>
      {site.name.trim().charAt(0) || '·'}
    </span>
  );
}

/** 打开网站（新标签页） */
function openSite(site: SiteItem) {
  if (site.url) window.open(site.url, '_blank', 'noopener,noreferrer');
}

export default function SiteCollection() {
  const tool = getToolById('site-collection');

  const [sites, setSites] = useState<SiteItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [stuck, setStuck] = useState(false);
  const [catStuck, setCatStuck] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<SiteItem | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<HTMLElement | null>(null);
  const [importRows, setImportRows] = useState<DiffRow[] | null>(null);
  const [importIncoming, setImportIncoming] = useState<SiteItem[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLElement>(null);

  const reload = useCallback(async () => {
    const [s, c] = await Promise.all([getSites(), getCategories()]);
    setSites(s);
    setCategories(c);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  // 吸顶状态：header 一滚动即吸附（顶部阴影）；分类贴到 header 下方时吸附（底部阴影）
  useEffect(() => {
    let raf = 0;
    const update = () => {
      setStuck(window.scrollY > 0);
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

  const categoryTabs = useMemo(() => {
    const hasUncategorized = sites.some((s) => !s.category);
    return ['全部', ...categories, ...(hasUncategorized ? [UNCATEGORIZED_LABEL] : [])];
  }, [categories, sites]);

  const countByCategory = useMemo(() => {
    const map: Record<string, number> = { 全部: sites.length };
    for (const s of sites) {
      const key = s.category || UNCATEGORIZED_LABEL;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [sites]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return sites.filter((s) => {
      if (category !== '全部') {
        const target = category === UNCATEGORIZED_LABEL ? '' : category;
        if (s.category !== target) return false;
      }
      if (!kw) return true;
      const haystack = `${s.name} ${s.description} ${s.category} ${s.tags.join(' ')} ${s.url}`.toLowerCase();
      return haystack.includes(kw);
    });
  }, [sites, keyword, category]);

  // 卡片滚动入场动画：grid 淡入上移、list 横向滑入，仅向下滚动时触发
  useScrollReveal(cardsRef, {
    enabled: true,
    items: filtered,
    direction: 'down',
    itemClassName: viewMode === 'list' ? 'reveal-item-x' : 'reveal-item',
    inClassName: viewMode === 'list' ? 'reveal-in-x' : 'reveal-in',
  });

  /** 新增提交：校验 url 去重 + 自动新建分类 + 写库 */
  const handleCreate = async (data: SiteFormData): Promise<string | null> => {
    const urlKey = normalizeUrl(data.url);
    if (!urlKey) return '请填写有效的网站地址';
    if (sites.some((s) => normalizeUrl(s.url) === urlKey)) return '该网站地址已存在';

    const item: SiteItem = { ...data, id: genSiteId(), url: data.url.trim(), createdAt: Date.now() };

    const newCat = data.category.trim();
    let nextCats = categories;
    if (newCat && !categories.includes(newCat)) {
      nextCats = [...categories, newCat];
      await saveCategories(nextCats);
      setCategories(nextCats);
    }

    const next = [...sites, item];
    await saveSites(next);
    setSites(next);
    return null;
  };

  /** 打开详情：记录触发卡片作为 FLIP 动画起点 */
  const openDetail = (s: SiteItem, origin: HTMLElement | null) => {
    setDetail(s);
    setDetailOrigin(origin);
  };

  /** FLIP 动画起点：list 卡片是横向长条，整卡缩放会拉伸文字，改用卡片内 logo */
  const getDetailOrigin = (card: HTMLElement): HTMLElement | null => {
    if (viewMode === 'list') return card.querySelector('.site-logo-box');
    return card;
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailOrigin(null);
  };

  /** 导出为 JSON 文件下载 */
  const handleExport = () => {
    const payload = { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), sites };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sites-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** 读取并解析导入文件 */
  const handleImportFile = async (file: File) => {
    setImportError(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { sites?: unknown };
      if (!parsed || !Array.isArray(parsed.sites)) {
        setImportError('文件格式不正确：缺少 sites 数组');
        return;
      }
      const incoming = parsed.sites
        .filter((s): s is SiteItem => !!s && typeof s === 'object' && typeof (s as SiteItem).url === 'string')
        .map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : genSiteId(),
          name: typeof s.name === 'string' ? s.name : '',
          logo: typeof s.logo === 'string' ? s.logo : '',
          description: typeof s.description === 'string' ? s.description : '',
          category: typeof s.category === 'string' ? s.category : '',
          tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
          url: s.url,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }));
      const rows = buildDiff(sites, incoming);
      if (rows.length === 0) {
        if (isSameOrder(sites, incoming)) {
          setImportError('导入文件与本地一致，无差异');
          return;
        }
        // 纯顺序变化：静默按导入文件顺序重排本地列表
        const next = applyDiff(sites, incoming, []);
        await saveSites(next);
        setSites(next);
        return;
      }
      setImportIncoming(incoming);
      setImportRows(rows);
    } catch {
      setImportError('无法解析该文件，请确认是有效的 JSON');
    } finally {
      setImporting(false);
    }
  };

  /** 应用导入结果 */
  const handleApplyImport = async (rows: DiffRow[]) => {
    const nextSites = applyDiff(sites, importIncoming ?? [], rows);
    await saveSites(nextSites);
    setSites(nextSites);

    const catSet = new Set(categories);
    for (const s of nextSites) if (s.category) catSet.add(s.category);
    const nextCats = [...catSet];
    await saveCategories(nextCats);
    setCategories(nextCats);

    setImportRows(null);
    setImportIncoming(null);
  };

  return (
    <div className={`sc-app${stuck ? ' sc-stuck' : ''}`}>
      <PageHeader title={tool?.name ?? '网站收藏'} />

      <div className="sc-hero">
        <h2 className="sc-hero-title">好站，不止于收藏</h2>
        <p className="sc-hero-subtitle">好用的网站千千万，你所知的十之一二</p>
      </div>

      <div className="sc-search-row">
        <SearchInput
          placeholder="搜索名称、描述、分类、标签或网址…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索网站"
        />
      </div>

      <nav ref={catRef} className={`sc-categories${catStuck ? ' stuck' : ''}`}>
        {categoryTabs.map((c) => (
          <button
            key={c}
            type="button"
            className={`sc-cat${category === c ? ' active' : ''}`}
            onClick={() => setCategory(c)}
          >
            <span>{c}</span>
            <span className="sc-count">{countByCategory[c] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="sc-content">
        <div className="sc-content-bar">
          <div className="sc-view-toggle" role="group" aria-label="切换展示模式">
            <button
              type="button"
              className={`sc-view-btn${viewMode === 'grid' ? ' active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="网格模式"
            >
              <GridIcon active={viewMode === 'grid'} />
            </button>
            <button
              type="button"
              className={`sc-view-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="列表模式"
            >
              <ListIcon active={viewMode === 'list'} />
            </button>
          </div>
        </div>
        {importError && <div className="sc-import-error">{importError}</div>}

        {loaded && filtered.length === 0 ? (
          <div className="sc-empty">
            {sites.length === 0 ? '还没有收藏的网站，点击右下角「+」添加' : '没有匹配的网站'}
          </div>
        ) : (
          <div ref={cardsRef} className={`sc-cards ${viewMode}`}>
            {filtered.map((s) =>
              viewMode === 'list' ? (
                <div key={s.id} className="site-card" title="点击查看网站介绍" onClick={(e) => openDetail(s, getDetailOrigin(e.currentTarget as HTMLElement))}>
                  <SiteLogo site={s} />
                  <span className="site-card-main">
                    <span className="site-name-row">
                      <span className="site-name">{s.name}</span>
                      <span className="site-cat">{s.category || UNCATEGORIZED_LABEL}</span>
                    </span>
                    <span className="site-desc">{markdownToPlain(s.description) || s.url}</span>
                  </span>
                  <span className="site-meta">
                    {s.tags.length > 0 && (
                      <span className="site-tags">
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="site-tag">
                            #{t}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="site-card-actions">
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          const card = e.currentTarget.closest('.site-card') as HTMLElement | null;
                          openDetail(s, card ? getDetailOrigin(card) : null);
                        }}
                      >
                        查看详情
                      </Button>
                      <Button
                        size="small"
                        variant="primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSite(s);
                        }}
                      >
                        进入网站
                      </Button>
                    </span>
                  </span>
                </div>
              ) : (
                <div key={s.id} className="site-card site-card-grid" onClick={(e) => openDetail(s, getDetailOrigin(e.currentTarget as HTMLElement))}>
                  <span className="site-card-head">
                    <SiteLogo site={s} />
                    <span className="site-title-wrap">
                      <span className="site-name">{s.name}</span>
                      <span className="site-cat">{s.category || UNCATEGORIZED_LABEL}</span>
                    </span>
                  </span>
                  <span className="site-desc">{markdownToPlain(s.description) || s.url}</span>
                  {s.tags.length > 0 && (
                    <span className="site-tags">
                      {s.tags.slice(0, 4).map((t) => (
                        <span key={t} className="site-tag">
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="site-card-actions">
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        const card = e.currentTarget.closest('.site-card') as HTMLElement | null;
                        openDetail(s, card ? getDetailOrigin(card) : null);
                      }}
                    >
                      查看详情
                    </Button>
                    <Button
                      size="small"
                      variant="primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSite(s);
                      }}
                    >
                      进入网站
                    </Button>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="sc-fab-group">
        <button
          type="button"
          className="site-fab"
          onClick={() => setFormOpen(true)}
          title="新增网站"
          aria-label="新增网站"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="site-fab"
          onClick={() => fileRef.current?.click()}
          title="导入"
          aria-label="导入"
          disabled={importing}
        >
          {importing ? <SpinnerIcon /> : <ImportIcon />}
        </button>
        <button type="button" className="site-fab" onClick={handleExport} title="导出" aria-label="导出">
          <ExportIcon />
        </button>
        {importing && <div className="sc-importing-tip">导入中…</div>}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
          e.target.value = '';
        }}
      />

      {formOpen && <SiteFormModal categories={categories} onSubmit={handleCreate} onClose={() => setFormOpen(false)} />}

      {detail && <SiteDetailModal site={detail} origin={detailOrigin} onClose={closeDetail} />}

      {importRows && (
        <ImportDialog rows={importRows} onCancel={() => setImportRows(null)} onApply={handleApplyImport} />
      )}
    </div>
  );
}
