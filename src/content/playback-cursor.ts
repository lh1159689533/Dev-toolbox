/**
 * 回放模拟鼠标光标：在目标元素中心显示一个虚拟指针，
 * 支持从上一步位置做过渡移动动画，并在点击时播放涟漪反馈。
 * 纯视觉层（pointer-events:none），不影响事件派发。
 */
/** 光标 SVG：经典带尾巴的箭头指针（绿色主色填充 + 深绿描边），主光标与拖尾残影共用 */
const CURSOR_SVG = `
  <svg width="32" height="32" viewBox="0 0 24 24" style="display:block; filter: drop-shadow(-1px 2px 3px rgba(0,0,0,0.8));" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 1 L2 18.5 L6.8 14 L11 20 L13.3 18.4 L9.5 12.5 L15.8 11 Z" fill="oklch(0.45 0.07 160)" stroke="oklch(0.8 0.07 160)" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>
`;

export class PlaybackCursor {
  private container: HTMLElement | null = null;
  private rippleContainer: HTMLElement | null = null;
  private trailContainer: HTMLElement | null = null;
  /** 当前光标所在的视口坐标（作为下一步移动动画的起点） */
  private x: number | null = null;
  private y: number | null = null;
  /** 上一次生成拖尾残影的位置（用于距离节流，控制残影密度） */
  private lastTrailX: number | null = null;
  private lastTrailY: number | null = null;
  /** 拖尾残影之间的最小间距（px） */
  private static readonly TRAIL_SPACING = 12;

  /** 显示光标（首次调用时创建 DOM） */
  show(): void {
    if (!this.container) this.create();
    if (this.container) {
      this.container.style.display = 'block';
      this.container.style.opacity = '1';
    }
  }

  /** 隐藏光标 */
  hide(): void {
    if (this.container) {
      this.container.style.opacity = '0';
    }
  }

  /**
   * 移动到视口坐标 (x, y)。
   * @returns Promise，动画完成（或无需动画）时 resolve
   */
  moveTo(x: number, y: number, opts: { animate: boolean; duration: number }): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) this.create();
      const startX = this.x ?? x;
      const startY = this.y ?? y;

      if (!opts.animate || (startX === x && startY === y)) {
        this.setPosition(x, y);
        this.x = x;
        this.y = y;
        resolve();
        return;
      }

      const startTime = performance.now();
      // 重置拖尾残影起点，让每次移动都从起点开始留尾巴
      this.lastTrailX = startX;
      this.lastTrailY = startY;
      const tick = (now: number): void => {
        const t = Math.min(1, (now - startTime) / opts.duration);
        // easeInOutQuad 缓动，移动更自然
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const cx = startX + (x - startX) * eased;
        const cy = startY + (y - startY) * eased;
        this.setPosition(cx, cy);
        this.spawnTrail(cx, cy);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this.x = x;
          this.y = y;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /** 点击反馈：在 (x, y) 播放一个涟漪扩散动画 */
  tap(x: number, y: number): void {
    if (!this.rippleContainer) {
      this.rippleContainer = document.createElement('div');
      this.rippleContainer.style.cssText =
        'position:fixed; left:0; top:0; width:0; height:0; z-index:2147483646; pointer-events:none;';
      document.body.appendChild(this.rippleContainer);
    }

    const ripple = document.createElement('div');
    ripple.style.cssText = `
      position: fixed; left: ${x}px; top: ${y}px; width: 10px; height: 10px;
      margin-left: -5px; margin-top: -5px; border-radius: 50%;
      background: oklch(50% 0.07 160 / 0.45); pointer-events: none;
    `;
    this.rippleContainer.appendChild(ripple);

    const anim = ripple.animate(
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(4)', opacity: 0 },
      ],
      { duration: 400, easing: 'ease-out' },
    );
    anim.onfinish = () => ripple.remove();
  }

  /** 在 (x, y) 处生成一个淡出缩小的拖尾残影（按间距节流，控制残影数量） */
  private spawnTrail(x: number, y: number): void {
    if (this.lastTrailX !== null && this.lastTrailY !== null) {
      const dx = x - this.lastTrailX;
      const dy = y - this.lastTrailY;
      if (dx * dx + dy * dy < PlaybackCursor.TRAIL_SPACING * PlaybackCursor.TRAIL_SPACING) {
        return;
      }
    }
    this.lastTrailX = x;
    this.lastTrailY = y;

    if (!this.trailContainer) {
      this.trailContainer = document.createElement('div');
      this.trailContainer.style.cssText =
        'position:fixed; left:0; top:0; width:0; height:0; z-index:2147483646; pointer-events:none;';
      document.body.appendChild(this.trailContainer);
    }

    const ghost = document.createElement('div');
    ghost.style.cssText = `position:fixed; left:${x}px; top:${y}px; width:32px; height:32px; pointer-events:none;`;
    ghost.innerHTML = CURSOR_SVG;
    this.trailContainer.appendChild(ghost);

    const anim = ghost.animate(
      [
        { opacity: 0.4, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.8)' },
      ],
      { duration: 400, easing: 'ease-out' },
    );
    anim.onfinish = () => ghost.remove();
  }

  private setPosition(x: number, y: number): void {
    if (this.container) {
      this.container.style.left = x + 'px';
      this.container.style.top = y + 'px';
    }
  }

  /** 创建光标 DOM（经典带尾巴箭头指针，深浅背景下都可见） */
  private create(): void {
    this.container = document.createElement('div');
    this.container.id = '__rpa-playback-cursor';
    this.container.style.cssText = `
      position: fixed; left: -100px; top: -100px; z-index: 2147483647;
      width: 32px; height: 32px; pointer-events: none; user-select: none;
      transition: opacity 0.2s ease; opacity: 1;
    `;
    this.container.innerHTML = CURSOR_SVG;
    document.body.appendChild(this.container);
  }
}
