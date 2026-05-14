/**
 * 「一键配置」导入解析。
 *
 * 用户从各种来源粘进来的内容格式都不一样：
 *
 *   - **curl 命令**（厂商文档 / Playground 里最常见的复制对象）：
 *       curl https://api.openai.com/v1/chat/completions \
 *         -H "Authorization: Bearer sk-..." -H "Content-Type: application/json" \
 *         -d '{ "model": "gpt-4o-mini", ... }'
 *       Google Gemini 的 `X-goog-api-key` / Anthropic 的 `x-api-key` 同样适配。
 *
 *   - **JSON 配置串**，又分多种亚种：
 *       a. 本插件「复制当前配置」吐出的精简片段          { provider, apiKey, baseUrl, model }
 *       b. 本插件早期导出的完整 settings                 { providers: { openai: {...}, ... } }
 *       c. NewAPI / OneAPI / OneHub 渠道连接信息         { _type, key, url } 或字段名各异
 *       d. Cherry Studio / ChatBox / NextChat / LobeChat 的导出片段
 *       e. 用户从某家平台 Dashboard 复制的 .env 风格      { OPENAI_API_KEY: "...", OPENAI_BASE_URL: "..." }
 *       f. 嵌套了一层 wrapper                              { data: {...} } / { config: {...} }
 *
 * 这里把"格式识别 + 字段同义词归一化 + provider 模糊匹配"集中到一处，
 * 让 UI 层（SetupGuide）只负责调用与展示提示。
 *
 * 设计原则：
 * 1. 宁可识别成 `custom` 也别报错 —— 用户已经把 Key 都贴进来了，强制让用户改
 *    JSON 再来一次的体验最差。
 * 2. 永远尝试根据 url 反推真实 provider，避免一律落到 `custom` 后用户还要再
 *    到下方「模型供应商」里手动切一次。
 * 3. 错误信息要可读：粘了什么、解析到了什么字段、为什么仍然不行，都要点出来。
 */

import { PROVIDER_LIST, PROVIDERS } from './providers';
import type { AppSettings, ProviderConfig, ProviderId } from './types';

const VALID_IDS = new Set<ProviderId>(PROVIDER_LIST.map((p) => p.id));

/** 用户写 provider 时常见的"别名 → 内置 id"映射（全部小写比较）。 */
const PROVIDER_ALIASES: Record<string, ProviderId> = {
  // 三大原生
  openai: 'openai',
  'open-ai': 'openai',
  gpt: 'openai',
  chatgpt: 'openai',
  azure: 'openai', // Azure OpenAI 也走 OpenAI 协议；如果是真正 Azure 端点用 custom 更安全，但这里先按 openai 接，用户可以改 baseUrl
  anthropic: 'anthropic',
  claude: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  googleai: 'gemini',
  'google-ai': 'gemini',
  vertex: 'gemini',
  // 国内
  zhipu: 'zhipu',
  zhipuai: 'zhipu',
  glm: 'zhipu',
  bigmodel: 'zhipu',
  qwen: 'qwen',
  qwenvl: 'qwen',
  tongyi: 'qwen',
  aliyun: 'qwen',
  dashscope: 'qwen',
  bailian: 'qwen',
  siliconflow: 'siliconflow',
  silicon: 'siliconflow',
  'silicon-flow': 'siliconflow',
  sf: 'siliconflow',
  deepseek: 'deepseek',
  ds: 'deepseek',
  moonshot: 'moonshot',
  kimi: 'moonshot',
  doubao: 'doubao',
  ark: 'doubao',
  volces: 'doubao',
  volcengine: 'doubao',
  'volc-engine': 'doubao',
  stepfun: 'stepfun',
  step: 'stepfun',
  minimax: 'minimax',
  minimaxi: 'minimax',
  abab: 'minimax',
  yi: 'yi',
  '01ai': 'yi',
  '01-ai': 'yi',
  lingyiwanwu: 'yi',
  baidu: 'baidu',
  ernie: 'baidu',
  qianfan: 'baidu',
  // 海外
  openrouter: 'openrouter',
  'open-router': 'openrouter',
  or: 'openrouter',
  xai: 'xai',
  'x-ai': 'xai',
  grok: 'xai',
  mistral: 'mistral',
  pixtral: 'mistral',
  groq: 'groq',
  together: 'together',
  togetherai: 'together',
  'together-ai': 'together',
  fireworks: 'fireworks',
  fireworksai: 'fireworks',
  'fireworks-ai': 'fireworks',
  // 中转
  shukelongda: 'shukelongda',
  // 兜底
  custom: 'custom',
  'openai-compatible': 'custom',
  openai_compatible: 'custom',
  'openai-compat': 'custom',
  oneapi: 'custom',
  'one-api': 'custom',
  newapi: 'custom',
  'new-api': 'custom',
  onehub: 'custom',
  'one-hub': 'custom',
};

