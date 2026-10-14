import type { TapdWorkspace } from '../../types';
import Select from '../../components/Select';

interface Props {
  workspaces: TapdWorkspace[];
  value: string; // 空字符串 = 未选择
  loading?: boolean;
  onChange: (workspaceId: string) => void;
}

/** 项目可搜索下拉：与分支下拉一致，基于本地列表按名称/ID 关键字过滤 */
export default function WorkspaceSelect({ workspaces, value, loading = false, onChange }: Props) {
  const options = workspaces.map((w) => ({ value: w.id, label: `${w.name} (${w.id})` }));
  const emptyText = loading ? '项目加载中…' : workspaces.length === 0 ? '暂无可用项目' : '未匹配到项目';

  return (
    <Select searchable value={value} options={options} onChange={onChange} placeholder="请选择项目" emptyText={emptyText} />
  );
}
