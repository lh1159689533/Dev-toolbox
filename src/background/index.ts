import type { ProxyRequest, ProxyResponsePayload } from '../api/proxy-types';
import { backgroundRpaService } from './rpa-background-service';
import { STORAGE_KEYS, storageGetMany } from '../shared/storage';

/** 允许 content script 访问 chrome.storage.session */
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

/** DevTools panel 长连接（广播无法路由到 devtools panel，需点对点推送） */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'rpa-devtools-panel') {
    backgroundRpaService.registerPanelPort(port);
  }
});

/** 从 chrome.storage.local 读取认证凭证 */
async function getTokens(): Promise<{ gitToken: string; tapdAuth: string }> {
  const data = await storageGetMany<string>([STORAGE_KEYS.gitToken, STORAGE_KEYS.tapdAuth]);
  return {
    gitToken: data[STORAGE_KEYS.gitToken] ?? '',
    tapdAuth: data[STORAGE_KEYS.tapdAuth] ?? '',
  };
}

/** 重建请求体：text 原样返回，form 还原为 FormData（含文件） */
function rebuildBody(body: ProxyRequest['body']): BodyInit | undefined {
  if (!body) return undefined;
  if (body.kind === 'text') return body.value;
  const fd = new FormData();
  for (const part of body.parts) {
    if (part.isFile) {
      const blob = new Blob([new Uint8Array(part.data ?? [])], {
        type: part.mimeType || 'application/octet-stream',
      });
      fd.append(part.name, blob, part.fileName);
    } else {
      fd.append(part.name, part.value);
    }
  }
  return fd;
}

async function handleProxyFetch(req: ProxyRequest): Promise<ProxyResponsePayload> {
  const { gitToken, tapdAuth } = await getTokens();
  const headers = new Headers(req.headers ?? {});
  const isGit = req.url.includes('git.woa.com');
  if (isGit && gitToken) headers.set('PRIVATE-TOKEN', gitToken);
  if (!isGit && tapdAuth) headers.set('Authorization', `Bearer ${tapdAuth}`);

  const init: RequestInit = { method: req.method || 'GET', headers };
  const body = rebuildBody(req.body);
  if (body !== undefined) init.body = body;

  const res = await fetch(req.url, init);
  const buf = new Uint8Array(await res.arrayBuffer());
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    body: Array.from(buf),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as ProxyRequest | { type: string; payload?: unknown };

  if (msg?.type === 'PROXY_FETCH') {
    handleProxyFetch(msg as ProxyRequest)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          body: [],
          error: e instanceof Error ? e.message : String(e),
        } satisfies ProxyResponsePayload),
      );
    return true; // 保持异步响应通道
  }

  // RPA 消息统一交给 background 服务处理
  backgroundRpaService
    .handleMessage(msg as { type: string; payload?: unknown }, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
