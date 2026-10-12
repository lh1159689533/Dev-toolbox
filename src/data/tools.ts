import type { ToolMeta } from '../types';
import tools from './tools.json';

const STORAGE_KEY = 'tools:meta';

/** 将工具元信息写入 localStorage（供其他页面复用，避免重复解析） */
export function saveToolsMeta(list: ToolMeta[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** 从 localStorage 读取工具元信息，读不到返回 null */
function readToolsMeta(): ToolMeta[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ToolMeta[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 按 id 获取工具元信息：优先从 localStorage 读，读不到则直接 import tools.json 兜底 */
export function getToolById(id: string): ToolMeta | undefined {
  const list = readToolsMeta() ?? (tools as ToolMeta[]);
  return list.find((t) => t.id === id);
}
