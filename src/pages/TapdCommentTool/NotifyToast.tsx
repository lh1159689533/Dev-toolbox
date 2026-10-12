import { useEffect, useState } from 'react';
import { resolveDetailUrl } from '../../api/tapd';
import type { TapdRef } from '../../types';
import Button from '../../components/Button';

interface Props {
  tapd: TapdRef;
  workspaceId: string;
  onClose: () => void;
}

/** 评论成功后的右上角通知提示，仅能手动关闭 */
export default function NotifyToast({ tapd, workspaceId, onClose }: Props) {
  const [jumping, setJumping] = useState(false);
  const [jumpError, setJumpError] = useState('');

  useEffect(() => {
    return () => setJumping(false);
  }, []);

  const handleOpen = async () => {
    if (!workspaceId) {
      setJumpError('请先在上方选择 TAPD 项目');
      return;
    }
    setJumping(true);
    setJumpError('');
    try {
      const url = await resolveDetailUrl(workspaceId, tapd.id, tapd.type);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setJumpError(e instanceof Error ? e.message : String(e));
    } finally {
      setJumping(false);
      onClose();
    }
  };

  return (
    <div className="notify-toast">
      <div className="notify-body">
        <span className="notify-text">TAPD评论已添加，打开TAPD单扭转状态</span>
        <span className="notify-tapd-id">#{tapd.id}</span>
        <Button variant="primary" size="small" className="notify-open" onClick={handleOpen} disabled={jumping}>
          {jumping ? '打开中…' : '打开TAPD'}
        </Button>
      </div>
      {jumpError && <div className="notify-error">{jumpError}</div>}
      <button className="notify-close" onClick={onClose} title="关闭">
        ×
      </button>
    </div>
  );
}