/**
 * host 子串关键字 → provider id。
 *
 * 用 host 做"包含匹配"而不是"全等"，是为了让中转域名也能识别 ——
 * 例如某用户把 OpenRouter 转发到自家域 `gw.openrouter-cn.example.com` 仍能命中。
 *
 * 顺序要按"特异度从高到低"排，避免 `googleapis.com` 把 `aistudio.googleapis.com`
 * 这类子域抢走（这里不会冲突，但保留这个习惯）。
 */
const HOST_RULES: Array<{ keyword: string; id: ProviderId }> = [
  { keyword: 'openrouter', id: 'openrouter' },
  { keyword: 'api.openai.com', id: 'openai' },
  { keyword: 'api.anthropic.com', id: 'anthropic' },
  { keyword: 'anthropic', id: 'anthropic' },
  { keyword: 'generativelanguage.googleapis', id: 'gemini' },
  { keyword: 'aiplatform.googleapis', id: 'gemini' },
  { keyword: 'bigmodel.cn', id: 'zhipu' },
  { keyword: 'open.bigmodel', id: 'zhipu' },
  { keyword: 'dashscope', id: 'qwen' },
  { keyword: 'aliyuncs.com', id: 'qwen' },
  { keyword: 'bailian.console.aliyun', id: 'qwen' },
  { keyword: 'siliconflow', id: 'siliconflow' },
  { keyword: 'deepseek', id: 'deepseek' },
  { keyword: 'moonshot', id: 'moonshot' },
  { keyword: 'ark.cn-beijing.volces', id: 'doubao' },
  { keyword: 'volces.com', id: 'doubao' },
  { keyword: 'volcengine', id: 'doubao' },
  { keyword: 'stepfun', id: 'stepfun' },
  { keyword: 'minimax.chat', id: 'minimax' },
  { keyword: 'minimaxi.com', id: 'minimax' },
  { keyword: 'lingyiwanwu', id: 'yi' },
  { keyword: '01.ai', id: 'yi' },
  { keyword: 'qianfan', id: 'baidu' },
  { keyword: 'baidubce', id: 'baidu' },
  { keyword: 'aip.baidubce', id: 'baidu' },
  { keyword: 'api.x.ai', id: 'xai' },
  { keyword: 'mistral.ai', id: 'mistral' },
  { keyword: 'groq.com', id: 'groq' },
  { keyword: 'api.together.xyz', id: 'together' },
  { keyword: 'together.ai', id: 'together' },
  { keyword: 'fireworks.ai', id: 'fireworks' },
  { keyword: 'shukelongda', id: 'shukelongda' },
];

/** 字段名同义词归一化时使用的"小写键"。 */
const KEY_SYNONYMS = {
  apiKey: ['apikey', 'api_key', 'key', 'token', 'secret', 'sk', 'openai_api_key', 'access_token', 'authorization'],
  baseUrl: ['baseurl', 'base_url', 'url', 'endpoint', 'api_base', 'apibase', 'api_endpoint', 'openai_base_url', 'host', 'apihost', 'api_host', 'server'],
  model: ['model', 'model_name', 'modelname', 'default_model', 'defaultmodel', 'openai_model'],
  provider: ['provider', 'type', 'providerid', 'provider_id', 'brand', 'vendor', 'platform'],
};

export type ImportResult =
  | { ok: true; settings: AppSettings; hint: string }
  | { ok: false; error: string };

