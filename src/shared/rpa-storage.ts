import type { RpaMacro } from './rpa-types';
import { STORAGE_KEYS } from './storage';

const MACROS_KEY = STORAGE_KEYS.rpaMacros;

/** 读取所有录制脚本（新的在前） */
export async function listScripts(): Promise<RpaMacro[]> {
  const data = (await chrome.storage.local.get(MACROS_KEY)) as {
    [MACROS_KEY]?: RpaMacro[];
  };
  return data[MACROS_KEY] ?? [];
}

/** 按 id 读取单个脚本 */
export async function getScript(id: string): Promise<RpaMacro | null> {
  const list = await listScripts();
  return list.find((s) => s.id === id) ?? null;
}

/** 保存脚本（插入到列表头部） */
export async function saveScript(script: RpaMacro): Promise<void> {
  const list = await listScripts();
  await chrome.storage.local.set({ [MACROS_KEY]: [script, ...list] });
}

/** 导入结果 */
export interface ImportResult {
  /** 实际新导入的数量 */
  imported: number;
  /** 跳过数量（重名或名称为空等无效脚本） */
  skipped: number;
}

/** 名称归一化：trim + 小写，用于判重 */
function normalizeName(name?: string): string {
  return (name ?? '').trim().toLowerCase();
}

/** 批量导入脚本（按 name 判重，重名跳过；id 缺失或冲突时自动生成唯一 id；新脚本插入头部） */
export async function importScripts(scripts: RpaMacro[]): Promise<ImportResult> {
  const list = await listScripts();
  const usedNames = new Set(list.map((s) => normalizeName(s.name)));
  const usedIds = new Set(list.map((s) => s.id));

  const toAdd: RpaMacro[] = [];
  let skipped = 0;

  for (const raw of scripts) {
    const name = normalizeName(raw.name);
    if (!name) {
      skipped++;
      continue;
    }
    if (usedNames.has(name)) {
      skipped++;
      continue;
    }
    let id = raw.id;
    if (!id || usedIds.has(id)) {
      id = createMacroId();
    }
    usedIds.add(id);
    usedNames.add(name);
    toAdd.push({ ...raw, id });
  }

  if (toAdd.length > 0) {
    await chrome.storage.local.set({ [MACROS_KEY]: [...toAdd, ...list] });
  }

  return { imported: toAdd.length, skipped };
}

/** 重命名脚本 */
export async function renameScript(id: string, name: string): Promise<void> {
  const list = await listScripts();
  await chrome.storage.local.set({
    [MACROS_KEY]: list.map((s) => (s.id === id ? { ...s, name } : s)),
  });
}

/** 覆盖更新整个脚本（用于事件编辑） */
export async function updateScript(script: RpaMacro): Promise<void> {
  const list = await listScripts();
  await chrome.storage.local.set({
    [MACROS_KEY]: list.map((s) => (s.id === script.id ? script : s)),
  });
}

/** 删除脚本 */
export async function deleteScript(id: string): Promise<void> {
  const list = await listScripts();
  await chrome.storage.local.set({
    [MACROS_KEY]: list.filter((s) => s.id !== id),
  });
}

/** 生成事件唯一 ID */
export function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 生成脚本（宏）唯一 ID */
export function createMacroId(): string {
  return crypto.randomUUID();
}
