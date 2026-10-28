import { useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS, storageGetMany, storageSetMany } from '../../shared/storage';
import {
  clampHistoryLimit,
  DEFAULT_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  trimHistoryToLimit,
} from '../../shared/json-history';
import Input from '../Input';
import Button from '../Button';
import { getCategories, getSites, saveCategories, saveSites } from '../../shared/sites';
import './index.css';

interface DefaultQuery {
  projectPath: string;
  branch: string;
  author: string;
  workspaceId: string;
}

interface Settings {
  gitToken: string;
  tapdAuth: string;
  defaultQuery: DefaultQuery;
  jsonHistoryLimit: number;
  rpaRecordSameOrigin: boolean;
}

const EMPTY_QUERY: DefaultQuery = { projectPath: '', branch: '', author: '', workspaceId: '' };
const EMPTY_SETTINGS: Settings = {
  gitToken: '',
  tapdAuth: '',
  defaultQuery: EMPTY_QUERY,
  jsonHistoryLimit: DEFAULT_HISTORY_LIMIT,
  rpaRecordSameOrigin: true,
};

function IncreaseIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path stroke="currentColor" d="M17.5 14.5L12 9L6.5 14.5" strokeLinecap="square" strokeWidth="2" />
    </svg>
  );
}

function DecreaseIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path stroke="currentColor" d="M17.5 9.5L12 15L6.5 9.5" strokeLinecap="square" strokeWidth="2" />
    </svg>
  );
}

interface SettingsFormProps {
  /** 是否显示「JSON 格式化」历史记录条数配置（仅主应用设置抽屉需要） */
  showJsonHistory?: boolean;
  /** 是否显示「网站收藏」分类管理（仅主应用设置抽屉需要） */
  showSiteCategories?: boolean;
}

