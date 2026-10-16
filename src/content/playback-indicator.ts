import { RpaMessageType, RpaRunStatus } from '../shared/rpa-types';
import type { RpaPlaybackProgressPayload } from '../shared/rpa-types';

/** 回放进度指示器：状态主题 + 进度条 + 当前事件（对齐 rocket-agent-plugin PlaybackIndicator） */
export class PlaybackIndicator {
  private container: HTMLElement | null = null;
  private styleEl: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private statusIcon: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private stepText: HTMLElement | null = null;
  private commandText: HTMLElement | null = null;
  private resumeBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private currentStatus: RpaRunStatus = RpaRunStatus.Idle;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  /** 更新进度（自动创建/显示/隐藏指示器） */
  update(payload: RpaPlaybackProgressPayload): void {
    const { status, currentIndex, totalCommands, commandName, commandTarget, macroName, error } = payload;

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    if (!this.container) {
      this.create();
    }

    const step = Math.min(currentIndex + 1, totalCommands);
    const percent = totalCommands > 0 ? (step / totalCommands) * 100 : 0;

    const themes: Record<string, { bg: string; icon: string; label: string; anim: string }> = {
      [RpaRunStatus.Running]: {
        bg: 'rgba(0, 82, 217, 0.82)',
        icon: '▶',
        label: `${macroName} 回放中`,
        anim: '__rpa-playback-pulse 1.5s ease-in-out infinite',
      },
      [RpaRunStatus.Paused]: {
        bg: 'rgba(237, 123, 47, 0.92)',
        icon: '⏸',
        label: `${macroName} 已暂停`,
        anim: '__rpa-playback-blink 1s ease-in-out infinite',
      },
      [RpaRunStatus.Completed]: {
        bg: 'rgba(43, 164, 113, 0.92)',
        icon: '✓',
        label: `${macroName} 回放完成`,
        anim: 'none',
      },
      [RpaRunStatus.Error]: {
        bg: 'rgba(213, 73, 65, 0.92)',
        icon: '',
        label: `${macroName} 回放失败`,
        anim: 'none',
      },
      [RpaRunStatus.Stopped]: {
        bg: 'rgba(120, 120, 128, 0.92)',
        icon: '■',
        label: `${macroName} 已停止`,
        anim: 'none',
      },
    };

    const theme = themes[status] || themes[RpaRunStatus.Running];

    this.currentStatus = status;
    // 仅暂停（点击继续）与错误（手动关闭）两种状态需要交互，其余不拦截页面事件
    const interactive = status === RpaRunStatus.Paused || status === RpaRunStatus.Error;
    if (this.container) {
      this.container.style.background = theme.bg;
      this.container.style.animation = theme.anim;
      this.container.style.pointerEvents = interactive ? 'auto' : 'none';
      this.container.style.cursor = status === RpaRunStatus.Paused ? 'pointer' : 'default';
    }

    if (this.resumeBtn) {
      this.resumeBtn.style.display = status === RpaRunStatus.Paused ? 'block' : 'none';
    }
    if (this.closeBtn) {
      this.closeBtn.style.display = status === RpaRunStatus.Error ? 'block' : 'none';
    }

    if (this.statusIcon) {
      this.statusIcon.textContent = theme.icon;
    }

    if (this.statusText) {
      this.statusText.textContent = theme.label;
    }

    if (this.stepText) {
      this.stepText.textContent = `${step} / ${totalCommands}`;
    }

    if (this.progressBar) {
      this.progressBar.style.width = `${percent}%`;
      this.progressBar.style.background = status === RpaRunStatus.Error ? '#ff6b6b' : '#fff';
    }

    if (this.commandText) {
      if (status === RpaRunStatus.Error && error) {
        this.commandText.textContent = error.length > 60 ? error.slice(0, 60) + '…' : error;
        this.commandText.style.color = '#ffcdd2';
      } else if (commandName) {
        const targetShort = commandTarget.length > 40 ? commandTarget.slice(0, 40) + '…' : commandTarget;
        this.commandText.textContent = `${commandName}  ${targetShort}`;
        this.commandText.style.color = 'rgba(255,255,255,0.7)';
      } else {
        this.commandText.textContent = '';
      }
    }

    if (status === RpaRunStatus.Completed || status === RpaRunStatus.Stopped) {
      this.autoHideTimer = setTimeout(() => this.hide(), 2500);
    }
    if (status === RpaRunStatus.Idle) {
      this.hide();
    }
  }

