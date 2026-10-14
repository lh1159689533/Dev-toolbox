import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchBranches } from '../../api/git';
import Select from '../../components/Select';

interface Props {
  projectPath: string;
  value: string; // 空字符串 = 仓库默认分支
  onChange: (branch: string) => void;
}

const DEBOUNCE_MS = 350;

/** 分支可搜索下拉：输入关键字远程搜索（接口 search 参数），首项为仓库默认分支 */
export default function BranchSelect({ projectPath, value, onChange }: Props) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // 卸载时中止未完成的请求与防抖定时器
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      window.clearTimeout(timerRef.current);
    };
  }, []);

  // 仓库路径变化：清空搜索状态并回退到默认分支（跳过首次挂载）
  const prevPathRef = useRef(projectPath);
  useEffect(() => {
    if (prevPathRef.current === projectPath) return;
    prevPathRef.current = projectPath;
    setBranches([]);
    setError('');
    onChange('');
  }, [projectPath, onChange]);

  /** 远程搜索分支（immediate = 立即执行，否则防抖） */
  const search = (kw: string, immediate: boolean) => {
    controllerRef.current?.abort();
    window.clearTimeout(timerRef.current);
    if (!projectPath.trim()) return;
    const run = () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError('');
      fetchBranches(projectPath, kw, controller.signal)
        .then((list) => setBranches(list))
        .catch((e) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
          setBranches([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    if (immediate) run();
    else timerRef.current = window.setTimeout(run, DEBOUNCE_MS);
  };

  // 选项列表：首项为「默认分支」（value 为空串，不传 ref_name）
  const options = [
    { value: '', label: '默认分支（仓库默认）', hint: true },
    ...branches.map((b) => ({ value: b, label: b })),
  ];

  const emptyText: ReactNode = !projectPath.trim()
    ? '请先填写工蜂仓库路径'
    : error
      ? error
      : loading && branches.length === 0
        ? '分支加载中…'
        : '未匹配到分支';

  return (
    <Select
      searchable
      localFilter={false}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="默认分支（仓库默认）"
      emptyText={emptyText}
      footer={loading && branches.length > 0 ? '搜索中…' : undefined}
      onOpen={() => search('', true)}
      onSearch={(kw) => search(kw, false)}
    />
  );
}
