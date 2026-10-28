import { useLayoutEffect, useRef, type RefObject } from 'react';

const NO_ITEMS: readonly unknown[] = [];

export interface ScrollRevealOptions {
  /** 是否启用 */
  enabled: boolean;
  /** 每列错开步长（ms），单列布局下无效 */
  staggerStep?: number;
  /** 错开的最大步数（列数封顶，避免列表很长时末尾等待过久） */
  maxStagger?: number;
  /** 卡片集合（如 filtered），引用变化时重新同步动画 */
  items?: readonly unknown[];
  /** 初始隐藏 class（默认 reveal-item） */
  itemClassName?: string;
  /** 进入播放 class（默认 reveal-in） */
  inClassName?: string;
  /** 触发方向：'both' 双向都播动画；'down' 仅向下滚动播动画，向上滚动直接显示 */
  direction?: 'both' | 'down';
}

/** 读取 grid 容器实际列数（auto-fill 会由 computed style 展开为具体 track） */
function columnCount(container: HTMLElement): number {
  const tracks = getComputedStyle(container).gridTemplateColumns.split(' ').filter(Boolean);
  return tracks.length > 0 ? tracks.length : 1;
}

/**
 * 给容器内直接子卡片加“滚动入场动画”（参考 GSAP ScrollTrigger fade-up / slide-in + stagger）。
 * 纯 IntersectionObserver + CSS animation 实现，无第三方依赖。
 * 卡片进入视口播放入场动画，滚出视口后复位，再次滚入会重新播放。
 * 通过 itemClassName / inClassName 可复用不同的动画变体；
 * direction='down' 时仅向下滚动触发动画，向上滚动卡片直接显示。
 */
export function useScrollReveal<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  {
    enabled,
    staggerStep = 60,
    maxStagger = 6,
    items = NO_ITEMS,
    itemClassName = 'reveal-item',
    inClassName = 'reveal-in',
    direction = 'both',
  }: ScrollRevealOptions,
) {
  const optsRef = useRef({ staggerStep, maxStagger });
  optsRef.current = { staggerStep, maxStagger };
  const scrollDirRef = useRef<'down' | 'up'>('down');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;
    // 系统开启“减少动态效果”时直接跳过，卡片保持默认可见
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // 仅向下触发时，监听滚动方向
    let lastY = window.scrollY;
    let onScroll: (() => void) | undefined;
    if (direction === 'down') {
      onScroll = () => {
        const y = window.scrollY;
        if (y > lastY) scrollDirRef.current = 'down';
        else if (y < lastY) scrollDirRef.current = 'up';
        lastY = y;
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    const indexMap = new Map<Element, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        const { staggerStep, maxStagger } = optsRef.current;
        const cols = Math.max(1, Math.min(columnCount(container), maxStagger));
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const index = indexMap.get(el) ?? 0;
          if (entry.isIntersecting) {
            const play = direction === 'both' || scrollDirRef.current === 'down';
            if (play) {
              el.style.animationDelay = `${(index % cols) * staggerStep}ms`;
              el.style.animationDuration = '';
            } else {
              // 向上滚动：直接显示，不播动画
              el.style.animationDelay = '0ms';
              el.style.animationDuration = '0s';
            }
            el.classList.add(inClassName);
          } else {
            el.style.animationDelay = '';
            el.style.animationDuration = '';
            el.classList.remove(inClassName);
          }
        }
      },
      { threshold: 0 },
    );

    Array.from(container.children).forEach((child, i) => {
      indexMap.set(child, i);
      if (!child.classList.contains(itemClassName)) child.classList.add(itemClassName);
      observer.observe(child);
    });

    return () => {
      observer.disconnect();
      if (onScroll) window.removeEventListener('scroll', onScroll);
      Array.from(container.children).forEach((child) => {
        child.classList.remove(itemClassName, inClassName);
        const el = child as HTMLElement;
        el.style.animationDelay = '';
        el.style.animationDuration = '';
      });
    };
  }, [enabled, containerRef, items, itemClassName, inClassName, direction]);
}
