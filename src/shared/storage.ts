/**
 * 统一存储模块：所有持久化数据统一走 chrome.storage.local。
 * 集中管理 key（统一 dev-toolbox: 前缀）并提供类型安全的读写封装。
 */

/** 所有持久化 key 常量（统一 dev-toolbox: 前缀） */
export const STORAGE_KEYS = {
  /** RPA 录制脚本列表 */
  rpaMacros: 'dev-toolbox:rpa:macros',
  /** 悬浮条位置 */
  rpaBarPosition: 'dev-toolbox:rpa:bar-position',
  /** 悬浮条打开过的 origin 列表 */
  rpaBarOpenOrigins: 'dev-toolbox:rpa:bar-open-origins',
  /** RPA 录制：是否限制同源续录（true=仅同源续录，false=允许跨域续录） */
  rpaRecordSameOrigin: 'dev-toolbox:rpa:record-same-origin',
  /** 工蜂 Access Token */
  gitToken: 'dev-toolbox:git-token',
  /** TAPD 认证（OAuth Access Token） */
  tapdAuth: 'dev-toolbox:tapd-auth',
  /** TAPD 评论工具默认查询条件（设置页维护） */
  defaultQuery: 'dev-toolbox:default-query',
  /** TAPD 评论工具上次输入的查询条件 */
  tapdQuery: 'dev-toolbox:tapd-query',
  /** 设置抽屉宽度 */
  drawerWidth: 'dev-toolbox:drawer-width',
  /** JSON 格式化历史记录列表 */
  jsonFormatterHistory: 'dev-toolbox:json-formatter:history',
  /** JSON 格式化历史记录条数上限 */
  jsonFormatterHistoryLimit: 'dev-toolbox:json-formatter:history-limit',
  /** 网站收藏：网站列表 */
  sitesItems: 'dev-toolbox:sites:items',
  /** 网站收藏：分类列表 */
  sitesCategories: 'dev-toolbox:sites:categories',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 读取单个 key（不存在返回 undefined） */
export async function storageGet<T = unknown>(key: string): Promise<T | undefined> {
  const data = (await chrome.storage.local.get(key)) as Record<string, T>;
  return data[key];
}

/** 写入单个 key */
export async function storageSet<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/** 删除单个 key */
export async function storageRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/** 读取多个 key */
export async function storageGetMany<T = unknown>(keys: string[]): Promise<Record<string, T>> {
  return (await chrome.storage.local.get(keys)) as Record<string, T>;
}

/** 批量写入多个 key（单次调用，原子性更好） */
export async function storageSetMany(values: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(values);
}

/** 监听 chrome.storage.local 变更，返回取消订阅函数 */
export function storageOnChanged(
  cb: (changes: Record<string, chrome.storage.StorageChange>) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'local') cb(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