/**
 * 解析任意配置文本（JSON 或 curl 命令）并合并到现有 AppSettings。
 *
 * 这是 UI 层最希望调用的"开盒即用"接口：拿到字符串、给我下一份 settings 或一句
 * 人话错误。内部按以下顺序尝试：
 *
 *   0. 文本以 `curl` 开头？解析为标准片段 { provider, apiKey, baseUrl, model }
 *   1. JSON.parse；失败时尝试容忍尾逗号 / 单引号等常见手抖
 *   2. 顶层 unwrap（剥掉 `data` / `config` / `settings` / `result` 这层壳）
 *   3. 如果是数组 → 取第一项 / 第一项有 apiKey 的
 *   4. 三种模式分发：单 provider / 多 provider / NewAPI 渠道连接
 *   5. 都不像？只要找得到 apiKey 就走"按 url 反推 provider 的兜底"
 */
export function importFromText(base: AppSettings, raw: string): ImportResult {
  const text = (raw || '').trim();
  if (!text) return { ok: false, error: '请先粘贴一段 JSON 配置或 curl 命令。' };

  // —— 0. curl 命令（厂商文档最常见的复制对象）
  if (/^\s*curl\b/i.test(text)) {
    const curlObj = tryParseCurl(text);
    if (!curlObj) {
      return {
        ok: false,
        error:
          '识别到 curl 命令，但未能从中解析出 API Key。\n' +
          '请确认命令包含以下任一鉴权字段：\n' +
          '  · Authorization: Bearer <key>（OpenAI / DeepSeek / 千问 等）\n' +
          '  · x-api-key: <key>（Anthropic Claude）\n' +
          '  · X-goog-api-key: <key>（Google Gemini）\n' +
          '  · URL 参数 ?key=<key>',
      };
    }
    if (looksLikePlaceholder(String(curlObj.apiKey || ''))) {
      return {
        ok: false,
        error:
          `已从 curl 中解析出 API Key，但它看起来是占位符（"${curlObj.apiKey}"）。\n` +
          '请把命令里的 $YOUR_API_KEY / <YOUR_KEY> 替换为真实 Key 后再导入。',
      };
    }
    return applyImportedConfig(base, curlObj);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 常见手抖：单引号、尾逗号
    try {
      parsed = JSON.parse(softFixJson(text));
    } catch (e) {
      return {
        ok: false,
        error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}\n（如要粘贴 curl 命令，请确保以 "curl " 开头）`,
      };
    }
  }

  const obj = unwrap(parsed);
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'JSON 顶层必须是对象、数组或常见 wrapper 之一。' };
  }

  return applyImportedConfig(base, obj as Record<string, unknown>);
}

/**
 * 旧的导出名，保留作为别名避免外部调用方破裂。新代码请使用 {@link importFromText}。
 * @deprecated 函数现在同时支持 JSON 和 curl，名字保留是为了向后兼容。
 */
export const importFromJsonText = importFromText;

/**
 * 合并已经 parse 完的对象。SetupGuide 之外（例如未来 popup 的导入入口）也可以
 * 直接调用这个版本。
 */
export function applyImportedConfig(
  base: AppSettings,
  raw: Record<string, unknown>
): ImportResult {
  // —— 1. NewAPI / OneAPI 「渠道连接」信息（保留 _type 显式判别 + 字段宽松）
  if (raw._type === 'newapi_channel_conn' || raw._type === 'oneapi_channel_conn') {
    return importChannelConn(base, raw);
  }

  // —— 2. 多 provider 整体（providers 为对象 map 或数组）
  if (raw.providers && (typeof raw.providers === 'object' || Array.isArray(raw.providers))) {
    return importMultiProvider(base, raw);
  }

  // —— 3. 顶层就是数组（一些导出是 `[ {provider, apiKey, ...}, {...} ]`）
  if (Array.isArray(raw)) {
    const first = (raw as unknown[]).find(
      (x) => x && typeof x === 'object' && pickFirst(x as Record<string, unknown>, KEY_SYNONYMS.apiKey)
    );
    if (first) return applyImportedConfig(base, first as Record<string, unknown>);
    return { ok: false, error: 'JSON 是数组，但其中没有任何带 apiKey 的对象。' };
  }

  // —— 4. 单 provider 片段（最常见）
  return importSingleProvider(base, raw);
}

// ============================================================
// 子流程
// ============================================================

function importChannelConn(
  base: AppSettings,
  raw: Record<string, unknown>
): ImportResult {
  const apiKey = pickStr(raw, KEY_SYNONYMS.apiKey);
  const rawUrl = pickStr(raw, KEY_SYNONYMS.baseUrl);
  if (!apiKey) {
    return { ok: false, error: '导入失败：渠道连接缺少 key/token/apiKey 字段或为空。' };
  }
  if (!rawUrl) {
    return { ok: false, error: '导入失败：渠道连接缺少 url/baseUrl/endpoint 字段或为空。' };
  }
  const baseUrl = ensureOpenAIBase(rawUrl);
  const pid = matchProviderByUrl(rawUrl) ?? 'custom';
  const next = mergeOneProvider(base, pid, { apiKey, baseUrl });
  const meta = PROVIDERS[pid];
  return {
    ok: true,
    settings: next,
    hint:
      pid === 'custom'
        ? `已把渠道「${baseUrl}」导入到「自定义」。如需切换到具体厂商可在下方「模型供应商」调整。`
        : `已识别为「${meta.label}」并导入配置（${baseUrl}）。`,
  };
}

function importSingleProvider(
  base: AppSettings,
  raw: Record<string, unknown>
): ImportResult {
  const apiKey = pickStr(raw, KEY_SYNONYMS.apiKey);
  const baseUrl = pickStr(raw, KEY_SYNONYMS.baseUrl);
  const model = pickStr(raw, KEY_SYNONYMS.model);
  const providerRaw = pickStr(raw, KEY_SYNONYMS.provider);

  if (!apiKey) {
    return {
      ok: false,
      error:
        '导入失败：找不到 API Key 字段。\n' +
        '识别字段名（任一即可）：apiKey / api_key / key / token / secret / OPENAI_API_KEY。',
    };
  }

  // provider 优先级：显式字段 → url 反推 → custom
  let pid: ProviderId | null = providerRaw ? resolveProviderAlias(providerRaw) : null;
  if (!pid && baseUrl) pid = matchProviderByUrl(baseUrl);
  if (!pid) pid = 'custom';

  const next = mergeOneProvider(base, pid, {
    apiKey,
    baseUrl: baseUrl ? (pid === 'gemini' || pid === 'anthropic' ? baseUrl.replace(/\/+$/, '') : ensureOpenAIBase(baseUrl)) : undefined,
    model: model || undefined,
  });

  const meta = PROVIDERS[pid];
  let hint = `已导入「${meta.label}」的配置并切换为当前供应商。`;
  if (providerRaw && !resolveProviderAlias(providerRaw)) {
    hint = `未识别 provider 字段「${providerRaw}」，已按 baseUrl 归类到「${meta.label}」。${
      pid === 'custom' ? '如需切到具体厂商可在下方调整。' : ''
    }`;
  } else if (!providerRaw && pid !== 'custom') {
    hint = `未提供 provider 字段，已按 baseUrl 自动识别为「${meta.label}」。`;
  } else if (pid === 'custom' && !providerRaw) {
    hint = `未识别出具体厂商，已导入到「自定义」端点。`;
  }
  return { ok: true, settings: next, hint };
}

function importMultiProvider(
  base: AppSettings,
  raw: Record<string, unknown>
): ImportResult {
  // providers 可以是对象 map（{ openai: {...} }）也可以是数组（Cherry Studio 风格）
  const incoming = raw.providers;
  const entries: Array<{ key: string; value: Record<string, unknown> }> = [];
  if (Array.isArray(incoming)) {
    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const idGuess =
        pickStr(obj, ['id', 'providerid', 'provider_id', 'name', 'type']) ||
        pickStr(obj, KEY_SYNONYMS.provider);
      entries.push({ key: idGuess || '', value: obj });
    }
  } else {
    for (const k of Object.keys(incoming as object)) {
      const v = (incoming as Record<string, unknown>)[k];
      if (!v || typeof v !== 'object') continue;
      entries.push({ key: k, value: v as Record<string, unknown> });
    }
  }

  const nextProviders = { ...base.providers };
  const touched: ProviderId[] = [];
  const skipped: string[] = [];

  for (const { key, value } of entries) {
    const apiKey = pickStr(value, KEY_SYNONYMS.apiKey);
    const baseUrl = pickStr(value, KEY_SYNONYMS.baseUrl);
    const model = pickStr(value, KEY_SYNONYMS.model);

    let pid: ProviderId | null = key ? resolveProviderAlias(key) : null;
    if (!pid) {
      const innerProvider = pickStr(value, KEY_SYNONYMS.provider);
      if (innerProvider) pid = resolveProviderAlias(innerProvider);
    }
    if (!pid && baseUrl) pid = matchProviderByUrl(baseUrl);

    // 没识别出 id 又没 apiKey，整条跳过；只要二者有其一就尽量保留
    if (!pid && !apiKey) {
      if (key) skipped.push(key);
      continue;
    }
    if (!pid) pid = 'custom';

    const prev = nextProviders[pid];
    nextProviders[pid] = {
      ...prev,
      id: pid,
      apiKey: apiKey || prev.apiKey,
      baseUrl: baseUrl
        ? pid === 'gemini' || pid === 'anthropic'
          ? baseUrl.replace(/\/+$/, '')
          : ensureOpenAIBase(baseUrl)
        : prev.baseUrl,
      model: model || prev.model,
    };
    touched.push(pid);
  }

  if (touched.length === 0) {
    return {
      ok: false,
      error:
        'providers 中没有任何可用条目（所有项要么 provider id 无法识别，要么没有 apiKey）。' +
        (skipped.length ? `\n已忽略：${skipped.join(', ')}` : ''),
    };
  }

  const wantActiveStr = pickStr(raw, ['activeprovider', 'active_provider', 'active', 'current']);
  const wantActive = wantActiveStr ? resolveProviderAlias(wantActiveStr) : null;
  const active = wantActive && touched.includes(wantActive) ? wantActive : touched[0];

  return {
    ok: true,
    settings: { ...base, activeProvider: active, providers: nextProviders },
    hint: `已导入 ${touched.length} 个 provider 的配置（${touched
      .map((p) => PROVIDERS[p]?.label || p)
      .join(' / ')}），当前供应商：${PROVIDERS[active]?.label || active}。`,
  };
}

// ============================================================
// 工具：合并、字段提取、url 归一化、provider 识别
// ============================================================

function mergeOneProvider(
  base: AppSettings,
  pid: ProviderId,
  patch: { apiKey?: string; baseUrl?: string; model?: string }
): AppSettings {
  const prev = base.providers[pid];
  const meta = PROVIDERS[pid];
  const merged: ProviderConfig = {
    ...prev,
    id: pid,
    apiKey: patch.apiKey ?? prev.apiKey,
    baseUrl: patch.baseUrl?.trim() || prev.baseUrl || meta.defaultBaseUrl,
    model:
      patch.model?.trim() ||
      (prev.model && prev.model.trim() ? prev.model : meta.defaultModel),
  };
  return {
    ...base,
    activeProvider: pid,
    providers: { ...base.providers, [pid]: merged },
  };
}

/**
 * 在对象 raw 上按一组同义词键名找出第一个非空字符串值。
 *
 * 大小写不敏感（key 比较时统一小写），并且会顺便去掉首尾空白。
 */
function pickStr(raw: Record<string, unknown>, keys: string[]): string {
  const lowerMap = buildLowerMap(raw);
  for (const k of keys) {
    const v = lowerMap[k.toLowerCase()];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function pickFirst(raw: Record<string, unknown>, keys: string[]): unknown {
  const lowerMap = buildLowerMap(raw);
  for (const k of keys) {
    const v = lowerMap[k.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function buildLowerMap(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * 把 NewAPI 渠道里粘出来的 url 归一化成 OpenAI 兼容的 baseUrl。
 *
 * - 站点根地址（pathname `/` 或空）自动补 `/v1`
 * - 已带路径段（如 `…/v1`、`…/api/paas/v4`、`…/compatible-mode/v1`）保持不动
 * - 大写 `/V1` / `/V2` 自动小写化
 *
 * 注意：仅 OpenAI 兼容协议适用。Anthropic / Gemini 各自有不同的 path 习惯，
 * 调用方应在 pid === anthropic / gemini 时绕过本函数。
 */
export function ensureOpenAIBase(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '').replace(/\/V(\d+)/g, '/v$1');
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

/**
 * 按 hostname 关键字 / 全等映射，把外部 url 反推到一个内置 provider。
 *
 * 与"全等比较"相比，关键字子串匹配能识别用户搭建的反代域名，例如：
 *   - `gw.openrouter.example.com` → openrouter
 *   - `proxy.deepseek.tld`        → deepseek
 *
 * 匹配不到时返回 null，调用方可以回落到 `custom`。
 */
export function matchProviderByUrl(url: string): ProviderId | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  for (const rule of HOST_RULES) {
    if (host.includes(rule.keyword)) return rule.id;
  }
  // 兜底：和某个内置 provider 的 host 全等
  for (const p of PROVIDER_LIST) {
    if (p.id === 'custom') continue;
    try {
      const phost = new URL(p.defaultBaseUrl).hostname.toLowerCase();
      if (phost === host) return p.id;
    } catch {
      continue;
    }
  }
  return null;
}

/** 把 provider 字段写法（kimi / volcengine / silicon / Pixtral …）归一到内置 id。 */
export function resolveProviderAlias(raw: string): ProviderId | null {
  const k = (raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!k) return null;
  if (VALID_IDS.has(k as ProviderId)) return k as ProviderId;
  if (k in PROVIDER_ALIASES) return PROVIDER_ALIASES[k];
  // 再退一步：去掉常见后缀 `-api` / `-ai` 再试一次
  const stripped = k
    .replace(/[-_]?ai$/, '')
    .replace(/[-_]?api$/, '')
    .replace(/[-_]?official$/, '');
  if (stripped !== k) {
    if (VALID_IDS.has(stripped as ProviderId)) return stripped as ProviderId;
    if (stripped in PROVIDER_ALIASES) return PROVIDER_ALIASES[stripped];
  }
  return null;
}

/**
 * 修最常见的两类手抖 JSON：
 *   - 单引号字符串：`{ 'key': 'value' }` → `{ "key": "value" }`
 *   - 末尾多逗号：`{ "a": 1, }` → `{ "a": 1 }`
 *
 * 不追求覆盖所有非法 JSON，仅作"善意尽力"补救，目的是让大量从聊天 / 文档里
 * 复制出来的近似 JSON 也能成功导入。修不动就让上层报原始 JSON.parse 错误。
 */
function softFixJson(s: string): string {
  let t = s.trim();
  // 把单引号的对象/字符串转成双引号（粗略）。注意：会破坏字符串字面里真正的单引号，
  // 但对绝大多数 API key / url 没影响。
  if (!t.startsWith('{') && !t.startsWith('[')) return t;
  if (/'/.test(t) && !/"/.test(t)) {
    t = t.replace(/'/g, '"');
  }
  // 删除对象/数组结尾多余逗号
  t = t.replace(/,(\s*[}\]])/g, '$1');
  return t;
}

// ============================================================
// curl 命令解析
// ============================================================

/**
 * 把一段 curl 命令解析成「单 provider 导入片段」对象，可以直接交给
 * {@link applyImportedConfig} 走后续的 provider 识别 / 合并流程。
 *
 * 支持：
 *   - 多行续行：bash `\` / PowerShell 反引号 ` / cmd `^`
 *   - 引号风格：单引号 / 双引号 / 无引号；双引号内识别 `\"` 转义
 *   - Header：`-H "K: V"` / `--header 'K: V'`
 *   - URL：第一个非选项的 https 串，或显式 `--url`
 *   - 鉴权（按优先级）：Authorization Bearer → Authorization → X-Api-Key →
 *     X-Goog-Api-Key → URL 参数 ?key= / ?api-key=
 *   - 模型：Gemini 从 URL `/models/<m>:<verb>` 取；OpenAI/Anthropic 从 body 的 `model` 字段取
 *
 * 解析失败（缺 url / 缺 key）返回 null，让调用方走 JSON 兜底或报错。
 */
function tryParseCurl(text: string): Record<string, unknown> | null {
  // 先把各种续行方式都合并成单行，避免 shell 词法器要处理换行。
  const joined = text
    .replace(/\\\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
  const tokens = tokenizeShell(joined);
  if (!tokens.length || !/^curl$/i.test(tokens[0])) return null;

  let url = '';
  const headers: Record<string, string> = {};
  let body = '';

  // 这些选项后面会跟一个值，需要跳过一格避免被当成 URL。
  const VALUE_OPTS = new Set([
    '-X', '--request',
    '-u', '--user',
    '-b', '--cookie',
    '-A', '--user-agent',
    '-e', '--referer',
    '-o', '--output',
    '--cacert', '--cert', '--key',
    '--proxy', '-x',
    '--connect-timeout', '--max-time',
    '--resolve', '--cookie-jar',
  ]);

  for (let i = 1; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === '-H' || tk === '--header') {
      const v = tokens[++i] ?? '';
      const colon = v.indexOf(':');
      if (colon > 0) {
        headers[v.slice(0, colon).trim().toLowerCase()] = v.slice(colon + 1).trim();
      }
    } else if (
      tk === '-d' ||
      tk === '--data' ||
      tk === '--data-raw' ||
      tk === '--data-binary' ||
      tk === '--data-ascii' ||
      tk === '--data-urlencode'
    ) {
      body = tokens[++i] ?? '';
    } else if (tk === '--url') {
      url = tokens[++i] ?? '';
    } else if (VALUE_OPTS.has(tk)) {
      i++; // 跳过一个值
    } else if (tk.startsWith('-')) {
      // 其它布尔/未知短选项：忽略
      continue;
    } else if (!url && /^https?:\/\//i.test(tk)) {
      url = tk;
    }
  }

  if (!url) return null;

  // —— 1. 鉴权提取
  let apiKey = '';
  const auth = headers['authorization'];
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth);
    apiKey = (m ? m[1] : auth).trim();
  }
  if (!apiKey) {
    apiKey =
      headers['x-goog-api-key'] ||
      headers['x-api-key'] ||
      headers['api-key'] ||
      headers['x-auth-token'] ||
      '';
  }

  // —— 2. URL 查询参数里的 key（Google 老风格）+ 把 key 参数清掉用于后续切 baseUrl
  let cleanUrl = url;
  try {
    const u = new URL(url);
    if (!apiKey) {
      apiKey =
        u.searchParams.get('key') ||
        u.searchParams.get('api-key') ||
        u.searchParams.get('apikey') ||
        u.searchParams.get('access_token') ||
        '';
    }
    u.searchParams.delete('key');
    u.searchParams.delete('api-key');
    u.searchParams.delete('apikey');
    u.searchParams.delete('access_token');
    cleanUrl = u.toString();
  } catch {
    /* 不是合法 URL 就保持原样，下面 trim 也能容错 */
  }

  if (!apiKey) return null;

  const pid = matchProviderByUrl(cleanUrl);
  const baseUrl = trimUrlToVersionBase(cleanUrl);

  // —— 3. model 提取
  let model = '';
  // Gemini: /v1beta/models/<model>:<verb>
  const geminiModel = /\/models\/([^/:?]+)(?::|$|\/)/i.exec(cleanUrl);
  if (geminiModel) model = geminiModel[1];
  // OpenAI / Anthropic / 其它 OpenAI 兼容：从 body JSON 里读 model
  if (!model && body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const m = (parsed as Record<string, unknown>).model;
        if (typeof m === 'string' && m.trim()) model = m.trim();
      }
    } catch {
      /* body 不是 JSON 就放弃，不影响其它字段 */
    }
  }

  const out: Record<string, unknown> = { apiKey };
  if (baseUrl) out.baseUrl = baseUrl;
  if (model) out.model = model;
  if (pid) out.provider = pid;
  return out;
}

