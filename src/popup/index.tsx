import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';
import { RpaMessageType } from '../shared/rpa-types';
import type { RpaMacro } from '../shared/rpa-types';
import { listScripts } from '../shared/rpa-storage';
import Button from '../components/Button';
import Select from '../components/Select';
import './index.css';

interface RpaResponse {
  success?: boolean;
  error?: string;
}

async function sendMessage(
  type: RpaMessageType,
  payload?: unknown,
): Promise<RpaResponse | undefined> {
  try {
    return (await chrome.runtime.sendMessage({ type, payload })) as RpaResponse;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function openPage(path: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

function PopupApp() {
  const [scripts, setScripts] = useState<RpaMacro[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listScripts().then((list) => {
      setScripts(list);
      if (list.length) setSelectedId(list[0].id);
    });
  }, []);

  const run = async (type: RpaMessageType, payload?: unknown) => {
    setBusy(true);
    setMsg('');
    const res = await sendMessage(type, payload);
    setBusy(false);
    if (res?.success === false) setMsg(res.error ?? '操作失败');
  };

  const runPlayback = () => {
    if (!selectedId) {
      setMsg('请先录制脚本');
      return;
    }
    void run(RpaMessageType.START_PLAYBACK, { macroId: selectedId });
  };

  return (
    <div className="popup">
      <div className="popup-row">
        <Select
          value={selectedId}
          options={scripts.map((s) => ({ value: s.id, label: s.name }))}
          onChange={setSelectedId}
          disabled={scripts.length === 0}
          placeholder="暂无脚本"
        />
        <Button variant="primary" disabled={busy || !selectedId} onClick={runPlayback}>
          回放
        </Button>
      </div>

      <div className="popup-actions">
        <Button variant="primary" disabled={busy} onClick={() => run(RpaMessageType.SHOW_BAR)}>
          显示悬浮条
        </Button>
        <Button onClick={() => openPage('index.html')}>
          打开工具集
        </Button>
      </div>

      {msg && <div className="popup-error">{msg}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<PopupApp />);
