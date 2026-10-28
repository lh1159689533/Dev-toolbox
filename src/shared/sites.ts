import { STORAGE_KEYS, storageGet, storageSet } from './storage';

/** 单个收藏网站 */
export interface SiteItem {
  /** 唯一 id（本地生成，仅用于 React key 与删除定位） */
  id: string;
  name: string;
  /** logo 图片外链 URL，可空 */
  logo: string;
  /** 描述（markdown 文本） */
  description: string;
  /** 分类名；空字符串 = 未分类 */
  category: string;
  tags: string[];
  /** 网站地址（原始录入值，用于展示与打开） */
  url: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

/** 未分类的展示名 */
export const UNCATEGORIZED_LABEL = '未分类';

/** 导出文件格式版本 */
export const EXPORT_VERSION = 1;

/** 导出文件结构 */
export interface SitesExport {
  version: number;
  exportedAt: string;
  sites: SiteItem[];
}

/** 生成唯一 id（优先 crypto.randomUUID，降级为时间戳 + 随机数） */
export function genSiteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 规范化 url，用于唯一性判断：
 * - 补齐协议（默认 https）
 * - 主机名转小写
 * - 去掉 hash
 * - 去掉默认端口（80/443）
 * - 去掉非根路径末尾斜杠
 * 无法解析时返回去除首尾空白后的原串。
 */
export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
    u.pathname = path;
    return u.toString();
  } catch {
    return s;
  }
}

/** 读取全部收藏网站（缺失返回空数组） */
export async function getSites(): Promise<SiteItem[]> {
  const v = await storageGet<SiteItem[]>(STORAGE_KEYS.sitesItems);
  return Array.isArray(v) ? v : [];
}

/** 写入全部收藏网站 */
export async function saveSites(sites: SiteItem[]): Promise<void> {
  await storageSet(STORAGE_KEYS.sitesItems, sites);
}

/** 读取分类列表（缺失返回空数组） */
export async function getCategories(): Promise<string[]> {
  const v = await storageGet<string[]>(STORAGE_KEYS.sitesCategories);
  return Array.isArray(v) ? v.filter((c) => typeof c === 'string' && c.length > 0) : [];
}

/** 写入分类列表 */
export async function saveCategories(categories: string[]): Promise<void> {
  await storageSet(STORAGE_KEYS.sitesCategories, categories);
}

/* ============================ 导入 diff ============================ */

/** 差异类型：update=URL 相同内容不同；add=本地没有；remove=导入文件没有 */
export type DiffKind = 'update' | 'add' | 'remove';

/** 每条差异可选的用户决策 */
export type DiffAction = 'overwrite' | 'skip' | 'add' | 'remove' | 'keep';

export interface DiffRow {
  kind: DiffKind;
  /** 规范化后的 url（唯一键） */
  url: string;
  /** 导入文件中的记录（update/add） */
  incoming?: SiteItem;
  /** 本地已有的记录（update/remove） */
  existing?: SiteItem;
  /** 当前选中的决策 */
  action: DiffAction;
}

/** 比较两个标签数组是否一致（忽略顺序） */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

/** 比较两条记录内容是否一致（忽略 id/createdAt） */
function sameSite(a: SiteItem, b: SiteItem): boolean {
  return (
    a.name === b.name &&
    a.logo === b.logo &&
    a.description === b.description &&
    a.category === b.category &&
    sameTags(a.tags, b.tags) &&
    normalizeUrl(a.url) === normalizeUrl(b.url)
  );
}

/** 计算本地与导入文件之间的差异列表（内容完全一致的 URL 不列出） */
export function buildDiff(local: SiteItem[], incoming: SiteItem[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const localByUrl = new Map<string, SiteItem>();
  for (const s of local) {
    const k = normalizeUrl(s.url);
    if (k) localByUrl.set(k, s);
  }

  for (const s of incoming) {
    const k = normalizeUrl(s.url);
    if (!k) continue;
    const ex = localByUrl.get(k);
    if (ex) {
      localByUrl.delete(k);
      if (!sameSite(ex, s)) {
        rows.push({ kind: 'update', url: k, incoming: s, existing: ex, action: 'overwrite' });
      }
    } else {
      rows.push({ kind: 'add', url: k, incoming: s, action: 'add' });
    }
  }

  // 剩余的本地记录 = 导入文件没有 → remove
  for (const [k, s] of localByUrl) {
    rows.push({ kind: 'remove', url: k, existing: s, action: 'remove' });
  }

  return rows;
}

/**
 * 判断本地与导入文件的「网站条目相对顺序」是否一致。
 * 只比较两者共有的 URL（增删项不参与），出现相对顺序反转即视为顺序变化。
 */
export function isSameOrder(local: SiteItem[], incoming: SiteItem[]): boolean {
  const incomingIndex = new Map<string, number>();
  incoming.forEach((s, i) => {
    const k = normalizeUrl(s.url);
    if (k && !incomingIndex.has(k)) incomingIndex.set(k, i);
  });

  let lastIdx = -1;
  for (const s of local) {
    const k = normalizeUrl(s.url);
    if (!k) continue;
    const idx = incomingIndex.get(k);
    if (idx === undefined) continue; // 本地有、导入没有（将被删除），不参与顺序判断
    if (idx < lastIdx) return false;
    lastIdx = idx;
  }
  return true;
}

/**
 * 根据逐条决策，合并出导入后的最终网站列表。
 * 顺序以导入文件（incoming）为准：按 incoming 顺序重排（内容未变化的项也跟随）；
 * 「保留/跳过」且不在 incoming 中的本地项追加到末尾（保持原有相对顺序）。
 */
export function applyDiff(local: SiteItem[], incoming: SiteItem[], rows: DiffRow[]): SiteItem[] {
  const localByUrl = new Map<string, SiteItem>();
  for (const s of local) {
    const k = normalizeUrl(s.url);
    if (k) localByUrl.set(k, s);
  }

  const decision = new Map<string, DiffAction>();
  for (const r of rows) {
    decision.set(r.url, r.action);
  }

  const result: SiteItem[] = [];
  const consumed = new Set<string>();

  // 按导入文件顺序遍历
  for (const s of incoming) {
    const k = normalizeUrl(s.url);
    if (!k || consumed.has(k)) continue;
    consumed.add(k);
    const ex = localByUrl.get(k);
    const action = decision.get(k);

    if (action === 'skip') {
      // 跳过：不采用导入文件这一项；若本地有该项则保留本地内容
      if (ex) result.push(ex);
      continue;
    }

    if (action === 'overwrite' && ex) {
      // update + 覆盖：用导入内容，保留本地 id / createdAt
      result.push({ ...s, id: ex.id, createdAt: ex.createdAt });
    } else if (action === 'add' || !ex) {
      // add + 新增，或本地无此项：全新加入
      result.push({ ...s, id: genSiteId(), createdAt: Date.now() });
    } else {
      // 无决策 = 内容未变化：保留本地项
      result.push(ex);
    }
  }

  // 本地有、导入文件没有的项：remove+remove 删除；remove+keep 追加到末尾
  for (const s of local) {
    const k = normalizeUrl(s.url);
    if (!k || consumed.has(k)) continue;
    if (decision.get(k) === 'remove') continue;
    result.push(s);
  }

  return result;
}