/**
 * 朴素的 POSIX shell 词法器：识别单引号 / 双引号 / 反斜杠转义，把命令行切成 token 数组。
 *
 * 仅覆盖 curl 命令里出现的写法，不实现变量展开 / glob / 重定向等更复杂的语法。
 */
function tokenizeShell(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false; // 用来区分"空 token"和"空引号字符串"
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      // 仅在双引号内识别反斜杠转义（单引号内一切原样保留，POSIX 行为）
      if (quote === '"' && c === '\\' && i + 1 < line.length) {
        cur += line[++i];
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) tokens.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) tokens.push(cur);
  return tokens;
}

/**
 * 把一个完整请求 URL 截断成 SDK 风格的 baseUrl。
 *
 * 主策略：找到 path 中最后一个版本号段（`/v1` / `/v2` / `/v1beta` / `/v3alpha` …），
 * 保留到该段为止。这条规则在主流厂商上都成立：
 *   - `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`
 *     → `https://generativelanguage.googleapis.com/v1beta`
 *   - `https://api.openai.com/v1/chat/completions`     → `https://api.openai.com/v1`
 *   - `https://api.anthropic.com/v1/messages`          → `https://api.anthropic.com/v1`
 *   - `https://open.bigmodel.cn/api/paas/v4/chat/...`  → `https://open.bigmodel.cn/api/paas/v4`
 *   - `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
 *     → `https://dashscope.aliyuncs.com/compatible-mode/v1`
 *
 * 兜底策略：若 URL 中没有 vN 段（罕见），就从末尾开始剥常见 endpoint 关键字
 * （chat / messages / completions / embeddings …）直到剩下的部分像 base。
 */
