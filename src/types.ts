export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  /** 工具图标：本地图片路径（相对 src，如 ./public/icons/foo.svg），支持 svg/png/jpg 等 */
  icon: string;
  /** 工具类型：internal = 本地路由（默认）；external = 外部链接 */
  type?: 'internal' | 'external';
  /** internal 类型的本地路由（如 /tools/tapd-comment） */
  path?: string;
  /** external 类型的外部链接（如 https://...） */
  url?: string;
  enabled: boolean;
}

/** TAPD 单据类型：bug = 缺陷单，story = 需求单 */
export type TapdType = 'bug' | 'story';

/** 解析出的 TAPD 关联信息 */
export interface TapdRef {
  id: string; // TAPD 短 ID
  type: TapdType; // 单据类型
}

export interface CommitRecord {
  id: string; // commit 短 id
  commitId: string; // commit 完整 sha
  title: string; // commit message 第一行（或完整 message）
  message: string; // 完整 commit message
  authorName: string;
  createdAt: string;
  tapd?: TapdRef; // 解析出的 TAPD 关联（story 优先，否则 bug）
}

export interface GitlabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  committed_date: string;
  created_at: string;
  parent_ids: string[]; // 用于判断 merge commit（父提交数 > 1）
}

export interface CommitQuery {
  projectPath: string; // 仓库路径，如 group/repo
  branch: string; // 分支名；空字符串 = 仓库默认分支（不传 ref_name）
  author: string; // 作者（用户名/邮箱，接口不支持，前端过滤）
  since: string; // 起始日期 YYYY-MM-DD
  until: string; // 结束日期 YYYY-MM-DD
  workspaceId: string; // TAPD 项目 ID
}

export interface GitBranch {
  name: string;
}

export interface TapdBug {
  id: string;
  title: string;
  status?: string; // 单当前状态原始值，如 new / resolved
}

export interface TapdWorkspace {
  id: string;
  name: string;
}
