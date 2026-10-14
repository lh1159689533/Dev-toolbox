import { STORAGE_KEYS, storageGet, storageSet } from './storage';

/** 单条历史记录 */
export interface JsonHistoryEntry {
  id: string;
  /** 原始输入文本 */
  content: string;
  /** 记录时间（毫秒时间戳） */
  timestamp: number;
}

/** 历史条数上限：默认 / 最小 / 最大 */
export const DEFAULT_HISTORY_LIMIT = 20;
export const MIN_HISTORY_LIMIT = 1;
export const MAX_HISTORY_LIMIT = 100;

/** 将任意值收敛到 [MIN, MAX] 区间的整数；非法值回落到默认值 */
export function clampHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(Math.round(value), MIN_HISTORY_LIMIT), MAX_HISTORY_LIMIT);
}

/** 读取条数上限（未配置或非法时返回默认值） */
export async function getHistoryLimit(): Promise<number> {
  const n = await storageGet<number>(STORAGE_KEYS.jsonFormatterHistoryLimit);
  if (typeof n === 'number' && Number.isFinite(n)) return clampHistoryLimit(n);
  return DEFAULT_HISTORY_LIMIT;
}

/** 读取历史列表（最新在最前） */
export async function getHistory(): Promise<JsonHistoryEntry[]> {
  const list = await storageGet<JsonHistoryEntry[]>(STORAGE_KEYS.jsonFormatterHistory);
  return Array.isArray(list) ? list : [];
}

/** 新增一条历史（插到最前），按当前上限裁剪，返回新列表 */
export async function addHistory(content: string): Promise<JsonHistoryEntry[]> {
  const [list, limit] = await Promise.all([getHistory(), getHistoryLimit()]);
  const entry: JsonHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    timestamp: Date.now(),
  };
  const next = [entry, ...list].slice(0, limit);
  await storageSet(STORAGE_KEYS.jsonFormatterHistory, next);
  return next;
}

/** 删除单条历史，返回新列表 */
export async function removeHistory(id: string): Promise<JsonHistoryEntry[]> {
  const list = await getHistory();
  const next = list.filter((e) => e.id !== id);
  await storageSet(STORAGE_KEYS.jsonFormatterHistory, next);
  return next;
}

/** 清空全部历史 */
export async function clearHistory(): Promise<JsonHistoryEntry[]> {
  await storageSet(STORAGE_KEYS.jsonFormatterHistory, []);
  return [];
}

/** 按新上限裁剪超出的旧记录（配置变更后调用） */
export async function trimHistoryToLimit(limit: number): Promise<void> {
  const capped = clampHistoryLimit(limit);
  const list = await getHistory();
  await storageSet(STORAGE_KEYS.jsonFormatterHistory, list.slice(0, capped));
}
