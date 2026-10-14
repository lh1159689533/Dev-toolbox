import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCommits } from '../../api/git';
import { fetchWorkspaces } from '../../api/tapd';
import { getToolById } from '../../data/tools';
import { STORAGE_KEYS, storageGet, storageSet } from '../../shared/storage';
import type { CommitQuery, CommitRecord, TapdRef, TapdWorkspace } from '../../types';
import CommentDialog from './CommentDialog';
import CommitList from './CommitList';
import NotifyToast from './NotifyToast';
import BranchSelect from './BranchSelect';
import WorkspaceSelect from './WorkspaceSelect';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import Input from '../../components/Input';
import ErrorTip from '../../components/ErrorTip';
import './index.css';

const PAGE_SIZE = 100;

/** 本地时区日期 YYYY-MM-DD（避免 toISOString 的 UTC 偏移问题） */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 默认查询条件（空值；默认项由设置页保存到 chrome.storage 后在启动时回填） */
function defaultQuery(): CommitQuery {
  return {
    projectPath: '',
    branch: '', // 空 = 仓库默认分支
    author: '',
    since: today(),
    until: today(),
    workspaceId: '',
  };
}

export default function TapdCommentTool() {
  const tool = getToolById('tapd-comment');
  const [query, setQuery] = useState<CommitQuery>(defaultQuery);
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [editing, setEditing] = useState<CommitRecord | null>(null);
  const [notifyTapd, setNotifyTapd] = useState<TapdRef | null>(null);
  const [workspaces, setWorkspaces] = useState<TapdWorkspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  // 布局模式：stacked = 上下布局；side = 左右布局（查询面板滚出视区后触发）
  const [layoutMode, setLayoutMode] = useState<'stacked' | 'side'>('stacked');
  // 查询面板折叠（仅 side 模式可用）
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // 分页游标；切换查询条件时重置，由 handleSearch/handleLoadMore 维护
  const pageRef = useRef(1);
  // 顶部占位面板（始终在文档流，供测量切换阈值）
  const filterRef = useRef<HTMLElement>(null);
  // 提交记录列表容器（供查询后顶格滚动定位）
  const listRef = useRef<HTMLDivElement>(null);
  // 查询后锁定布局切换：锁定期间上下滚动不触发上下/左右切换，
  // 直到再次向下滚过「上下→左右」阈值才解锁，恢复正常切换逻辑。
  const lockRef = useRef(false);

  const setField = useCallback(
    <K extends keyof CommitQuery>(key: K, value: CommitQuery[K]) => setQuery((q) => ({ ...q, [key]: value })),
    [],
  );

  const handleSearch = useCallback(async () => {
    if (!query.projectPath.trim()) {
      setError('请填写工蜂仓库路径');
      return;
    }
    // 左右布局下重新查询：在 setLoading 前先锁定布局，
    // 否则 setLoading 会让列表替换成"加载中"占位、文档高度塌陷、
    // 浏览器被动回顶触发滚动事件把布局切回 stacked（锁必须在回顶前生效）。
    if (layoutMode === 'side') {
      lockRef.current = true;
    }
    setLoading(true);
    setError('');
    try {
      const { records, hasMore } = await fetchCommits(query, 1, PAGE_SIZE);
      pageRef.current = 1;
      setHasSearched(true);
      setCommits(records);
      // hasMore 由接口原始返回条数判断，避免作者过滤后不足一页导致误判
      setHasMore(hasMore);
      // 左右布局下重新查询：数据渲染后滚动到列表开头（顶格，紧贴 sticky header 下方），
      // 避免回顶露出顶部占位面板的空白区域。
      if (layoutMode === 'side') {
        requestAnimationFrame(() => {
          const list = listRef.current;
          if (!list) return;
          const headerH = 90; // 与 CSS --header-h 一致
          window.scrollTo({ top: list.offsetTop - headerH, behavior: 'auto' });
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCommits([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [query, layoutMode]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const { records, hasMore } = await fetchCommits(query, nextPage, PAGE_SIZE);
      pageRef.current = nextPage;
      setCommits((prev) => {
        // 按 commitId 去重，防止重复追加
        const seen = new Set(prev.map((c) => c.commitId));
        const fresh = records.filter((c) => !seen.has(c.commitId));
        return [...prev, ...fresh];
      });
      setHasMore(hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [query, loadingMore, loading, hasMore]);

  const noTapdCount = useMemo(() => commits.filter((c) => !c.tapd).length, [commits]);

  // 监听滚动，判断顶部占位面板是否完全滚出视区，切换上下/左右布局。
  // 说明：两个面板始终渲染（一个顶部占位、一个 fixed 侧边固定），切换只是改显示/隐藏，
  // 因此文档高度不会在切换瞬间塌陷，scrollY 不会被浏览器被动回拉，从根本上避免布局闪回。
  useEffect(() => {
    // 顶部占位面板底部的文档坐标阈值（面板始终占位，阈值稳定，无需锁定）
    let threshold: number | null = null;
    // 当前所处布局模式（与 state 同步，避免闭包读取陈旧值）
    let currentMode: 'stacked' | 'side' = 'stacked';

    // 回滞距离：反向切换需明显回退，避免在阈值附近反复横跳
    const HYSTERESIS = 40;

    const measure = () => {
      const el = filterRef.current;
      if (!el) return null;
      return el.offsetTop + el.offsetHeight;
    };

    const onScroll = () => {
      if (threshold === null) {
        threshold = measure();
        if (threshold === null) return;
      }
      const scrollY = window.scrollY;

      // 查询后锁定布局：期间不因滚动切换布局，
      // 仅当再次向下滚过「上下→左右」阈值时解锁并恢复正常切换。
      if (lockRef.current) {
        if (scrollY >= threshold + 100) {
          lockRef.current = false;
          currentMode = 'side';
          setLayoutMode('side');
        }
        return;
      }

      if (currentMode === 'stacked') {
        // 面板完全滚出视区（多滚 100px）→ 切 side
        if (scrollY >= threshold + 100) {
          currentMode = 'side';
          setLayoutMode('side');
        }
      } else {
        // 明显回退（回退距离超过回滞区间）才切回 stacked
        if (scrollY <= threshold - HYSTERESIS) {
          currentMode = 'stacked';
          setLayoutMode('stacked');
          threshold = null; // 重置阈值，以便重新测量
        }
      }
    };

    const onResize = () => {
      threshold = null;
      onScroll();
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // 页面启动时加载用户参与的项目列表（供下拉选择）
  useEffect(() => {
    let cancelled = false;
    setLoadingWorkspaces(true);
    fetchWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setWorkspaces([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspaces(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 页面启动时：先从 chrome.storage 恢复上次输入，再用设置页默认查询条件（非空字段）覆盖
  useEffect(() => {
    void (async () => {
      try {
        const saved = await storageGet<CommitQuery>(STORAGE_KEYS.tapdQuery);
        if (saved) setQuery((q) => ({ ...q, ...saved }));
      } catch {
        /* ignore */
      }
      try {
        const dq = await storageGet<Partial<CommitQuery>>(STORAGE_KEYS.defaultQuery);
        if (dq) {
          // 仅用设置页中已配置（非空）的字段覆盖，未配置字段保留上次输入
          setQuery((q) => ({
            ...q,
            ...(dq.projectPath ? { projectPath: dq.projectPath } : {}),
            ...(dq.branch ? { branch: dq.branch } : {}),
            ...(dq.author ? { author: dq.author } : {}),
            ...(dq.workspaceId ? { workspaceId: dq.workspaceId } : {}),
          }));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 保存上次输入（跳过首次挂载，避免把初始空值写入覆盖历史）
  const skipSaveRef = useRef(true);
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    void storageSet(STORAGE_KEYS.tapdQuery, query).catch(() => {
      /* ignore */
    });
  }, [query]);

  // 查询面板表单内容（上下/左右两个面板复用同一份，内容完全一致）
  const renderPanelBody = () => (
    <div className="filter-body">
      <div className="filter-grid">
        <label>
          <span>工蜂仓库路径</span>
          <Input
            placeholder="如 WeDataOS/wedata3-monorepo（或完整 URL）"
            value={query.projectPath}
            onChange={(e) => setField('projectPath', e.target.value)}
          />
        </label>
        <label>
          <span>分支</span>
          <BranchSelect projectPath={query.projectPath} value={query.branch} onChange={(v) => setField('branch', v)} />
        </label>
        <label>
          <span>用户（作者）</span>
          <Input placeholder="英文名或邮箱" value={query.author} onChange={(e) => setField('author', e.target.value)} />
        </label>
        <label>
          <span>起始时间</span>
          <Input type="date" value={query.since} onChange={(e) => setField('since', e.target.value)} />
        </label>
        <label>
          <span>结束时间</span>
          <Input type="date" value={query.until} onChange={(e) => setField('until', e.target.value)} />
        </label>
        <label>
          <span>TAPD 项目</span>
          <WorkspaceSelect
            workspaces={workspaces}
            value={query.workspaceId}
            loading={loadingWorkspaces}
            onChange={(v) => setField('workspaceId', v)}
          />
        </label>
      </div>
      <div className="filter-actions">
        <Button variant="primary" onClick={handleSearch} disabled={loading}>
          {loading ? '查询中…' : '查询提交记录'}
        </Button>
      </div>
      {error && <ErrorTip>{error}</ErrorTip>}
    </div>
  );

  const commitListProps = {
    commits,
    loading,
    loadingMore,
    hasMore,
    hasSearched,
    workspaceId: query.workspaceId,
    projectPath: query.projectPath,
    noTapdCount,
    onEdit: setEditing,
    onLoadMore: handleLoadMore,
  };

  return (
    <div className={`app ${layoutMode}`}>
      <PageHeader title={tool?.name ?? 'TAPD 评论回填'} subtitle={tool?.description ?? ''} />

      <div className="main-body">
        {/* 顶部占位面板：始终在文档流占位。上下布局时即查询表单；左右布局时仍占位、已滚出视口 */}
        <section className="filter filter-stacked" ref={filterRef}>
          {renderPanelBody()}
        </section>

        <div className="main-body-container" ref={listRef}>
          <CommitList {...commitListProps} />
        </div>

        {/* 侧边面板：fixed 定位固定在视口左侧（不占文档流、不随滚动移动），左右布局显示、上下布局隐藏 */}
        <section
          className={`filter filter-side${layoutMode === 'stacked' ? ' hidden' : ''}${panelCollapsed ? ' collapsed' : ''}`}
        >
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setPanelCollapsed((v) => !v)}
            aria-expanded={!panelCollapsed}
          >
            <span>查询条件</span>
            <span className={`panel-arrow${panelCollapsed ? ' collapsed' : ''}`}>▾</span>
          </button>
          {renderPanelBody()}
        </section>
      </div>

      {editing && (
        <CommentDialog
          commit={editing}
          workspaceId={query.workspaceId}
          projectPath={query.projectPath}
          onClose={() => setEditing(null)}
          onCommented={(tapd) => {
            setEditing(null);
            setNotifyTapd(tapd);
          }}
        />
      )}

      {notifyTapd && (
        <NotifyToast tapd={notifyTapd} workspaceId={query.workspaceId} onClose={() => setNotifyTapd(null)} />
      )}
    </div>
  );
}