export function trimUrlToVersionBase(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);

    let lastIdx = -1;
    for (let i = 0; i < segs.length; i++) {
      if (/^v\d+(?:beta|alpha|preview)?$/i.test(segs[i])) lastIdx = i;
    }
    if (lastIdx >= 0) {
      const keep = segs.slice(0, lastIdx + 1).join('/');
      return `${u.origin}/${keep}`;
    }

    const ENDPOINT_SEGS = new Set([
      'chat', 'completions', 'messages', 'embeddings', 'responses',
      'images', 'audio', 'files', 'fine_tuning', 'fine-tuning',
      'moderations', 'batches', 'threads', 'assistants', 'generate',
      'generations', 'rerank', 'rerankings', 'classify',
    ]);
    let cut = segs.length;
    while (cut > 0) {
      const tail = segs[cut - 1].toLowerCase().split(':')[0];
      if (ENDPOINT_SEGS.has(tail) || tail === 'models') {
        cut--;
        continue;
      }
      break;
    }
    const keep = segs.slice(0, cut).join('/');
    return keep ? `${u.origin}/${keep}` : u.origin;
  } catch {
    return url;
  }
}

/**
 * 粗判一个 Key 是否像 shell / 文档里的占位符（让 UI 提示用户替换，而不是默默存进去）。
 * 不做夸张匹配，只覆盖最常见的几种写法：`$XXX` / `<...>` / `YOUR_*_KEY` / `sk-xxxx`（全 x）。
 */
