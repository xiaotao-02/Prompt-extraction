import type { AppSettings, ExtractStage, OutputStyle, ProviderConfig, ProviderId } from '../types';
import { getStrategy, type PromptStrategy } from '../strategies';
import { fetchImageAsBase64, type FetchedImage } from '../image';

/**
 * 反推过程中的进度事件。stage 表示当前阶段，partial 表示流式阶段已经
 * 累积到的提示词文本（每一条都是"到目前为止的全文"，不是 delta）。
 */
export interface ExtractProgressEvent {
  stage: ExtractStage;
  partial?: string;
}

export interface ExtractParams {
  imageUrl: string;
  settings: AppSettings;
  /**
   * 调用方提前下载/规整好的图片。如果传了，extractPrompt 会跳过内部的
   * {@link fetchImageAsBase64}，直接用这份预处理结果——用来在 background
   * 里把图片下载和 settings 读取、content script 注入并行起来，节省一次
   * 串行等待。
   */
  prefetched?: FetchedImage;
  /**
   * 反推进度回调。流式阶段会被节流到约 80ms 一次，避免给 content script
   * 发太多 chrome.tabs.sendMessage。回调里抛错不影响主流程。
   */
  onProgress?: (ev: ExtractProgressEvent) => void;
}

export interface ExtractResult {
  prompt: string;
  provider: ProviderId;
  model: string;
  style: OutputStyle;
}

/** 流式阶段两次进度回调之间的最小间隔（毫秒）。 */
const STREAM_FLUSH_INTERVAL_MS = 80;

function safeProgress(
  onProgress: ExtractParams['onProgress'],
  ev: ExtractProgressEvent
): void {
  if (!onProgress) return;
  try {
    onProgress(ev);
  } catch (err) {
    console.debug('[PromptExtracto] onProgress threw', err);
  }
}

function buildInstruction(settings: AppSettings, strategy: PromptStrategy): string {
  const base = strategy.stylePrompts[settings.outputStyle] ?? strategy.stylePrompts['natural-zh'];
  const custom = settings.customPromptTemplate.trim();
  if (!custom) return base;
  // 拼接位置由策略决定：
  //   - 'prepend'（高保真档默认）：custom 放在 base 之前，把用户的话当一等公民
  //   - 'append' （经典档兼容写法）：base 在前，custom 以"额外要求："形式追加在末尾
  if (strategy.customPosition === 'prepend') {
    return `${custom}\n\n${base}`;
  }
  return `${base}\n\n额外要求：${custom}`;
}

export async function extractPrompt(params: ExtractParams): Promise<ExtractResult> {
  const { imageUrl, settings, prefetched, onProgress } = params;
  const providerId = settings.activeProvider;
  const cfg = settings.providers[providerId];
  if (!cfg.apiKey) {
    throw new Error(`请先在「设置」中为 ${providerId} 配置 API Key`);
  }
  // 策略档位决定 stylePrompts + 采样参数 + custom 拼接位置。在 extract 入口
  // 取一次，后续无论是 instruction 还是各家 API 的 body 都从这一份 strategy
  // 派生，保证"用户选了哪档就完整生效"，不会出现"指令换了但温度还是旧值"
  // 这种半新半旧的脏状态。
  const strategy = getStrategy(settings.promptStrategy);
  const instruction = buildInstruction(settings, strategy);

  // 阶段 1：图片就绪
  // - 如果调用方已经在外部并行下载完了，直接进入「calling」
  // - 否则我们在这里同步下载，并先 emit 一次 fetching，便于面板秒切到
  //   "正在下载图片"，避免一直停在通用 loading
  let img: FetchedImage;
  if (prefetched) {
    img = prefetched;
  } else {
    safeProgress(onProgress, { stage: 'fetching' });
    img = await fetchImageAsBase64(imageUrl);
  }

  // 阶段 2：开始呼叫大模型（首 token 之前都属于 calling）
  safeProgress(onProgress, { stage: 'calling' });

  let prompt: string;
  switch (providerId) {
    case 'anthropic':
      prompt = await callAnthropic(cfg, img, instruction, strategy, onProgress);
      break;
    case 'gemini':
      prompt = await callGemini(cfg, img, instruction, strategy, onProgress);
      break;
    case 'openai':
    case 'zhipu':
    case 'qwen':
    case 'siliconflow':
    case 'custom':
    default:
      prompt = await callOpenAICompatible(cfg, img, instruction, strategy, onProgress);
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
  img: FetchedImage,
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractParams['onProgress']
): Promise<string> {
  // 大部分兼容 OpenAI 的服务端都接受 url 形式的 image_url，
  // 但跨域 + 鉴权 + base64 更稳妥，这里统一转 base64。
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
    temperature: strategy.temperature,
    max_tokens: strategy.maxTokens,
    stream: true,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'API'));
  }

  // 少数兼容端不真正支持 stream，会忽略 stream:true 直接回 JSON。
  // 这里按 content-type 判断，是 SSE 就走流式累积，否则当作 JSON 解析。
  if (!isSseResponse(resp)) {
    const json = await parseJsonResponse<{
      choices?: Array<{
        message?: { content?: string | Array<{ type?: string; text?: string }> };
      }>;
    }>(resp, 'API');
    const content = json?.choices?.[0]?.message?.content;
    const final = extractOpenAIContent(content);
    if (!final) throw new Error('返回内容为空，请检查模型是否支持视觉输入');
    return final;
  }

  let acc = '';
  let lastFlushAt = 0;
  let sawFirstChunk = false;
  for await (const data of readSseDataChunks(resp)) {
    if (data === '[DONE]') break;
    let json: {
      choices?: Array<{
        delta?: { content?: string | Array<{ type?: string; text?: string }> };
      }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta?.content;
    const chunk = extractOpenAIContent(delta);
    if (!chunk) continue;
    acc += chunk;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      safeProgress(onProgress, { stage: 'streaming', partial: acc });
      lastFlushAt = Date.now();
      continue;
    }
    const now = Date.now();
    if (now - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
      lastFlushAt = now;
      safeProgress(onProgress, { stage: 'streaming', partial: acc });
    }
  }
  if (!acc) throw new Error('返回内容为空，请检查模型是否支持视觉输入');
  // 收尾再 flush 一次最终累积，确保面板上是完整文本
  safeProgress(onProgress, { stage: 'streaming', partial: acc });
  return acc;
}

function extractOpenAIContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c?.type === 'text' && c?.text ? c.text : ''))
      .join('');
  }
  return '';
}

// ============ Anthropic Claude ============
async function callAnthropic(
  cfg: ProviderConfig,
  img: FetchedImage,
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractParams['onProgress']
): Promise<string> {
  const url = `${trimSlash(cfg.baseUrl)}/messages`;
  const body = {
    model: cfg.model,
    max_tokens: strategy.maxTokens,
    // Anthropic 的 temperature 范围与 OpenAI 一致（0~1），可以直传
    temperature: strategy.temperature,
    stream: true,
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
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Claude'));
  }

  if (!isSseResponse(resp)) {
    const json = await parseJsonResponse<{ content?: Array<{ type?: string; text?: string }> }>(
      resp,
      'Claude'
    );
    const parts = json?.content;
    if (!Array.isArray(parts)) throw new Error('Claude 返回内容异常');
    return parts
      .filter((p) => p?.type === 'text')
      .map((p) => p.text || '')
      .join('');
  }

  let acc = '';
  let lastFlushAt = 0;
  let sawFirstChunk = false;
  for await (const data of readSseDataChunks(resp)) {
    let json: {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (json.type === 'message_stop') break;
    if (
      json.type === 'content_block_delta' &&
      json.delta?.type === 'text_delta' &&
      json.delta.text
    ) {
      acc += json.delta.text;
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        safeProgress(onProgress, { stage: 'streaming', partial: acc });
        lastFlushAt = Date.now();
        continue;
      }
      const now = Date.now();
      if (now - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
        lastFlushAt = now;
        safeProgress(onProgress, { stage: 'streaming', partial: acc });
      }
    }
  }
  if (!acc) throw new Error('Claude 返回内容为空');
  safeProgress(onProgress, { stage: 'streaming', partial: acc });
  return acc;
}

// ============ Google Gemini ============
async function callGemini(
  cfg: ProviderConfig,
  img: FetchedImage,
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractParams['onProgress']
): Promise<string> {
  // Gemini 的流式端点是独立 path：:streamGenerateContent?alt=sse
  // 加 alt=sse 才会真正以 SSE 推送，否则会拼成一个 JSON 数组一次性返回。
  const url = `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
    cfg.model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;
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
      temperature: strategy.temperature,
      maxOutputTokens: strategy.maxTokens,
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Gemini'));
  }

  if (!isSseResponse(resp)) {
    // 兜底：被中转节点改回 JSON 数组 / 单 JSON 时仍然要能跑通
    const text = await safeText(resp);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Gemini 返回内容无法解析为 JSON');
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let acc = '';
    for (const x of items) {
      const parts = (x as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) acc += p?.text || '';
      }
    }
    if (!acc) throw new Error('Gemini 返回内容异常');
    return acc;
  }

  let acc = '';
  let lastFlushAt = 0;
  let sawFirstChunk = false;
  for await (const data of readSseDataChunks(resp)) {
    let json: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const parts = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;
    let added = '';
    for (const p of parts) if (p?.text) added += p.text;
    if (!added) continue;
    acc += added;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      safeProgress(onProgress, { stage: 'streaming', partial: acc });
      lastFlushAt = Date.now();
      continue;
    }
    const now = Date.now();
    if (now - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
      lastFlushAt = now;
      safeProgress(onProgress, { stage: 'streaming', partial: acc });
    }
  }
  if (!acc) throw new Error('Gemini 返回内容为空');
  safeProgress(onProgress, { stage: 'streaming', partial: acc });
  return acc;
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
  // refine 路径也按"当前策略"走 —— 这样用户切到 classic 时改写出来的提示词
  // 语气也是 classic 那一档的（短段落、套话兼容）；切到 fidelity 时则会跟
  // 抽图时的指令保持一致的"有序展开 / 信息密集"调子。
  const strategy = getStrategy(settings.promptStrategy);
  const styleHint = strategy.stylePrompts[settings.outputStyle] || '';
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

/** 响应是不是 text/event-stream（含带 charset 后缀的情况）。 */
function isSseResponse(resp: Response): boolean {
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
async function* readSseDataChunks(resp: Response): AsyncGenerator<string> {
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
