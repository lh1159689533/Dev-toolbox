/** 表单字段（用于 FormData 跨进程序列化） */
export interface FormPart {
  name: string;
  value: string;
  isFile: boolean;
  fileName?: string;
  mimeType?: string;
  data?: number[];
}

export type ProxyBody = { kind: 'text'; value: string } | { kind: 'form'; parts: FormPart[] };

/** 页面 → 后台脚本的请求消息 */
export interface ProxyRequest {
  type: 'PROXY_FETCH';
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: ProxyBody;
}

/** 后台脚本 → 页面的响应消息 */
export interface ProxyResponsePayload {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: number[];
  error?: string;
}