function looksLikePlaceholder(key: string): boolean {
  const k = key.trim();
  if (!k) return true;
  if (k.startsWith('$')) return true;
  if (k.startsWith('<') && k.endsWith('>')) return true;
  if (/^(your|my|example|placeholder)[_\-]/i.test(k)) return true;
  if (/^sk-x{4,}$/i.test(k)) return true;
  if (/^x{6,}$/i.test(k)) return true;
  return false;
}

/**
 * 剥掉常见的"包装层"，让 raw 指向真正的配置对象。
 *
 * 例如：
 *   { data: { provider: ..., apiKey: ... } }    → { provider, apiKey, ... }
 *   { config: {...} } / { settings: {...} } 同理
 *
 * 有些客户端会再包一层 `result.data`，所以最多向下钻 3 层避免死循环。
 */
function unwrap(parsed: unknown): unknown {
  let cur: unknown = parsed;
  for (let i = 0; i < 3; i++) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) break;
    const obj = cur as Record<string, unknown>;
    // 对象本身已经像配置（含 apiKey 同义词或 providers / _type）就停止
    if (
      pickFirst(obj, KEY_SYNONYMS.apiKey) !== undefined ||
      'providers' in obj ||
      '_type' in obj
    ) {
      return obj;
    }
    const nextKey = ['data', 'config', 'settings', 'result', 'payload'].find((k) =>
      Object.prototype.hasOwnProperty.call(obj, k) && obj[k] && typeof obj[k] === 'object'
    );
    if (!nextKey) break;
    cur = obj[nextKey];
  }
  return cur;
}
