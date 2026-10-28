import { useState } from 'react';
import Button from '../../components/Button';
import Select from '../../components/Select';
import type { DiffAction, DiffKind, DiffRow } from '../../shared/sites';

interface ImportDialogProps {
  rows: DiffRow[];
  onCancel: () => void;
  onApply: (rows: DiffRow[]) => void;
}

const KIND_LABEL: Record<DiffKind, string> = {
  update: '更新',
  add: '新增',
  remove: '删除',
};

const ACTION_OPTIONS: Record<DiffKind, { value: DiffAction; label: string }[]> = {
  update: [
    { value: 'overwrite', label: '覆盖' },
    { value: 'skip', label: '跳过' },
  ],
  add: [
    { value: 'add', label: '新增' },
    { value: 'skip', label: '跳过' },
  ],
  remove: [
    { value: 'remove', label: '删除' },
    { value: 'keep', label: '保留' },
  ],
};

function rowName(r: DiffRow): string {
  if (r.kind === 'update') {
    const from = r.existing?.name || '（空）';
    const to = r.incoming?.name || '（空）';
    return from === to ? from : `${from} → ${to}`;
  }
  return (r.incoming ?? r.existing)?.name || '（无名称）';
}

function rowUrl(r: DiffRow): string {
  return (r.incoming ?? r.existing)?.url || r.url;
}

export default function ImportDialog({ rows, onCancel, onApply }: ImportDialogProps) {
  const [stateRows, setStateRows] = useState<DiffRow[]>(rows);

  const setAction = (url: string, action: DiffAction) => {
    setStateRows((prev) => prev.map((r) => (r.url === url ? { ...r, action } : r)));
  };

  const count = stateRows.length;

  return (
    <div className="sc-modal-mask" onMouseDown={onCancel}>
      <div className="sc-modal sc-modal-import" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sc-modal-header">
          <span>导入确认（{count} 项差异）</span>
          <button type="button" className="sc-modal-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="sc-modal-body sc-import-body">
          {stateRows.map((r) => (
            <div key={r.url} className="sc-import-row">
              <span className={`sc-import-kind kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span>
              <div className="sc-import-info">
                <span className="sc-import-name">{rowName(r)}</span>
                <span className="sc-import-url">{rowUrl(r)}</span>
              </div>
              <Select
                value={r.action}
                options={ACTION_OPTIONS[r.kind]}
                onChange={(v) => setAction(r.url, v as DiffAction)}
                className="sc-import-select"
              />
            </div>
          ))}
        </div>

        <footer className="sc-modal-footer">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={() => onApply(stateRows)}>
            应用（{count}）
          </Button>
        </footer>
      </div>
    </div>
  );
}