/** 设置表单：配置认证凭证、默认查询条件与 JSON 历史条数，保存到 chrome.storage.local */
export default function SettingsForm({ showJsonHistory = false, showSiteCategories = false }: SettingsFormProps) {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [siteCategories, setSiteCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const keys: string[] = [
      STORAGE_KEYS.gitToken,
      STORAGE_KEYS.tapdAuth,
      STORAGE_KEYS.defaultQuery,
      STORAGE_KEYS.rpaRecordSameOrigin,
    ];
    if (showJsonHistory) keys.push(STORAGE_KEYS.jsonFormatterHistoryLimit);

    storageGetMany(keys).then((res) => {
      if (cancelled) return;
      const rawLimit = res[STORAGE_KEYS.jsonFormatterHistoryLimit];
      setSettings({
        gitToken: (res[STORAGE_KEYS.gitToken] as string) ?? '',
        tapdAuth: (res[STORAGE_KEYS.tapdAuth] as string) ?? '',
        defaultQuery: { ...EMPTY_QUERY, ...((res[STORAGE_KEYS.defaultQuery] as DefaultQuery) ?? {}) },
        jsonHistoryLimit:
          typeof rawLimit === 'number' && Number.isFinite(rawLimit)
            ? clampHistoryLimit(rawLimit)
            : DEFAULT_HISTORY_LIMIT,
        rpaRecordSameOrigin: (res[STORAGE_KEYS.rpaRecordSameOrigin] as boolean) ?? true,
      });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showJsonHistory]);

  // 加载网站收藏分类列表（即时读写，不走「保存」按钮）
  useEffect(() => {
    if (!showSiteCategories) return;
    void getCategories().then(setSiteCategories);
  }, [showSiteCategories]);

  const addCategory = async () => {
    const v = newCategory.trim();
    if (!v || siteCategories.includes(v)) return;
    const next = [...siteCategories, v];
    await saveCategories(next);
    setSiteCategories(next);
    setNewCategory('');
  };

  const removeCategory = async (cat: string) => {
    const sites = await getSites();
    const count = sites.filter((s) => s.category === cat).length;
    const tip = count > 0 ? `该分类下 ${count} 个网站将自动归入「未分类」。` : '';
    if (!window.confirm(`确定删除分类「${cat}」吗？${tip}`)) return;

    const next = siteCategories.filter((c) => c !== cat);
    await saveCategories(next);
    setSiteCategories(next);

    const changed = sites.map((s) => (s.category === cat ? { ...s, category: '' } : s));
    await saveSites(changed);
  };

  const startEdit = (cat: string) => {
    setEditingCategory(cat);
    setEditingValue(cat);
  };

  const cancelEdit = () => {
    setEditingCategory(null);
    setEditingValue('');
  };

  const saveEdit = async () => {
    if (editingCategory === null) return;
    const v = editingValue.trim();
    // 空值或未变化：直接取消（保持原名）
    if (!v || v === editingCategory) {
      cancelEdit();
      return;
    }
    // 与其他分类重名：取消（不保存）
    if (siteCategories.includes(v)) {
      cancelEdit();
      return;
    }

    const next = siteCategories.map((c) => (c === editingCategory ? v : c));
    await saveCategories(next);
    setSiteCategories(next);

    const sites = await getSites();
    const changed = sites.map((s) => (s.category === editingCategory ? { ...s, category: v } : s));
    await saveSites(changed);

    cancelEdit();
  };

  const updateField = (key: 'gitToken' | 'tapdAuth', value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  };

  const updateQuery = (key: keyof DefaultQuery, value: string) => {
    setSettings((s) => ({ ...s, defaultQuery: { ...s.defaultQuery, [key]: value } }));
    setSaved(false);
  };

  const updateLimit = (value: string) => {
    const n = Number(value);
    setSettings((s) => ({ ...s, jsonHistoryLimit: value === '' ? NaN : n }));
    setSaved(false);
  };

  const updateRpaSameOrigin = (value: boolean) => {
    setSettings((s) => ({ ...s, rpaRecordSameOrigin: value }));
    setSaved(false);
  };

  const stepLimit = (delta: number) => {
    setSettings((s) => {
      const base = Number.isFinite(s.jsonHistoryLimit) ? s.jsonHistoryLimit : DEFAULT_HISTORY_LIMIT;
      return { ...s, jsonHistoryLimit: clampHistoryLimit(base + delta) };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    const limit = clampHistoryLimit(settings.jsonHistoryLimit);
    const values: Record<string, unknown> = {
      [STORAGE_KEYS.gitToken]: settings.gitToken.trim(),
      [STORAGE_KEYS.tapdAuth]: settings.tapdAuth.trim(),
      [STORAGE_KEYS.defaultQuery]: settings.defaultQuery,
      [STORAGE_KEYS.rpaRecordSameOrigin]: settings.rpaRecordSameOrigin,
    };
    if (showJsonHistory) {
      values[STORAGE_KEYS.jsonFormatterHistoryLimit] = limit;
    }
    await storageSetMany(values);
    if (showJsonHistory) {
      await trimHistoryToLimit(limit);
    }
    setSettings((s) => ({ ...s, jsonHistoryLimit: showJsonHistory ? limit : s.jsonHistoryLimit }));
    setSaved(true);
  };

  if (!loaded) {
    return <div className="settings-form-loading">加载中…</div>;
  }

  return (
    <div className="settings-form">
      <section className="form-section">
        <h2>认证凭证（TAPD 评论回填）</h2>
        <p className="hint">凭证仅保存在本机浏览器本地，不会上传到任何服务器。</p>
        <label className="field">
          <span>工蜂 Private Token</span>
          <Input
            type="password"
            value={settings.gitToken}
            onChange={(e) => updateField('gitToken', e.target.value)}
            placeholder="git.woa.com → 设置 → Access Tokens"
          />
        </label>
        <label className="field">
          <span>TAPD Access Token</span>
          <Input
            type="password"
            value={settings.tapdAuth}
            onChange={(e) => updateField('tapdAuth', e.target.value)}
            placeholder="TAPD 开放平台 → 个人中心 → 个人访问令牌"
          />
        </label>
      </section>

      <section className="form-section">
        <h2>默认查询条件（可选）</h2>
        <p className="hint">作为「TAPD 评论回填」工具首次打开时的默认值，可在工具内临时修改。</p>
        <label className="field">
          <span>工蜂仓库路径</span>
          <Input
            value={settings.defaultQuery.projectPath}
            onChange={(e) => updateQuery('projectPath', e.target.value)}
            placeholder="group/repo"
          />
        </label>
        <label className="field">
          <span>分支</span>
          <Input
            value={settings.defaultQuery.branch}
            onChange={(e) => updateQuery('branch', e.target.value)}
            placeholder="留空 = 仓库默认分支"
          />
        </label>
        <label className="field">
          <span>用户（作者）</span>
          <Input
            value={settings.defaultQuery.author}
            onChange={(e) => updateQuery('author', e.target.value)}
            placeholder="英文名"
          />
        </label>
        <label className="field">
          <span>TAPD 项目 ID</span>
          <Input
            value={settings.defaultQuery.workspaceId}
            onChange={(e) => updateQuery('workspaceId', e.target.value)}
            placeholder="workspace_id（数字）"
          />
        </label>
      </section>

      {showJsonHistory && (
        <section className="form-section">
          <h2>JSON 格式化</h2>
          <p className="hint">配置「JSON 格式化」工具的历史记录保留条数。</p>
          <label className="field">
            <span>历史记录条数上限</span>
            <div className="sf-limit-wrap">
              <Input
                type="number"
                min={MIN_HISTORY_LIMIT}
                max={MAX_HISTORY_LIMIT}
                step={1}
                className="sf-limit"
                value={Number.isFinite(settings.jsonHistoryLimit) ? settings.jsonHistoryLimit : ''}
                onChange={(e) => updateLimit(e.target.value)}
                placeholder={`${MIN_HISTORY_LIMIT} ~ ${MAX_HISTORY_LIMIT}`}
              />
              <span className="sf-limit-stepper">
                <button
                  type="button"
                  className="sf-limit-btn increase"
                  title="增加 1 条"
                  onClick={() => stepLimit(1)}
                >
                  <IncreaseIcon />
                </button>
                <button
                  type="button"
                  className={`sf-limit-btn decrease ${
                    (Number.isFinite(settings.jsonHistoryLimit) ? settings.jsonHistoryLimit : DEFAULT_HISTORY_LIMIT) <=
                    MIN_HISTORY_LIMIT
                      ? 'disabled'
                      : ''
                  }`}
                  title="减少 1 条"
                  onClick={() => stepLimit(-1)}
                >
                  <DecreaseIcon />
                </button>
              </span>
            </div>
          </label>
          <p className="hint">
            范围 {MIN_HISTORY_LIMIT} ~ {MAX_HISTORY_LIMIT}，默认 {DEFAULT_HISTORY_LIMIT} 条。
          </p>
        </section>
      )}

      {showSiteCategories && (
        <section className="form-section">
          <h2>网站收藏</h2>
          <p className="hint">管理「网站收藏」工具的分类；删除分类后，其下网站会自动归入「未分类」。</p>
          <div className="sf-cat-list">
            {siteCategories.length === 0 ? (
              <p className="hint">暂无分类，可在下方添加。</p>
            ) : (
              siteCategories.map((c) =>
                editingCategory === c ? (
                  <div key={c} className="sf-cat-item">
                    <Input
                      autoFocus
                      size="small"
                      className="sf-cat-edit-input"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => {
                        if (cancelBlurRef.current) {
                          cancelBlurRef.current = false;
                          return;
                        }
                        void saveEdit();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void saveEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelBlurRef.current = true;
                          cancelEdit();
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div key={c} className="sf-cat-item">
                    <span>{c}</span>
                    <div className="sf-cat-actions">
                      <button type="button" className="sf-cat-edit" onClick={() => startEdit(c)}>
                        编辑
                      </button>
                      <button type="button" className="sf-cat-del" onClick={() => void removeCategory(c)}>
                        删除
                      </button>
                    </div>
                  </div>
                )
              )
            )}
          </div>
          <div className="sf-cat-add">
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="输入新分类名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addCategory();
                }
              }}
            />
            <Button onClick={() => void addCategory()}>添加</Button>
          </div>
        </section>
      )}

      <section className="form-section">
        <h2>录制回放</h2>
        <p className="hint">控制「录制回放」工具在录制时的行为。</p>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={settings.rpaRecordSameOrigin}
            onChange={(e) => updateRpaSameOrigin(e.target.checked)}
          />
          <span>录制时限制同源页面</span>
        </label>
        <p className="hint">
          开启后，录制过程中新开的标签页只有与起始页同源才会自动继续录制；关闭后，跨域页面（如跳转的支付页）也会自动续录。
        </p>
      </section>

      <footer className="form-footer">
        <Button variant="primary" onClick={handleSave}>
          保存
        </Button>
        {saved && <span className="saved-tip">已保存 ✓</span>}
      </footer>
    </div>
  );
}
