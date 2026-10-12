import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ResizableImage } from '../../extensions/ResizableImage';
import { fetchTapdInfo, fetchStatusOptions, uploadImage, addComment, resolveDetailUrl } from '../../api/tapd';
import { normalizeProjectPath } from '../../api/git';
import type { CommitRecord, TapdBug, TapdRef } from '../../types';
import { LoadingDots } from '../../components/Loading';
import Button from '../../components/Button';
import ErrorTip from '../../components/ErrorTip';

interface Props {
  commit: CommitRecord;
  workspaceId: string;
  projectPath: string;
  onClose: () => void;
  onCommented: (tapd: TapdRef) => void;
}

/** 工蜂 commit 详情页 URL（git.woa.com，GitLab 标准路由 /-/commit/） */
function buildCommitUrl(projectPath: string, commitId: string): string {
  const path = normalizeProjectPath(projectPath);
  return `https://git.woa.com/${path}/commit/${commitId}`;
}

/** 评论模板：四个字段各自独立段落（HTML，tiptap 按 HTML 解析才能正确换行） */
const TEMPLATE_HTML = (commitUrl: string) =>
  `<p>自测截图：</p><p>代码commit：${commitUrl}</p><p>问题原因：</p><p>解决方法：</p>`;

export default function CommentDialog({ commit, workspaceId, projectPath, onClose, onCommented }: Props) {
  const [bugInfo, setBugInfo] = useState<TapdBug | null>(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [loadingTitle, setLoadingTitle] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jumpError, setJumpError] = useState('');
  const [resolvingId, setResolvingId] = useState(false);

  const commitUrl = buildCommitUrl(projectPath, commit.id);

  const editor = useEditor({
    extensions: [StarterKit, ResizableImage],
    content: TEMPLATE_HTML(commitUrl),
    editorProps: {
      attributes: {
        class: 'rich-editor',
      },
      // 拦截粘贴：图片则上传回显，其余交给编辑器默认处理
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImagesAtEnd(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImagesAtEnd(files);
        return true;
      },
    },
  });

  // 粘贴/拖拽图片后：逐个上传，拿到地址后插入到「自测截图：」文案之后
  const insertImagesAtEnd = async (files: File[]) => {
    if (!editor) return;
    for (const file of files) {
      try {
        if (!workspaceId) {
          setError('请先在上方选择 TAPD 项目');
          return;
        }
        const html = await uploadImage(workspaceId, file);
        // html_code 形如 <img src="/tfl/pictures/xxx.png"/>，提取 src
        const m = html.match(/src=["']([^"']+)["']/);
        const rawSrc = m ? m[1] : '';
        // TAPD 返回的是相对路径，回填时补全域名前缀
        const src = rawSrc ? `https://tapd.woa.com${rawSrc}` : '';
        if (!src) {
          setError('图片上传成功但未解析到地址');
          continue;
        }
        editor
          .chain()
          .focus()
          .insertContentAt(findScreenshotAnchor(editor), {
            type: 'image',
            attrs: { src, alt: file.name },
          })
          .run();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  // 加载 TAPD 单标题（同时拿到 19 位长 ID 与 status，评论时使用）
  useEffect(() => {
    if (!commit.tapd || !workspaceId) return;
    setLoadingTitle(true);
    setBugInfo(null);
    setStatusLabel('');
    fetchTapdInfo(workspaceId, commit.tapd.id, commit.tapd.type)
      .then((info) => {
        setBugInfo(info);
        // 用状态选项把原始值翻译成中文；映射不到时兜底显示原始值
        if (info.status) {
          fetchStatusOptions(workspaceId, commit.tapd!.type)
            .then((map) => setStatusLabel(map.get(info.status!) ?? info.status!))
            .catch(() => setStatusLabel(info.status!));
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setBugInfo(null);
      })
      .finally(() => setLoadingTitle(false));
  }, [commit.tapd?.id, commit.tapd?.type]);

  // 弹窗打开时编辑器已初始化；此处兜底：若内容为空则填入模板
  useEffect(() => {
    if (editor && editor.isEmpty) {
      editor.commands.setContent(TEMPLATE_HTML(commitUrl));
    }
  }, [editor, commitUrl]);

  const handleJump = async () => {
    if (!commit.tapd) return;
    if (!workspaceId) {
      setJumpError('请先在上方选择 TAPD 项目');
      return;
    }
    setResolvingId(true);
    setJumpError('');
    try {
      const url = await resolveDetailUrl(workspaceId, commit.tapd.id, commit.tapd.type);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setJumpError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolvingId(false);
    }
  };

  const handleSubmit = async () => {
    if (!workspaceId) {
      setError('请先在上方填写 TAPD 项目 ID (workspace_id)');
      return;
    }
    if (!commit.tapd) {
      setError('未解析到 TAPD ID，无法评论');
      return;
    }
    if (!bugInfo) {
      setError('TAPD 单信息未加载成功（长 ID 获取失败），无法评论');
      return;
    }
    if (!editor) return;

    setSubmitting(true);
    setError('');
    try {
      // 正文直接取富文本 HTML（图片已在上传时回显为 <img>）
      const description = editor.getHTML();

      await addComment({
        workspaceId,
        entryId: bugInfo.id,
        type: commit.tapd.type,
        description,
        author: commit.authorName,
      });

      onCommented({ id: commit.tapd.id, type: commit.tapd.type });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-mask">
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>回填 TAPD 评论</h2>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="dialog-body">
          <div className="bug-info">
            <span className={`bug-tag${commit.tapd?.type === 'story' ? ' story' : ''}`}>
              {commit.tapd?.type === 'story' ? 'STORY' : 'BUG'}
            </span>
            {statusLabel && (
              <span className={`bug-status bug-status-${statusColorClass(bugInfo?.status)}`}>{statusLabel}</span>
            )}
            <span className="bug-title">
              {loadingTitle ? (
                <>
                  标题加载中
                  <LoadingDots />
                </>
              ) : (
                (bugInfo?.title ?? '（标题获取失败）')
              )}
            </span>
            <button className="bug-id-link" onClick={handleJump} disabled={resolvingId} title="点击跳转 TAPD">
              #{commit.tapd?.id}
            </button>
          </div>
          {jumpError && <ErrorTip>{jumpError}</ErrorTip>}

          <div className="field">
            <span className="label">评论内容</span>
            <EditorContent editor={editor} />
          </div>

          {error && <ErrorTip>{error}</ErrorTip>}
        </div>

        <div className="dialog-footer">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '提交中…' : '确认评论'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 根据 bug 状态原始值返回颜色分类（用于状态徽章配色） */
function statusColorClass(status?: string): string {
  switch (status) {
    case 'new':
    case 'reopened':
      return 'blue';
    case 'in_progress':
    case 'acknowledged':
      return 'orange';
    case 'resolved':
      return 'green';
    case 'closed':
    case 'rejected':
      return 'gray';
    default:
      return 'neutral';
  }
}

/** 找到「自测截图：」文本节点后的位置，返回插入位置（图片放在该文案之后） */
function findScreenshotAnchor(editor: { state: import('@tiptap/pm/state').EditorState }): number {
  const doc = editor.state.doc;
  let anchor = doc.content.size;
  doc.descendants((node, pos) => {
    if (node.type.name === 'text' && node.text?.includes('自测截图：')) {
      anchor = pos + (node.text?.indexOf('自测截图：') ?? 0) + 5;
      return false;
    }
    return true;
  });
  return anchor;
}
