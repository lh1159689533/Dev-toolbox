import type { TapdBug, TapdType, TapdWorkspace } from '../types';

const TAPD_BASE = '/tapd-api';

export function getType(type: TapdType) {
  return type === 'story' ? 'stories' : 'bugs';
}

/** 生成 TAPD 单详情页跳转链接（需 19 位长 ID） */
export function buildDetailUrl(workspaceId: string, longId: string, type: TapdType): string {
  return `https://tapd.woa.com/tapd_fe/${workspaceId}/${type}/detail/${longId}`;
}

/** 根据短 ID 转长 ID 后返回 TAPD 单详情页链接 */
export async function resolveDetailUrl(workspaceId: string, id: string, type: TapdType): Promise<string> {
  const longId = await resolveLongId(workspaceId, id, type);
  return buildDetailUrl(workspaceId, longId, type);
}

/** 获取当前用户参与的项目列表（仅支持 OAuth Access Token） */
export async function fetchWorkspaces(): Promise<TapdWorkspace[]> {
  const res = await fetch(`${TAPD_BASE}/workspaces/get_participant_projects`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD 项目列表获取失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json?.status !== 1) {
    throw new Error(`TAPD 项目列表获取失败: ${json?.info || '未知错误'}`);
  }

  return (json?.data ?? [])
    .map((item: { Workspace?: TapdWorkspace }) => item.Workspace)
    .filter((w: TapdWorkspace) => w && w.id && w.name);
}

interface ShardIdMap {
  type: string;
  short_id: string;
  workspace_id: string;
  long_id: string;
}

/** 短 ID → 19 位长 ID（TAPD shard_id 接口）；已是长 ID 时原样返回 */
export async function resolveLongId(workspaceId: string, id: string, type: TapdType = 'bug'): Promise<string> {
  // TAPD 短 ID 为 9 位及以下，长 ID 固定 19 位，已够长的无需转换
  if (id.length >= 15) return id;

  const params = new URLSearchParams();
  params.set('type', type);
  params.set('short_id', id);
  params.set('workspace_id', workspaceId);

  const res = await fetch(`${TAPD_BASE}/shard_id?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD ID 转换失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json?.status !== 1) {
    throw new Error(`TAPD ID 转换失败: ${json?.info || '未知错误'}`);
  }

  const map = (json?.data ?? [])
    .map((item: { ShardIdMap?: ShardIdMap }) => item.ShardIdMap)
    .find((m: ShardIdMap) => m && m.type === type && m.long_id);
  if (!map) {
    throw new Error(`未找到 ${type} 短 ID ${id} 对应的长 ID（请检查 workspace_id 是否正确）`);
  }
  return map.long_id;
}

/** 根据短 ID + workspace_id 查询 TAPD 单，先转长 ID 再查详情，返回长 ID 与标题 */
export async function fetchTapdInfo(workspaceId: string, id: string, type: TapdType): Promise<TapdBug> {
  const longId = await resolveLongId(workspaceId, id, type);

  const params = new URLSearchParams();
  params.set('workspace_id', workspaceId);
  params.set('id', longId);
  // bug 标题字段为 title，story 标题字段为 name
  params.set('fields', type === 'bug' ? 'id,title,status' : 'id,name,status');

  const res = await fetch(`${TAPD_BASE}/${getType(type)}?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD 查询失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  const entry = json?.data?.find((item: Record<string, unknown>) => item.Bug || item.Story)?.[
    type === 'bug' ? 'Bug' : 'Story'
  ];
  if (!entry) {
    throw new Error(`未找到 ${type} ${longId}（请检查 workspace_id 是否正确）`);
  }
  // 统一归一化为 TapdBug：story 的 name 映射为 title
  return { id: entry.id, title: type === 'bug' ? entry.title : entry.name, status: entry.status } as TapdBug;
}

/** 上传图片，返回可在评论中直接使用的 <img> html 代码 */
export async function uploadImage(workspaceId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('workspace_id', workspaceId);
  form.append('image', file);

  const res = await fetch(`${TAPD_BASE}/files/upload_image`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD 图片上传失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json?.status !== 1) {
    throw new Error(`TAPD 图片上传失败: ${json?.info || '未知错误'}`);
  }
  // html_code 形如 <img src="/tfl/pictures/xxx.png"/>
  return json.data.html_code as string;
}

/** 状态文案映射表缓存（按 type + workspace_id 缓存，避免每次弹窗重复请求） */
const statusOptionsCache = new Map<string, Map<string, string>>();

/**
 * 获取 TAPD 单状态字段的选项，返回「原始值 → 中文文案」映射。
 * 对应 GET /{type}s/get_fields_info，返回结构 data.status.options: { value: label }
 */
export async function fetchStatusOptions(workspaceId: string, type: TapdType): Promise<Map<string, string>> {
  const cacheKey = `${type}:${workspaceId}`;
  const cached = statusOptionsCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams();
  params.set('workspace_id', workspaceId);

  const res = await fetch(`${TAPD_BASE}/${getType(type)}/get_fields_info?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD 状态字段获取失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  const options = json?.data?.status?.options ?? [];
  const map = new Map<string, string>();
  for (const key of Object.keys(options)) {
    if (key) map.set(key, options[key]);
  }

  statusOptionsCache.set(cacheKey, map);
  return map;
}

/** 添加评论到 TAPD 单（entry_id 需传 19 位长 ID，可用 resolveLongId 转换） */
export async function addComment(params: {
  workspaceId: string;
  entryId: string; // 单长 ID
  type: TapdType;
  description: string;
  author: string;
}): Promise<void> {
  const form = new URLSearchParams();
  form.set('workspace_id', params.workspaceId);
  form.set('entry_type', params.type);
  form.set('entry_id', params.entryId);
  form.set('description', params.description);
  form.set('author', params.author);

  const res = await fetch(`${TAPD_BASE}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TAPD 评论失败 (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json?.status !== 1) {
    throw new Error(`TAPD 评论失败: ${json?.info || '未知错误'}`);
  }
}