  /** 隐藏指示器 */
  hide(): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    if (this.container) {
      this.container.style.transition = 'opacity 0.3s ease';
      this.container.style.opacity = '0';
      setTimeout(() => {
        this.container?.remove();
        this.container = null;
        this.styleEl?.remove();
        this.styleEl = null;
        this.progressBar = null;
        this.statusIcon = null;
        this.statusText = null;
        this.stepText = null;
        this.commandText = null;
        this.resumeBtn = null;
        this.closeBtn = null;
        this.currentStatus = RpaRunStatus.Idle;
      }, 350);
    }
  }

  /** 创建指示器 DOM */
  private create(): void {
    this.styleEl = document.createElement('style');
    this.styleEl.id = '__rpa-playback-style';
    this.styleEl.textContent = `
      @keyframes __rpa-playback-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.85; }
      }
      @keyframes __rpa-playback-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      @keyframes __rpa-playback-slidein {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(this.styleEl);

    this.container = document.createElement('div');
    this.container.id = '__rpa-playback-indicator';
    this.container.style.cssText = `
      position: fixed; bottom: 8px; right: 8px; z-index: 2147483647;
      min-width: 220px; max-width: 340px;
      background: rgba(0, 82, 217, 0.82); color: #fff;
      padding: 8px 14px; border-radius: 10px;
      font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      pointer-events: none; user-select: none;
      animation: __rpa-playback-slidein 0.25s ease-out;
      line-height: 1.4;
    `;

    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';

    this.statusIcon = document.createElement('span');
    this.statusIcon.style.cssText = 'font-size:14px; flex-shrink:0;';
    this.statusIcon.textContent = '▶';

    this.statusText = document.createElement('span');
    this.statusText.style.cssText =
      'flex:1; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

    this.stepText = document.createElement('span');
    this.stepText.style.cssText = 'font-size:12px; opacity:0.85; flex-shrink:0; font-variant-numeric:tabular-nums;';

    row1.appendChild(this.statusIcon);
    row1.appendChild(this.statusText);
    row1.appendChild(this.stepText);

    // 暂停时的「继续」按钮
    this.resumeBtn = document.createElement('button');
    this.resumeBtn.type = 'button';
    this.resumeBtn.textContent = '继续';
    this.resumeBtn.style.cssText = `
      display:none; border:1px solid rgba(255,255,255,0.85); background:transparent;
      color:#fff; cursor:pointer; font-size:12px; padding:2px 8px; border-radius:6px;
      line-height:1; flex-shrink:0;
    `;
    this.resumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void chrome.runtime.sendMessage({ type: RpaMessageType.RESUME_PLAYBACK }).catch(() => {});
    });
    row1.appendChild(this.resumeBtn);

    // 错误时的「关闭」按钮
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.setAttribute('aria-label', '关闭');
    this.closeBtn.textContent = '×';
    this.closeBtn.style.cssText = `
      display:none; border:none; background:transparent; cursor:pointer;
      padding:0 2px; font-size:18px; line-height:1; color:inherit; opacity:0.8; 
      flex-shrink:0;margin-top:-3px;margin-right:-8px;
    `;
    this.closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    row1.appendChild(this.closeBtn);

    this.container.appendChild(row1);

    const progressTrack = document.createElement('div');
    progressTrack.style.cssText = `
      height: 3px; background: rgba(255,255,255,0.25); border-radius: 2px;
      overflow: hidden; margin-bottom: 4px;
    `;
    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = `
      height: 100%; width: 0%; background: #fff; border-radius: 2px;
      transition: width 0.3s ease;
    `;
    progressTrack.appendChild(this.progressBar);
    this.container.appendChild(progressTrack);

    this.commandText = document.createElement('div');
    this.commandText.style.cssText = `
      font-size: 11px; color: rgba(255,255,255,0.7);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: 'SF Mono', Menlo, Consolas, monospace;
      min-height: 15px;
    `;
    this.container.appendChild(this.commandText);

    // 暂停时点击整条提示即继续回放（与「继续」按钮等效）
    this.container.addEventListener('click', () => {
      if (this.currentStatus === RpaRunStatus.Paused) {
        void chrome.runtime.sendMessage({ type: RpaMessageType.RESUME_PLAYBACK }).catch(() => {});
      }
    });

    document.body.appendChild(this.container);
  }
}
