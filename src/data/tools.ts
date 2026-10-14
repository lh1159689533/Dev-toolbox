import type { ToolMeta } from '../types';
import tools from './tools.json';

const toolList = tools as ToolMeta[];

/** 按 id 获取工具元信息（静态配置，直接来自 tools.json） */
export function getToolById(id: string): ToolMeta | undefined {
  return toolList.find((t) => t.id === id);
}
