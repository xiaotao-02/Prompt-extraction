import type { AppSettings, OutputStyle, ProviderConfig, ProviderId } from '../types';
import { STYLE_PROMPTS } from '../storage';
import { fetchImageAsBase64 } from '../image';

export interface ExtractParams {
  imageUrl: string;
  settings: AppSettings;
}

export interface ExtractResult {
  prompt: string;
  provider: ProviderId;
  model: string;
  style: OutputStyle;
}

function buildInstruction(settings: AppSettings): string {
  const base = STYLE_PROMPTS[settings.outputStyle] ?? STYLE_PROMPTS['natural-zh'];
  const custom = settings.customPromptTemplate.trim();
  if (!custom) return base;
  return `${base}\n\n额外要求：${custom}`;
}

export async function extractPrompt(params: ExtractParams): Promise<ExtractResult> {
  const { imageUrl, settings } = params;
  const providerId = settings.activeProvider;
  const cfg = settings.providers[providerId];
  if (!cfg.apiKey) {
    throw new Error(`请先在「设置」中为 ${providerId} 配置 API Key`);
  }
  const instruction = buildInstruction(settings);

  let prompt: string;
  switch (providerId) {
    case 'anthropic':
      prompt = await callAnthropic(cfg, imageUrl, instruction);
      break;
    case 'gemini':
      prompt = await callGemini(cfg, imageUrl, instruction);
      break;
    case 'openai':
    case 'zhipu':
    case 'qwen':
    case 'siliconflow':
    case 'custom':
    default:
      prompt = await callOpenAICompatible(cfg, imageUrl, instruction);
      break;
  }

  return {
    prompt: prompt.trim(),
    provider: providerId,
    model: cfg.model,
    style: settings.outputStyle,
  };
}

// ============ OpenAI 兼容协议（OpenAI / 智谱 / 通义 / SiliconFlow / 自定义） ============
async function callOpenAICompatible(
  cfg: ProviderConfig,
  imageUrl: string,
  instruction: string
): Promise<string> {
  // 大部分兼容 OpenAI 的服务端都接受 url 形式的 image_url，
  // 但跨域 + 鉴权 + base64 更稳妥，这里统一转 base64。
  const img = await fetchImageAsBase64(imageUrl);
  const url = `${normalizeOpenAIBase(cfg.baseUrl)}/chat/completions`;

  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          {
            type: 'image_url',
            image_url: { url: img.dataUrl },
          },
        ],
      },
    ],
    temperature: 0.4,
    max_tokens: 1024,
    stream: false,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'API'));
  }
  const json = await parseJsonResponse<{
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  }>(resp, 'API');
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: { type?: string; text?: string }) =>
        c?.type === 'text' && c?.text ? c.text : ''
      )
      .join('');
  }
  throw new Error('返回内容为空，请检查模型是否支持视觉输入');
}

// ============ Anthropic Claude ============
async function callAnthropic(
  cfg: ProviderConfig,
  imageUrl: string,
  instruction: string
): Promise<string> {
  const img = await fetchImageAsBase64(imageUrl);
  const url = `${trimSlash(cfg.baseUrl)}/messages`;
  const body = {
    model: cfg.model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType,
              data: img.base64,
            },
          },
          { type: 'text', text: instruction },
        ],
      },
    ],
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Claude'));
  }
  const json = await parseJsonResponse<{ content?: Array<{ type?: string; text?: string }> }>(
    resp,
    'Claude'
  );
  const parts = json?.content;
  if (!Array.isArray(parts)) throw new Error('Claude 返回内容异常');
  return parts
    .filter((p: { type?: string }) => p?.type === 'text')
    .map((p: { text?: string }) => p.text || '')
    .join('');
}

