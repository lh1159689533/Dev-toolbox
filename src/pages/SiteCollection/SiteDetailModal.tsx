import { useLayoutEffect, useRef } from 'react';
import Button from '../../components/Button';
import { UNCATEGORIZED_LABEL, type SiteItem } from '../../shared/sites';
import { renderMarkdown } from '../../shared/markdown';

interface SiteDetailModalProps {
  site: SiteItem;
  /** FLIP 动画起点元素（触发详情弹窗的卡片）；为 null 时直接显示/关闭，不做 FLIP */
  origin: HTMLElement | null;
  onClose: () => void;
}

const FLIP_DURATION = 500; // ms
const FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** 计算从卡片 rect 到弹窗 rect 的 invert transform（中心对齐 + 缩放） */
function invertTransform(from: DOMRect, to: DOMRect): string {
  const tx = from.left + from.width / 2 - (to.left + to.width / 2);
  const ty = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
}

function DetailLogo({ site }: { site: SiteItem }) {
  if (site.logo.trim()) {
    return (
      <span className="site-logo-box site-logo-lg">
        <img className="site-logo" src={site.logo.trim()} alt="" />
      </span>
    );
  }
  return <span className="site-logo-box site-logo-lg site-logo-fallback">{site.name.trim().charAt(0) || '·'}</span>;
}

export default function SiteDetailModal({ site, origin, onClose }: SiteDetailModalProps) {
  const maskRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const finishedRef = useRef(false);

  // 打开动画：FLIP（从卡片位置缩放展开到居中）
  useLayoutEffect(() => {
    const modal = modalRef.current;
    const mask = maskRef.current;
    if (!modal || !mask || !origin || reducedMotion()) return;

    const from = origin.getBoundingClientRect();
    if (from.width === 0 || from.height === 0) return;

    const to = modal.getBoundingClientRect();
    const invert = invertTransform(from, to);

    // 初始：无过渡，弹窗覆盖在卡片位置、遮罩透明
    modal.style.transition = 'none';
    modal.style.transform = invert;
    mask.style.transition = 'none';
    mask.style.opacity = '0';

    // 下一帧：过渡到最终状态（居中、遮罩淡入）
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        modal.style.transition = `transform ${FLIP_DURATION}ms ${FLIP_EASE}`;
        modal.style.transform = 'none';
        mask.style.transition = `opacity ${FLIP_DURATION}ms ease`;
        mask.style.opacity = '1';
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [origin, site.id]);

  // 关闭：反向 FLIP（缩回卡片位置）或直接关闭
  const handleClose = () => {
    if (closingRef.current) return;

    const modal = modalRef.current;
    const mask = maskRef.current;

    if (modal && mask && origin && !reducedMotion()) {
      const from = origin.getBoundingClientRect();
      if (from.width > 0 && from.height > 0) {
        closingRef.current = true;
        const to = modal.getBoundingClientRect();
        const invert = invertTransform(from, to);

        modal.style.transition = `transform ${FLIP_DURATION}ms ${FLIP_EASE}`;
        modal.style.transform = invert;
        mask.style.transition = `opacity ${FLIP_DURATION}ms ease`;
        mask.style.opacity = '0';

        const finish = () => {
          if (finishedRef.current) return;
          finishedRef.current = true;
          onClose();
        };

        const onEnd = (e: TransitionEvent) => {
          if (e.target === modal && e.propertyName === 'transform') finish();
        };
        modal.addEventListener('transitionend', onEnd);
        // 兜底：transitionend 未触发时强制关闭
        window.setTimeout(finish, FLIP_DURATION + 60);
        return;
      }
    }

    onClose();
  };

  return (
    <div className="sc-modal-mask" ref={maskRef} onMouseDown={handleClose}>
      <div className="sc-modal sc-modal-detail" ref={modalRef} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sc-modal-header">
          <span className="sc-detail-title">
            <DetailLogo site={site} />
            <span>
              <span className="site-name">{site.name}</span>
              <span className="site-cat">{site.category || UNCATEGORIZED_LABEL}</span>
            </span>
          </span>
          <button type="button" className="sc-modal-close" onClick={handleClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="sc-modal-body">
          {site.tags.length > 0 && (
            <div className="site-tags sc-detail-tags">
              {site.tags.map((t) => (
                <span key={t} className="site-tag">
                  #{t}
                </span>
              ))}
            </div>
          )}

          <div className="sc-detail-url">
            <a href={site.url} target="_blank" rel="noopener noreferrer">
              {site.url}
            </a>
          </div>

          <div className="sc-detail-desc">
            <h3 className="sc-detail-desc-title">介绍</h3>
            <div className="sc-markdown">{renderMarkdown(site.description)}</div>
          </div>
        </div>

        <footer className="sc-modal-footer">
          <Button onClick={handleClose}>关闭</Button>
          <Button variant="primary" onClick={() => window.open(site.url, '_blank', 'noopener,noreferrer')}>
            进入网站
          </Button>
        </footer>
      </div>
    </div>
  );
}
