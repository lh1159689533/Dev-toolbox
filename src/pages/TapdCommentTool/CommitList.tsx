import { useEffect, useRef, useState } from 'react';
import { resolveDetailUrl } from '../../api/tapd';
import { normalizeProjectPath } from '../../api/git';
import type { CommitRecord, TapdType } from '../../types';
import { Loading } from '../../components/Loading';
import Button from '../../components/Button';
import ErrorTip from '../../components/ErrorTip';

interface Props {
  commits: CommitRecord[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  hasSearched: boolean;
  workspaceId: string;
  projectPath: string;
  noTapdCount: number;
  onEdit: (commit: CommitRecord) => void;
  onLoadMore: () => void;
}

/** 工蜂 commit 详情页 URL（git.woa.com） */
function buildCommitUrl(projectPath: string, commitId: string): string {
  const path = normalizeProjectPath(projectPath);
  return `https://git.woa.com/${path}/commit/${commitId}`;
}

export default function CommitList({
  commits,
  loading,
  loadingMore,
  hasMore,
  hasSearched,
  workspaceId,
  projectPath,
  noTapdCount,
  onEdit,
  onLoadMore,
}: Props) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [jumpError, setJumpError] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 滚动到底部时通过 IntersectionObserver 触发加载更多
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: '120px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, loadingMore, hasMore, onLoadMore]);

  const handleJump = async (tapdId: string, type: TapdType) => {
    if (!workspaceId) {
      setJumpError('请先在上方选择 TAPD 项目');
      return;
    }
    setResolvingId(tapdId);
    setJumpError('');
    try {
      const url = await resolveDetailUrl(workspaceId, tapdId, type);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setJumpError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolvingId(null);
    }
  };

  // 空态文案：初始未查询 vs 查询后无结果
  const emptyText = hasSearched ? '未查询到符合条件的提交记录' : '暂无数据，请在上方填写条件后点击「查询提交记录」';

  return (
    <section className="commit-list">
      <div className="list-sticky">
        <div className="summary">
          共 {commits.length} 条提交，其中 {noTapdCount} 条未解析出TAPD ID
        </div>
        <div className="list-header">
          <span className="col-id">Commit ID</span>
          <span className="col-msg">Commit Message</span>
          <span className="col-author">作者</span>
          <span className="col-time">时间</span>
          <span className="col-action">操作</span>
        </div>
      </div>

      {/* 内容区 */}
      <div className="list-body">
        {commits.map((c) => (
          <div className="commit-row" key={c.commitId}>
            <a
              className="col-id mono commit-link"
              href={buildCommitUrl(projectPath, c.commitId)}
              target="_blank"
              rel="noopener noreferrer"
              title="点击打开 commit 详情"
            >
              {c.id}
            </a>
            <span className="col-msg">
              <div className="msg-title">{c.title}</div>
              {c.tapd ? (
                <button
                  className={`bug-tag${c.tapd.type === 'story' ? ' story' : ''}`}
                  onClick={() => handleJump(c.tapd!.id, c.tapd!.type)}
                  disabled={resolvingId === c.tapd.id}
                  title="点击跳转 TAPD"
                >
                  {c.tapd.type === 'story' ? 'STORY' : 'BUG'} #{c.tapd.id}
                </button>
              ) : (
                <span className="bug-tag none">未解析到 TAPD ID</span>
              )}
            </span>
            <span className="col-author">{c.authorName}</span>
            <span className="col-time">{c.createdAt ? new Date(c.createdAt).toLocaleString() : '-'}</span>
            <span className="col-action">
              <Button
                size="small"
                onClick={() => onEdit(c)}
                disabled={!c.tapd}
                title={!c.tapd ? '未解析到 TAPD ID' : ''}
              >
                添加TAPD评论
              </Button>
            </span>
          </div>
        ))}

        {commits.length === 0 && <div className="list-empty">{emptyText}</div>}

        {jumpError && <ErrorTip>{jumpError}</ErrorTip>}

        {/* 触底哨兵：滚入视口时触发加载更多 */}
        <div ref={sentinelRef} />

        {(loadingMore || hasMore) && (
          <div className="list-loading">{loadingMore ? <Loading /> : hasMore ? '滚动加载更多' : ''}</div>
        )}

        {!loadingMore && !hasMore && commits.length > 0 && <div className="list-loading">已加载全部</div>}
      </div>
      {/* 查询加载浮层：覆盖内容区，不清空已有数据 */}
      {loading && (
        <div className="list-loading-mask">
          <Loading content="数据加载中，请稍后" />
        </div>
      )}
    </section>
  );
}
