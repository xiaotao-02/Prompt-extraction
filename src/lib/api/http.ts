/**
 * 跨 provider 共用的 HTTP / SSE 工具。
 *
 * 三家 provider（OpenAI 兼容、Anthropic、Gemini）的 fetch 用法不一样，
 * 但响应处理上有大量公共需求：
 *   - 判断响应是 SSE 还是被中转节点改回 JSON 的兜底
 *   - 逐行拆 SSE 数据并 yield `data:` 后面的有效负载
 *   - 把 4xx/5xx 与"返回 HTML"这种迷惑场景翻译成可读错误
 *
 * 这些工具与具体 provider 协议无关，独立抽出来便于复用。
 */

/** 流式阶段两次进度回调之间的最小间隔（毫秒）。 */
export const STREAM_FLUSH_INTERVAL_MS = 80;

/** 响应是不是 text/event-stream（含带 charset 后缀的情况）。 */
export function isSseResponse(resp: Response): boolean {
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/event-stream');
}

/**
 * 把一个 SSE 响应体逐行拆出来，只 yield `data:` 后面的有效负载。
 *
 * 我们只关心 OpenAI / Anthropic / Gemini 三家用到的事件子集：
 * - `data: {...}`：负载本身
 * - `data: [DONE]`：OpenAI 流式终止哨兵（由调用方自己识别）
 * - `event:` / `id:` / `:` 注释行：直接忽略
 *
 * Chrome MV3 service worker 里 fetch 拿到的 ReadableStream 行为和
 * 普通页面一致，所以这里不需要做 backpressure 处理。
 */
export async function* readSseDataChunks(resp: Response): AsyncGenerator<string> {
  if (!resp.body) throw new Error('SSE 响应缺少 body');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line) continue;
        if (line.startsWith('data:')) {
          const data = line.slice(5).replace(/^ /, '');
          if (data) yield data;
        }
      }
    }
    const tail = buf.replace(/\r$/, '');
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).replace(/^ /, '');
      if (data) yield data;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '<no body>';
  }
}

/** 截断超长响应体，避免错误信息把 UI 撑爆。 */
export function truncate(s: string, max = 300): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(已截断, 共 ${s.length} 字符)`;
}

/** 简单判断响应体看起来像 HTML。 */
export function looksLikeHtml(s: string): boolean {
  const head = s.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml');
}

/**
 * 安全地把响应解析为 JSON。
 *
 * 即使 HTTP 200，也可能因为 baseUrl 写错、被 Cloudflare/登录页拦截等原因
 * 收到 HTML 响应，此时原生 `resp.json()` 会抛出
 * `Unexpected token '<', "<!doctype "... is not valid JSON`，
 * 用户根本看不出原因。这里统一捕获并转成可读错误。
 *
 * @param label 调用方名字，例如 "OpenAI"、"Claude"，用于错误前缀
 */
export async function parseJsonResponse<T = unknown>(
  resp: Response,
  label: string
): Promise<T> {
  const url = resp.url || '<unknown>';
  const ct = resp.headers.get('content-type') || '';
  const text = await safeText(resp);
  try {
    return JSON.parse(text) as T;
  } catch {
    if (looksLikeHtml(text) || ct.includes('text/html')) {
      throw new Error(
        `${label} 返回的是 HTML 页面而不是 JSON，请检查「baseUrl / 接口地址」是否填写正确。\n` +
          `常见原因：\n` +
          `  • 漏写 /v1（应为 https://api.openai.com/v1，而不是 https://api.openai.com）\n` +
          `  • 版本号大小写写错（应为小写 /v1，不是 /V1）\n` +
          `  • 把网站首页当成了 API 域名\n` +
          `URL: ${url}\nContent-Type: ${ct || '(空)'}\n响应预览: ${truncate(text)}`
      );
    }
    throw new Error(
      `${label} 返回内容无法解析为 JSON。\nURL: ${url}\nContent-Type: ${ct || '(空)'}\n响应预览: ${truncate(text)}`
    );
  }
}

/** 统一格式化 !resp.ok 时的错误信息，附带状态码、URL 和截断后的响应。 */
export async function describeRespFailure(
  resp: Response,
  label: string
): Promise<string> {
  const text = await safeText(resp);
  const url = resp.url || '<unknown>';
  const hint = looksLikeHtml(text)
    ? '（响应是 HTML，可能是 baseUrl 错误或被网关拦截）'
    : '';
  return `${label} 请求失败 ${resp.status} ${resp.statusText}${hint}\nURL: ${url}\n响应预览: ${truncate(text)}`;
}
