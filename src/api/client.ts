import type { FormPart, ProxyBody, ProxyRequest, ProxyResponsePayload } from './proxy-types';

/** 将请求体序列化为可跨进程传递的结构（File 读为字节数组） */
async function serializeBody(body: BodyInit | null | undefined): Promise<ProxyBody | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return { kind: 'text', value: body };
  if (body instanceof URLSearchParams) return { kind: 'text', value: body.toString() };
  if (body instanceof FormData) {
    const parts: FormPart[] = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === 'string') {
        parts.push({ name, value, isFile: false });
      } else {
        const buf = new Uint8Array(await value.arrayBuffer());
        parts.push({
          name,
          value: '',
          isFile: true,
          fileName: value.name,
          mimeType: value.type,
          data: Array.from(buf),
        });
      }
    }
    return { kind: 'form', parts };
  }
  return { kind: 'text', value: JSON.stringify(body) };
}

/**
 * 通过后台脚本代理发起请求：后台脚本注入认证头并转发，返回标准 Response。
 * 用于替代原先依赖 Vite proxy 的 `/git-api`、`/tapd-api` 相对路径请求。
 */
export async function proxyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { signal, body, method, headers: optHeaders } = options;

  const headers: Record<string, string> = {};
  new Headers(optHeaders).forEach((value, key) => {
    headers[key] = value;
  });

  const payload: ProxyRequest = {
    type: 'PROXY_FETCH',
    url,
    method: method || 'GET',
    headers,
    body: await serializeBody(body),
  };

  const res = (await chrome.runtime.sendMessage(payload)) as ProxyResponsePayload;
  // 后台请求无法真正取消，仅在客户端丢弃已过期的响应，保留 AbortController 语义
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  if (!res || res.error) {
    throw new Error(res?.error || '请求失败');
  }
  return new Response(new Uint8Array(res.body), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
