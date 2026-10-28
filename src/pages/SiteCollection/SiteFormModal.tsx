import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Textarea from '../../components/Textarea';
import type { SiteFormData } from './index';

interface SiteFormModalProps {
  categories: string[];
  /** 提交：返回错误消息（校验失败/重复）或 null（成功） */
  onSubmit: (data: SiteFormData) => Promise<string | null>;
  onClose: () => void;
}

/** 从输入串解析标签（支持逗号分隔） */
function splitTags(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function SiteFormModal({ categories, onSubmit, onClose }: SiteFormModalProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [logo, setLogo] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const addTag = (raw: string) => {
    const parts = splitTags(raw);
    if (parts.length === 0) return;
    setTags((prev) => {
      const next = [...prev];
      for (const p of parts) if (!next.includes(p)) next.push(p);
      return next;
    });
    setTagInput('');
  };

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('请填写网站名称');
      return;
    }
    if (!url.trim()) {
      setError('请填写网站地址');
      return;
    }
    setSubmitting(true);
    const err = await onSubmit({
      name: name.trim(),
      logo: logo.trim(),
      description,
      category: category.trim(),
      tags,
      url: url.trim(),
    });
    setSubmitting(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="sc-modal-mask">
      <div className="sc-modal">
        <header className="sc-modal-header">
          <span>新增网站</span>
          <button type="button" className="sc-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="sc-modal-body">
          <label className="sc-field">
            <span>网站名称 *</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：工蜂 Git" />
          </label>

          <label className="sc-field">
            <span>网站地址 *</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="例如：https://git.woa.com" />
          </label>

          <label className="sc-field">
            <span>Logo（图片链接，选填）</span>
            <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="例如：https://…/logo.png" />
          </label>

          <label className="sc-field">
            <span>描述（支持 Markdown）</span>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="支持标题、列表、链接、代码块等基础 Markdown 语法"
              rows={4}
            />
          </label>

          <div className="sc-field">
            <span>分类</span>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="选择已有分类，或直接输入新建分类"
            />
            {categories.length > 0 && (
              <div className="sc-cat-chips">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`sc-cat-chip${category === c ? ' active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sc-field">
            <span>标签（回车或逗号分隔）</span>
            <div className="sc-tag-input-wrap">
              {tags.map((t) => (
                <span key={t} className="sc-tag-chip">
                  {t}
                  <button
                    type="button"
                    className="sc-tag-chip-x"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    aria-label={`移除标签 ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="sc-tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => {
                  if (tagInput.trim()) addTag(tagInput);
                }}
                placeholder={tags.length === 0 ? '输入后按回车添加' : ''}
              />
            </div>
          </div>

          {error && <div className="sc-form-error">{error}</div>}
        </div>

        <footer className="sc-modal-footer">
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
