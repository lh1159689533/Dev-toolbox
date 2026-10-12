import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useRef, useCallback } from 'react';

/**
 * 可等比例缩放的图片扩展。
 * 选中图片后四个角各显示一个缩放手柄，拖拽即可等比缩放（不变形），
 * 最终把宽度写回 width 属性（height 由浏览器按比例自动计算），
 * 提交到 TAPD 的 HTML 中体现。
 */

interface ResizableImageAttrs {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

function ResizeNodeView(props: any) {
  const { node, updateAttributes, selected } = props;
  const attrs = node.attrs as ResizableImageAttrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number; width: number; height: number; corner: Corner } | null>(null);

  const onDragStart = useCallback(
    (e: React.MouseEvent, corner: Corner) => {
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      // 以实际显示尺寸为基准，避免「初始被 CSS max-width 压缩导致拖半天无变化」
      const width = img.clientWidth;
      const height = img.clientHeight;
      if (!width || !height) return;
      startRef.current = { x: e.clientX, y: e.clientY, width, height, corner };

      const onMove = (ev: MouseEvent) => {
        if (!startRef.current) return;
        const dx = ev.clientX - startRef.current.x;
        const dy = ev.clientY - startRef.current.y;
        // 根据角落决定拖拽方向符号
        const signX = startRef.current.corner.endsWith('w') ? -1 : 1;
        const signY = startRef.current.corner.startsWith('n') ? -1 : 1;
        // 取横向/纵向中变化更大的作为缩放基准，保证任意方向拖拽都有明确反馈
        const scaleBase = Math.abs(dx) >= Math.abs(dy) ? dx * signX : dy * signY;
        const newWidth = Math.round(startRef.current.width + scaleBase);
        if (newWidth < 16) return;
        // 只更新 width，height 交给浏览器按比例计算
        updateAttributes({ width: newWidth });
      };

      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [updateAttributes],
  );

  return (
    <NodeViewWrapper className="resizable-image" data-selected={selected ? 'true' : 'false'}>
      <img
        ref={imgRef}
        src={attrs.src}
        alt={attrs.alt}
        title={attrs.title}
        width={attrs.width}
        draggable={false}
      />
      {selected &&
        CORNERS.map((corner) => (
          <span
            key={corner}
            className={`resize-handle resize-handle-${corner}`}
            title="拖拽等比缩放"
            onMouseDown={(e) => onDragStart(e, corner)}
          />
        ))}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: 'image',

  group: 'block',
  inline: false,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null, parseHTML: (el) => Number((el as HTMLElement).getAttribute('width')) || null },
      // height 仅作内部解析兼容（旧内容可能带 height），渲染 HTML 时不输出，
      // 提交的 <img> 只保留 width，高度由浏览器按原图比例自动计算
      height: {
        default: null,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute('height')) || null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addInputRules() {
    return [nodeInputRule({ find: /!\[(.+|:?)]\((\S+)(?:(?:\s+"[^"]*")?\s*)\)/, type: this.type, getAttributes: (match) => ({ src: match[2], alt: match[1] }) })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizeNodeView);
  },
});
