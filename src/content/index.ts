import { RpaRecorder } from './recorder';
import { RpaCommandExecutor } from './executor';
import { RpaElementPicker } from './element-picker';
import { PlaybackIndicator } from './playback-indicator';
import { PageToast } from './page-toast';
import { FloatingBar, isBarOpenForCurrentOrigin } from './floating-bar';
import { RpaMessageType, RpaRecordingStatus } from '../shared/rpa-types';
import type { RpaPageToastPayload, RpaPlaybackProgressPayload } from '../shared/rpa-types';

const recorder = new RpaRecorder();
const executor = new RpaCommandExecutor();
const picker = new RpaElementPicker();
const playbackIndicator = new PlaybackIndicator();
const pageToast = new PageToast();

const bar = new FloatingBar({
  onStart: () => {
    // 通知 background 开始录制（background 记录状态后回发本 tab 启动录制器）
    void chrome.runtime.sendMessage({ type: RpaMessageType.START_RECORDING }).catch(() => {});
  },
  onStop: () => {
    void chrome.runtime.sendMessage({ type: RpaMessageType.STOP_RECORDING }).catch(() => {});
  },
  onClose: () => {
    void chrome.runtime.sendMessage({ type: RpaMessageType.STOP_RECORDING }).catch(() => {});
  },
  onPick: () => {
    picker.start();
  },
});
bar.mount();

// 录制器每捕获一个事件，实时刷新悬浮条上的事件计数
recorder.onEventCounted = (count) => {
  bar.setState('recording', `${count} 事件`);
};

// 页面加载时若正在录制（且与起始页同域），自动续录——支持点击新开 tab 后继续录制
void chrome.runtime
  .sendMessage({ type: RpaMessageType.GET_RECORDING_STATUS })
  .then((resp) => {
    const data = (
      resp as {
        success?: boolean;
        data?: { status?: string; eventCount?: number; recordingOrigin?: string };
      }
    )?.data;
    if (
      data?.status === RpaRecordingStatus.Recording &&
      data.recordingOrigin &&
      window.location.origin === data.recordingOrigin
    ) {
      // 续录时同步全局已录事件数，保持悬浮条计数与实际一致
      const baseCount = data.eventCount ?? 0;
      recorder.start(baseCount);
      bar.show();
      bar.setState('recording', `${baseCount} 事件`);
    }
  })
  .catch(() => {
    // background 不可用，忽略
  });

// 常驻显示：当前域名若曾打开过悬浮条（且未关闭），自动显示
void isBarOpenForCurrentOrigin().then((open) => {
  if (open) bar.show();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case RpaMessageType.START_RECORDING:
      recorder.start();
      bar.show();
      bar.setState('recording', '0 事件');
      sendResponse({ success: true });
      break;

    case RpaMessageType.STOP_RECORDING:
      recorder.stop();
      bar.setState('idle');
      sendResponse({ success: true });
      break;

    case RpaMessageType.EXECUTE_COMMAND: {
      const { command, target, value, timeout } = message.payload as {
        command: string;
        target: string;
        value: string;
        timeout?: number;
      };
      executor.execute(command, target, value, timeout).then((result) => sendResponse(result));
      return true; // 异步响应
    }

    case RpaMessageType.PLAYBACK_PROGRESS:
      playbackIndicator.update(message.payload as RpaPlaybackProgressPayload);
      break;

    case RpaMessageType.SHOW_PAGE_TOAST: {
      const toastPayload = message.payload as RpaPageToastPayload;
      pageToast.show(toastPayload.text, toastPayload.kind);
      break;
    }

    case RpaMessageType.START_ELEMENT_PICKER:
      picker.start();
      sendResponse({ success: true });
      break;

    case RpaMessageType.STOP_ELEMENT_PICKER:
      picker.stop();
      sendResponse({ success: true });
      break;

    case RpaMessageType.GET_RECORDING_STATUS:
      sendResponse({
        success: true,
        data: { recording: recorder.recording, eventCount: recorder.count },
      });
      break;

    case RpaMessageType.SHOW_BAR:
      bar.show();
      sendResponse({ success: true });
      break;

    case RpaMessageType.HIDE_BAR:
      bar.hide();
      sendResponse({ success: true });
      break;

    default:
      return false;
  }
  return false;
});