// ============ Google Gemini ============
async function callGemini(
  cfg: ProviderConfig,
  imageUrl: string,
  instruction: string
): Promise<string> {
  const img = await fetchImageAsBase64(imageUrl);
  const url = `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
    cfg.model
  )}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: instruction },
          {
            inline_data: {
              mime_type: img.mediaType,
              data: img.base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Gemini'));
  }
  const json = await parseJsonResponse<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(resp, 'Gemini');
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error('Gemini 返回内容异常');
  return parts.map((p: { text?: string }) => p.text || '').join('');
}

// ============ 提示词文本重写（refine） ============

export interface RefineParams {
  settings: AppSettings;
  current: string;
  instruction: string;
}

export interface RefineResult {
  prompt: string;
  provider: ProviderId;
  model: string;
}

const REFINE_SYSTEM_PROMPT = (styleHint: string) =>
  `你是 AI 绘图提示词的资深编辑助手。用户会给你一段已有的提示词，以及他希望对其进行的调整。请输出修改后的【完整】提示词。规则：
- 严格遵循用户的"修改要求"，做到"只改要改的，不动不该动的"。
- 保持目标输出风格：${styleHint || '与原提示词相同的语言和风格'}
- 直接输出最终提示词正文，不要任何前缀、解释、引号或 Markdown 标题。
- 不要输出"当前提示词："或"修改后："这种标签。
- 如果用户要求语言切换（中→英 / 英→中），整段统一翻译。
- 如果用户的修改要求语义不清，按你最合理的解读处理，不要反问。`;

const REFINE_USER_PROMPT = (current: string, instruction: string) =>
  `【当前提示词】\n${current}\n\n【修改要求】\n${instruction}`;

export async function refinePrompt(params: RefineParams): Promise<RefineResult> {
  const { settings, current, instruction } = params;
  const providerId = settings.activeProvider;
  const cfg = settings.providers[providerId];
  if (!cfg.apiKey) {
    throw new Error(`请先在「设置」中为 ${providerId} 配置 API Key`);
  }
  const styleHint = STYLE_PROMPTS[settings.outputStyle] || '';
  const system = REFINE_SYSTEM_PROMPT(styleHint);
  const user = REFINE_USER_PROMPT(current, instruction);

  let prompt: string;
  switch (providerId) {
    case 'anthropic':
      prompt = await callAnthropicText(cfg, system, user);
      break;
    case 'gemini':
      prompt = await callGeminiText(cfg, system, user);
      break;
    case 'openai':
    case 'zhipu':
    case 'qwen':
    case 'siliconflow':
    case 'custom':
    default:
      prompt = await callOpenAICompatibleText(cfg, system, user);
      break;
  }

  return {
    prompt: cleanRefined(prompt),
    provider: providerId,
    model: cfg.model,
  };
}

function cleanRefined(s: string): string {
  let t = s.trim();
  // 去掉首尾的 ``` 代码块包裹
  t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  // 去掉常见前缀
  t = t.replace(/^(修改后|新提示词|结果|输出)[:：]\s*/i, '');
  // 去掉首尾成对引号
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

async function callOpenAICompatibleText(
  cfg: ProviderConfig,
  system: string,
  user: string
): Promise<string> {
  const url = `${normalizeOpenAIBase(cfg.baseUrl)}/chat/completions`;
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 1024,
    stream: false,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'API'));
  }
  const json = await parseJsonResponse<{
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  }>(resp, 'API');
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: { type?: string; text?: string }) =>
        c?.type === 'text' && c?.text ? c.text : ''
      )
      .join('');
  }
  throw new Error('返回内容为空');
}

async function callAnthropicText(
  cfg: ProviderConfig,
  system: string,
  user: string
): Promise<string> {
  const url = `${trimSlash(cfg.baseUrl)}/messages`;
  const body = {
    model: cfg.model,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Claude'));
  }
  const json = await parseJsonResponse<{ content?: Array<{ type?: string; text?: string }> }>(
    resp,
    'Claude'
  );
  const parts = json?.content;
  if (!Array.isArray(parts)) throw new Error('Claude 返回内容异常');
  return parts
    .filter((p: { type?: string }) => p?.type === 'text')
    .map((p: { text?: string }) => p.text || '')
    .join('');
}

