# 开发工具集 (dev-toolbox)

个人本地开发工具集合，将常用的小工具集中到一个站点中，方便日常开发协作时快速使用。

## 已内置工具

| 工具 | 说明 | 类型 |
| --- | --- | --- |
| TAPD 评论回填 | 拉取工蜂 commit → 解析 `--bug=xxx`（TAPD 缺陷 ID）→ 一键回填评论（含自测截图） | 内置 |
| JSON 格式化 | JSON 字符串格式化为对象，方便查看 | 内置 |
| 时间戳转换 | 时间戳与日期时间互转 | 外部链接 |

> 工具通过 `src/data/tools.json` 统一管理，新增工具只需在该文件中登记元信息，即可自动出现在首页并支持搜索与分类。

## 技术栈

Vite + React + TypeScript，路由基于 React Router。通过 Vite proxy 转发工蜂 OpenAPI（`git.woa.com`）与 TAPD OpenAPI（`apiv2.tapd.woa.com`），解决跨域与认证问题；富文本评论编辑基于 Tiptap。

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

## 配置（仅「TAPD 评论回填」工具需要）

### 1. 工蜂 Private Token

`git.woa.com` → 右上角头像 → Settings → Access Tokens → 创建，勾选 `read_repository` 权限，复制 Token。

### 2. TAPD 个人访问令牌

TAPD 开放平台 → 个人中心 → 生成「个人访问令牌」（Access Token）。

### 3. 环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```ini
GIT_TOKEN=你的工蜂PrivateToken
TAPD_AUTH=你的TAPD个人访问令牌

# 以下为 TAPD 评论回填工具的默认查询条件（可选）
VITE_PROJECT_PATH=group/repo
VITE_BRANCH=
VITE_AUTHOR=
VITE_WORKSPACE_ID=
```

> 认证凭证在 Vite 的 server 代理层注入请求头，不会暴露到浏览器端。

## TAPD 评论回填使用说明

- **工蜂仓库路径**：填 `group/repo` 形式，如 `wedata/wedata3-monorepo`
- **TAPD 项目 ID**：即 TAPD 的 `workspace_id`（数字），在 TAPD 项目 URL 或设置中可见
- commit message 需包含 `--bug=<数字>` 才会解析出 TAPD ID 并启用「编辑」按钮
- 评论模板中「代码 commit」会自动填入 commit 短 ID
