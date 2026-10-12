import type { CommitQuery, CommitRecord, GitBranch, GitlabCommit, TapdRef } from '../types';

/** 从 commit message 中解析 TAPD 关联：优先 --story=，否则回退 --bug= */
export function parseTapdRef(message: string): TapdRef | undefined {
  const story = message.match(/--story=\s*(\d+)/);
  if (story) return { id: story[1], type: 'story' };
  const bug = message.match(/--bug=\s*(\d+)/);
  if (bug) return { id: bug[1], type: 'bug' };
  return undefined;
}

/**
 * 归一化仓库路径：兼容「group/repo」和「https://git.woa.com/group/repo(.git)」两种输入，
 * 统一返回「group/repo」形式。
 */
export function normalizeProjectPath(input: string): string {
  let p = input.trim();
  // 去掉完整 URL 前缀
  p = p.replace(/^https?:\/\/[^/]+\//, '');
  // 去掉末尾 .git
  p = p.replace(/\.git$/, '');
  // 去掉首尾 /
  p = p.replace(/^\/+|\/+$/g, '');
  return p;
}

/** 编码仓库路径为 URL 路径段（工蜂用 %2F 表示嵌套 group） */
function encodeProjectPath(projectPath: string): string {
  return normalizeProjectPath(projectPath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('%2F');
}

/**
 * 日期（YYYY-MM-DD）→ 工蜂 v3 since/until 格式：yyyy-MM-dd'T'HH:mm:ssZ（本地时区）。
 * URLSearchParams 会自动将 `+` 编码为 %2B，满足接口「时间参数必须转码」的要求。
 */
function formatDateTime(date: string, endOfDay: boolean): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  if (endOfDay) d.setHours(23, 59, 59, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const tz = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`
  );
}

/** 单页 commit 拉取结果：records 为过滤后的列表，hasMore 依据接口原始返回条数判断 */
export interface CommitPage {
  records: CommitRecord[];
  hasMore: boolean;
}

/**
 * 拉取工蜂 commit 列表（通过 vite proxy /git-api 转发到 git.woa.com/api/v3）。
 * hasMore 以接口原始返回条数判断（而非前端作者过滤后的条数），
 * 否则作者过滤后不足一页会被误判为「已全部加载」，导致漏翻后续页。
 */
export async function fetchCommits(query: CommitQuery, page = 1, perPage = 100): Promise<CommitPage> {
  const { projectPath, branch, author, since, until } = query;

  const params = new URLSearchParams();
  // ref_name 为空时不传，由工蜂接口使用仓库默认分支
  if (branch.trim()) params.set('ref_name', branch.trim());
  if (since) params.set('since', formatDateTime(since, false));
  if (until) params.set('until', formatDateTime(until, true));
  // 排除 merge 提交点（接口参数；前端 parent_ids 过滤保留作兜底）
  params.set('no_merges', 'true');
  params.set('page', String(page));
  params.set('per_page', String(perPage));

  const url = `/git-api/projects/${encodeProjectPath(projectPath)}/repository/commits?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`工蜂接口请求失败 (${res.status}): ${text}`);
  }

  const commits: GitlabCommit[] = await res.json();

  // 作者过滤（接口不支持 author 参数；支持多个，逗号/空格分隔）
  const authors = author
    .split(/[,，\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);

  const records = commits
    .filter((c) => {
      // 按作者过滤
      if (authors.length > 0) {
        return authors.some((a) => c.author_name === a || c.author_email?.startsWith(a + '@'));
      }
      return true;
    })
    .map((c) => ({
      id: c.short_id,
      commitId: c.id,
      title: c.title,
      message: c.message,
      authorName: c.author_name,
      createdAt: c.created_at,
      tapd: parseTapdRef(c.message),
    }));

  return { records, hasMore: commits.length >= perPage };
}

/**
 * 拉取工蜂分支列表（GET /repository/branches）。
 * @param search 模糊匹配分支名（接口 search 参数），空串返回全部
 */
export async function fetchBranches(projectPath: string, search: string, signal?: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  params.set('page', '1');
  params.set('per_page', '100');
  params.set('order_by', 'updated_at');
  params.set('sort', 'desc');

  const url = `/git-api/projects/${encodeProjectPath(projectPath)}/repository/branches?${params.toString()}`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`分支接口请求失败 (${res.status}): ${text}`);
  }

  const list: GitBranch[] = await res.json();
  return list.map((b) => b?.name).filter((n): n is string => Boolean(n));
}