async function callGeminiText(
  cfg: ProviderConfig,
  system: string,
  user: string
): Promise<string> {
  const url = `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
    cfg.model
  )}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Gemini'));
  }
  const json = await parseJsonResponse<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(resp, 'Gemini');
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error('Gemini 返回内容异常');
  return parts.map((p: { text?: string }) => p.text || '').join('');
}

// ============ 拉取模型列表 ============
//
// 大多数中转/官方端点都暴露了 `GET /models` 接口，用来枚举该 Key 下可用的模型 id。
// 这里按 provider 类型走对应的协议；返回去重 + 排序后的字符串数组。

export async function listModels(
  cfg: ProviderConfig,
  providerId: ProviderId
): Promise<string[]> {
  if (!cfg.baseUrl) throw new Error('请先填写 Base URL');

  if (providerId === 'gemini') {
    if (!cfg.apiKey) throw new Error('请先填写 API Key');
    const url = `${trimSlash(cfg.baseUrl)}/models?key=${encodeURIComponent(cfg.apiKey)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(await describeRespFailure(resp, 'Gemini'));
    const json = await parseJsonResponse<{
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    }>(resp, 'Gemini');
    const list = (json.models ?? [])
      .filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m) => (m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    return uniqSorted(list);
  }

  // Anthropic + 所有 OpenAI 兼容端点（含中转站）。
  // OpenAI 兼容协议走 normalizeOpenAIBase，与 chat/completions 走相同的归一化，
  // 避免「拉模型列表能成功，但发请求失败」或反过来这种割裂体验。
  const baseUrl =
    providerId === 'anthropic' ? trimSlash(cfg.baseUrl) : normalizeOpenAIBase(cfg.baseUrl);
  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = {};
  if (providerId === 'anthropic') {
    if (!cfg.apiKey) throw new Error('请先填写 API Key');
    headers['x-api-key'] = cfg.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(await describeRespFailure(resp, '模型列表'));

  const json = await parseJsonResponse<{
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  }>(resp, '模型列表');

  const arr = json.data ?? json.models ?? [];
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('端点返回了空模型列表，请确认 baseUrl 与 API Key 是否正确');
  }
  const list = arr.map((m) => m.id || m.name || '').filter(Boolean);
  return uniqSorted(list);
}

function uniqSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

/**
 * 去掉末尾的 `/`，并修正常见的「版本号大写」拼写错误。
 *
 * 用户经常按文档抄成 `/V1`、`/V2`、`/V1beta` 等大写版本号，
 * 但几乎所有 API 服务端的路由都是小写。这里只针对 `/V<digit>` 这一段做小写化，
 * 不会改动其它 path（避免破坏区分大小写的租户名 / 项目 ID 等）。
 *
 * 例如：
 *   `https://ai.shukelongda.cn/V1`   → `https://ai.shukelongda.cn/v1`
 *   `https://example.com/Tenant/V1/` → `https://example.com/Tenant/v1`
 */
function trimSlash(s: string): string {
  return s.replace(/\/+$/, '').replace(/\/V(\d+)/g, '/v$1');
}

/**
 * 把 OpenAI 兼容协议的 baseUrl 归一化。
 *
 * 用户很容易把 baseUrl 填成裸域名（例如 `https://ai.shukelongda.cn`），
 * 然后请求被拼成 `https://ai.shukelongda.cn/chat/completions`，
 * 被前端网关当作普通网页请求并返回 HTML 首页，最终导致
 * `Unexpected token '<'` 这种让人摸不着头脑的错误。
 *
 * 这里在拼接前做两件事：
 * 1. 通过 `trimSlash` 修掉末尾斜杠并把大写 `/V1` 改成 `/v1`；
 * 2. 如果 baseUrl 没有任何路径段（只有 origin），自动补一个 `/v1`
 *    ——这对几乎所有 OpenAI 兼容服务都成立。
 *
 * 对已经带路径的 baseUrl（如 `…/v1`、`…/api/paas/v4`、`…/compatible-mode/v1`）
 * 不再额外补 `/v1`，保持向后兼容。
 */
function normalizeOpenAIBase(raw: string): string {
  const trimmed = trimSlash((raw || '').trim());
  try {
    const u = new URL(trimmed);
    if (u.pathname === '' || u.pathname === '/') {
      return `${u.origin}/v1`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '<no body>';
  }
}

/** 截断超长响应体，避免错误信息把 UI 撑爆。 */
function truncate(s: string, max = 300): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(已截断, 共 ${s.length} 字符)`;
}

/** 简单判断响应体看起来像 HTML。 */
function looksLikeHtml(s: string): boolean {
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
 * @param label  调用方名字，例如 "OpenAI"、"Claude"，用于错误前缀
 */
async function parseJsonResponse<T = unknown>(resp: Response, label: string): Promise<T> {
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
async function describeRespFailure(resp: Response, label: string): Promise<string> {
  const text = await safeText(resp);
  const url = resp.url || '<unknown>';
  const hint = looksLikeHtml(text)
    ? '（响应是 HTML，可能是 baseUrl 错误或被网关拦截）'
    : '';
  return `${label} 请求失败 ${resp.status} ${resp.statusText}${hint}\nURL: ${url}\n响应预览: ${truncate(text)}`;
}
