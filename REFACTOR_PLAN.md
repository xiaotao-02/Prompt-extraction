# Prompt Extracto 重构执行手册

> 适用对象：能调用 `Read / Write / StrReplace / Delete / Glob / Grep / Shell` 工具的 AI 助手。
> 目标：把项目里的 6 个巨石文件按职责拆开，**完全不改变任何外部 import 路径**，让所有业务代码零回归。
> 总耗时预估：1~2 小时（其中 Phase 4 最重，约占 60%）。

---

## 0. 全局约束（必读）

1. **不改外部 import**：所有 `import x from '@/lib/api'`、`@/lib/storage`、`'./panel'`、`'./PromptLibrary'` 等业务路径必须保持工作。所有目录化重构通过 **barrel `index.ts`** 重新导出对外接口。
2. **每个 Phase 结束必须跑** `npm run lint`（= `tsc -b --noEmit`）。**输出 0 error 才能进入下一个 Phase**。失败必须先回滚到上一个 Phase 的产物，定位问题，修复后再跑。
3. **不动以下文件**：`vite.config.ts`、`tsconfig.json`、`package.json` 的 scripts、`src/manifest.config.ts`、`public/` 整个目录、`scripts/` 整个目录。
4. **不删除老文件，直到对应 Phase 的所有新文件都建立完毕并通过 lint**。删除步骤被明确单列为最后一步。
5. **写文件用 `Write` 工具，覆盖式**。修改用 `StrReplace`。删除用 `Delete`。**不要**用 `Shell` 的 `cat > file` / `echo > file` 来写文件。
6. **Idempotent**：每一步开头先 `Read` 目标文件，**已经存在且内容正确就跳过**。便于断点续做。
7. **不要在代码里加新功能、不要"顺手优化"算法**。本次重构只搬位置，业务逻辑必须 1:1 保留。注释也尽量原样保留。
8. **遇到不确定时，先 `Read` 原文件确认源代码**，再决定。

---

## 1. 当前进度速查

```
[x] Phase 1.1  src/lib/api/url.ts                       已建立
[x] Phase 1.2  src/lib/api/http.ts                      已建立
[x] Phase 1.3  src/lib/api/types.ts                     已建立
[x] Phase 1.4  src/lib/api/providers/openai.ts          已建立
[x] Phase 1.5  src/lib/api/providers/anthropic.ts       已建立
[ ] Phase 1.6  src/lib/api/providers/gemini.ts          ← 从这里开始
[ ] Phase 1.7  src/lib/api/extract.ts
[ ] Phase 1.8  src/lib/api/refine.ts
[ ] Phase 1.9  src/lib/api/models.ts
[ ] Phase 1.10 重写 src/lib/api/index.ts 为 barrel
[ ] Phase 1.11 npm run lint 验证
[ ] Phase 2    拆 src/lib/storage.ts        → src/lib/storage/
[ ] Phase 3    拆 src/content/panel.ts      → src/content/panel/
[ ] Phase 4a   抽 src/options/_shared/      （供 PromptLibrary + PopupApp 复用）
[ ] Phase 4b   拆 src/options/PromptLibrary.tsx → src/options/PromptLibrary/
[ ] 最终验证   npm run lint && npm run build 全过
```

---

## Phase 1：拆分 `src/lib/api/`

> 把 840 行的 `src/lib/api/index.ts` 按职责拆成多个 ≤200 行小文件。
> **原文件保留**直到 1.10 步把 index.ts 整体覆盖。

### 1.6 创建 `src/lib/api/providers/gemini.ts`

先 `Read d:\code\Code Experiment\Prompt extraction\src\lib\api\providers\gemini.ts`，如果存在则跳过。

否则用 `Write` 写入以下完整内容：

```typescript
/**
 * Google Gemini generateContent API。
 */
import type { ProviderConfig } from '../../types';
import type { FetchedImage } from '../../image';
import type { PromptStrategy } from '../../strategies';
import {
  STREAM_FLUSH_INTERVAL_MS,
  describeRespFailure,
  isSseResponse,
  parseJsonResponse,
  readSseDataChunks,
  safeText,
} from '../http';
import { trimSlash } from '../url';
import { safeProgress, type ExtractProgressFn } from '../types';

export async function callGemini(
  cfg: ProviderConfig,
  img: FetchedImage,
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractProgressFn
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

/** Gemini 的纯文本（refine）通道。 */
export async function callGeminiText(
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
```

### 1.7 创建 `src/lib/api/extract.ts`

完整内容：

```typescript
/**
 * 视觉反推主入口：根据 settings.activeProvider 路由到具体 provider 实现，
 * 并负责"图片就绪 → 调用模型 → 流式回传"的阶段调度。
 */
import type { AppSettings } from '../types';
import { fetchImageAsBase64 } from '../image';
import { getStrategy, type PromptStrategy } from '../strategies';
import { callOpenAICompatible } from './providers/openai';
import { callAnthropic } from './providers/anthropic';
import { callGemini } from './providers/gemini';
import {
  safeProgress,
  type ExtractParams,
  type ExtractResult,
} from './types';

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
  let img;
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
```

### 1.8 创建 `src/lib/api/refine.ts`

完整内容：

```typescript
/**
 * 提示词文本重写（refine）：根据用户的"修改要求"，让模型在保留原意的前提下
 * 重写已有的提示词。各家 provider 共用同一套 system / user 模板。
 */
import { getStrategy } from '../strategies';
import { callOpenAICompatibleText } from './providers/openai';
import { callAnthropicText } from './providers/anthropic';
import { callGeminiText } from './providers/gemini';
import type { RefineParams, RefineResult } from './types';

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
  // refine 路径也按"当前策略"走 —— 这样用户切到 v0.1.5 / v0.1.6 等不同档位时，
  // 改写出来的提示词语气会和抽图时模型读到的指令保持一致的调子。
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

/** 把模型可能返回的"```...```、前缀、引号"等常见伪装去掉。 */
function cleanRefined(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  t = t.replace(/^(修改后|新提示词|结果|输出)[:：]\s*/i, '');
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}
```

### 1.9 创建 `src/lib/api/models.ts`

完整内容：

```typescript
/**
 * 拉取 provider 的模型列表（GET /models）。
 *
 * 大多数中转 / 官方端点都暴露了 `GET /models` 接口，用来枚举该 Key 下可用的模型 id。
 * 这里按 provider 类型走对应的协议；返回去重 + 排序后的字符串数组。
 */
import type { ProviderConfig, ProviderId } from '../types';
import { describeRespFailure, parseJsonResponse } from './http';
import { normalizeOpenAIBase, trimSlash } from './url';

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
```

### 1.10 重写 `src/lib/api/index.ts` 为 barrel

**完全覆盖**原 840 行文件，写入以下内容：

```typescript
/**
 * @/lib/api 的对外门面（barrel）。
 *
 * 历史上整套 api 实现都堆在这一个文件里。重构后按职责拆到子模块：
 *   - extract.ts            视觉反推主入口
 *   - refine.ts             提示词重写
 *   - models.ts             /models 列表
 *   - providers/openai.ts   OpenAI 兼容（含智谱 / Qwen / SiliconFlow / 自定义）
 *   - providers/anthropic.ts Claude
 *   - providers/gemini.ts   Gemini
 *   - http.ts / url.ts      跨 provider 共用工具
 *   - types.ts              对外类型签名
 *
 * 业务代码继续 `import { extractPrompt, refinePrompt, listModels } from '@/lib/api'` 即可，
 * 不需要感知拆分。
 */
export { extractPrompt } from './extract';
export { refinePrompt } from './refine';
export { listModels } from './models';
export type {
  ExtractParams,
  ExtractResult,
  ExtractProgressEvent,
  RefineParams,
  RefineResult,
} from './types';
```

### 1.11 验证 Phase 1

执行：

```powershell
cd "d:\code\Code Experiment\Prompt extraction"
npm run lint
```

**期望**：进程退出码 0，无 TS 错误。

**若有错**：
- `Cannot find module './extract'` 之类 → 检查上一步 `index.ts` 是否真的覆盖成功（`Read` 一下）
- 任何 `xxx is declared but its value is never read` → 检查对应文件的 import 是否多余，用 `StrReplace` 删
- `Property 'foo' does not exist on type ...` → 说明搬迁时漏了某段代码，回到对应步骤补齐

通过后，把 todo `p1` / `p1-verify` 标记为 completed。

---

## Phase 2：拆分 `src/lib/storage.ts`

> 原文件：`src/lib/storage.ts`（740 行）
> 目标目录：`src/lib/storage/`
> 拆完后 `src/lib/storage.ts` **必须删除**，否则 import `'@/lib/storage'` 解析会出现歧义。

### 2.1 拆分映射表

把原 `storage.ts` 里的所有顶层 export / 内部 helper 按下表搬到新文件：

| 原 storage.ts 标识符 | 新位置 |
|---|---|
| `SETTINGS_KEY` `DISCOVERED_KEY` `DiscoveredCache` `DiscoveredMap` `defaultSettings` `stripBulky` `readDiscoveredMap` `writeDiscoveredMap` `getSettings` `saveSettings` | `src/lib/storage/settings.ts` |
| `backupListeners` `onLocalDataChange` `notifyBackupSubscribers` | `src/lib/storage/events.ts` |
| `getUpdateSettings` `patchUpdateSettings` `saveUpdateResult` | `src/lib/storage/updates.ts` |
| `HISTORY_KEY` `HISTORY_DEDUP_FLAG` `HISTORY_LIMIT` `historyCache` `migrateItem` `syncHistoryCacheFromExternal` `isSameImage` `dedupHistoryByImage` `dedupRan` `maybeRunDedupMigration` `getHistory` `writeHistory` `addHistory` `clearHistory` `removeHistory` `removeHistoryItems` `patchHistoryItem` `getHistoryItem` + `chrome.storage.onChanged` 监听 | `src/lib/storage/history.ts` |
| `newVersionId` `appendPromptVersion` `restorePromptVersion` `removePromptVersion` | `src/lib/storage/versions.ts` |
| `BackupPayload` `buildBackup` `restoreBackup` | `src/lib/storage/backup.ts` |

依赖方向（避免循环依赖）：

```
settings.ts   → events.ts
history.ts    → events.ts
versions.ts   → history.ts (取/写 historyCache)
updates.ts    → settings.ts
backup.ts     → settings.ts + history.ts
index.ts (barrel) → 全部
```

### 2.2 创建 `src/lib/storage/events.ts`

```typescript
/**
 * 跨模块的"本地数据变更"事件中心。
 *
 * settings / history / versions 等任何对 chrome.storage 的写入都应调用
 * `notifyBackupSubscribers()`，让上层（fsBackup）能及时把全量数据同步到
 * 用户挑选的数据目录。
 */
const backupListeners = new Set<() => void>();

export function onLocalDataChange(listener: () => void): () => void {
  backupListeners.add(listener);
  return () => backupListeners.delete(listener);
}

export function notifyBackupSubscribers(): void {
  for (const l of backupListeners) {
    try {
      l();
    } catch (err) {
      console.debug('[PromptExtracto] backup listener failed', err);
    }
  }
}
```

### 2.3 创建 `src/lib/storage/settings.ts`

**直接从原 `src/lib/storage.ts` 的第 1~228 行的内容搬过来**，做以下调整：

1. 删除 `import type { HistoryItem, PromptVersion, PromptVersionSource, ... }`（这些只在 history.ts 用得到），只保留：

   ```typescript
   import type {
     AppSettings,
     ProviderId,
     UpdateCheckResult,
     UpdateSettings,
   } from '../types';
   import { PROVIDERS } from '../providers';
   import { DEFAULT_STRATEGY_ID } from '../strategies';
   import { DEFAULT_UPDATE_SETTINGS } from '../updater';
   import { notifyBackupSubscribers } from './events';
   ```

2. 删除原 `backupListeners` / `onLocalDataChange` / `notifyBackupSubscribers` 三个 export（已挪到 events.ts），但 `saveSettings` 里的 `void notifyBackupSubscribers();` 调用保留。

3. 保留并 `export` 这些标识符（其他被 history/versions/backup 引用的内部常量也要 export 出来供它们 import）：
   - `export const SETTINGS_KEY`
   - `export const DISCOVERED_KEY`
   - `export function getSettings`
   - `export function saveSettings`
   - `export async function getUpdateSettings` ← **挪到 updates.ts**，从这里删
   - `export async function patchUpdateSettings` ← 同上
   - `export async function saveUpdateResult` ← 同上

   即 settings.ts 最终只 export：`SETTINGS_KEY`、`DISCOVERED_KEY`、`getSettings`、`saveSettings`。其中 `SETTINGS_KEY` 被 backup.ts 用、`DISCOVERED_KEY` 被任何模块都不用（但放着对自包含有用）。

### 2.4 创建 `src/lib/storage/updates.ts`

```typescript
/**
 * 更新设置（自动检查更新）小帮助。
 * 这些函数只是 settings.updates 字段的便捷读/写。
 */
import type { UpdateCheckResult, UpdateSettings } from '../types';
import { getSettings, saveSettings } from './settings';

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const s = await getSettings();
  return s.updates;
}

export async function patchUpdateSettings(
  patch: Partial<UpdateSettings>
): Promise<UpdateSettings> {
  const s = await getSettings();
  const next: UpdateSettings = { ...s.updates, ...patch };
  await saveSettings({ ...s, updates: next });
  return next;
}

export async function saveUpdateResult(result: UpdateCheckResult): Promise<UpdateSettings> {
  return patchUpdateSettings({
    lastResult: result,
    lastCheckedAt: result.checkedAt,
  });
}
```

### 2.5 创建 `src/lib/storage/history.ts`

**从原 `src/lib/storage.ts` 的第 230~539 行搬过来**，做以下调整：

1. import 头改成：

   ```typescript
   import type { HistoryItem, PromptVersion } from '../types';
   import { notifyBackupSubscribers } from './events';
   ```

2. `migrateItem`、`historyCache`、`syncHistoryCacheFromExternal`、`isSameImage`、`dedupHistoryByImage`、`maybeRunDedupMigration`、`getHistory`、`writeHistory`、`addHistory`、`clearHistory`、`removeHistory`、`removeHistoryItems`、`patchHistoryItem`、`getHistoryItem` 全部保留。

3. 对 `versions.ts` 要复用的 `historyCache` / `migrateItem` / `writeHistory` 等，必须 `export` 出来。**最简单的做法**：把这三个改成 `export`：
   - `export let historyCache: HistoryItem[] | null = null;`
   - `export function migrateItem(...)`
   - `export async function writeHistory(...)`
   - `export const HISTORY_LIMIT = 300;`（backup.ts 也用得到）

4. 保留底部的 `try { chrome.storage?.onChanged?.addListener(...) }` 监听块——这个是模块加载副作用，必须随着 history 模块的 import 一起生效。

5. **重要**：原 `addHistory` 里调用了 `newVersionId`（注意原始代码确实在 addHistory 第 440 行 `id: incomingHead?.id || newVersionId()`）。`newVersionId` 我们挪到了 versions.ts，所以这里要 `import { newVersionId } from './versions';` —— 但这样会形成 history.ts ↔ versions.ts 的循环依赖。

   **解决方案**：把 `newVersionId` 重新挪到 history.ts，并 export 出来；versions.ts 再 `import { newVersionId } from './history';`。

   即：在 history.ts 文件底部追加：

   ```typescript
   export function newVersionId(): string {
     if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
       return crypto.randomUUID();
     }
     return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
   }
   ```

### 2.6 创建 `src/lib/storage/versions.ts`

```typescript
/**
 * 历史记录里"版本（PromptVersion）"层级的写操作。
 * 这些操作改的是单条 HistoryItem 里的 versions 数组与 prompt 字段。
 */
import type { HistoryItem, PromptVersion, PromptVersionSource } from '../types';
import { getHistory, writeHistory, newVersionId } from './history';

/**
 * 在 id 对应的历史项上追加一条新版本，并把当前 prompt 切到新版本。
 * 若新内容与当前内容完全一致，则不创建新版本，直接返回原项。
 */
export async function appendPromptVersion(
  id: string,
  prompt: string,
  source: PromptVersionSource = 'edited',
  note?: string,
  meta?: PromptVersion['meta']
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const item = list[idx];
  const trimmed = prompt.replace(/\s+$/g, '');
  if (trimmed === item.prompt.replace(/\s+$/g, '')) return item;
  const version: PromptVersion = {
    id: newVersionId(),
    prompt: trimmed,
    createdAt: Date.now(),
    source,
    note,
    meta,
  };
  const updated: HistoryItem = {
    ...item,
    prompt: trimmed,
    updatedAt: version.createdAt,
    ...(meta
      ? { provider: meta.provider, model: meta.model, style: meta.style }
      : {}),
    versions: [version, ...(item.versions || [])],
  };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

export async function restorePromptVersion(
  id: string,
  versionId: string
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const item = list[idx];
  const target = item.versions.find((v) => v.id === versionId);
  if (!target) return null;
  if (target.prompt === item.prompt) return item;
  const version: PromptVersion = {
    id: newVersionId(),
    prompt: target.prompt,
    createdAt: Date.now(),
    source: 'restored',
    note: `restored from ${new Date(target.createdAt).toLocaleString()}`,
  };
  const updated: HistoryItem = {
    ...item,
    prompt: target.prompt,
    updatedAt: version.createdAt,
    versions: [version, ...item.versions],
  };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}

/**
 * 删除某条记录中的某个历史版本。
 * - 不允许删除"当前版本"（即 `versions[0]`），传当前版本 id 时原样返回。
 * - 不允许删到 0 条版本：至少保留 1 条。
 */
export async function removePromptVersion(
  itemId: string,
  versionId: string
): Promise<HistoryItem | null> {
  const list = await getHistory();
  const idx = list.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  const item = list[idx];
  if (!item.versions || item.versions.length <= 1) return item;
  if (item.versions[0]?.id === versionId) return item;
  const next = item.versions.filter((v) => v.id !== versionId);
  if (next.length === item.versions.length) return item;
  const updated: HistoryItem = { ...item, versions: next };
  list[idx] = updated;
  await writeHistory(list);
  return updated;
}
```

### 2.7 创建 `src/lib/storage/backup.ts`

```typescript
/**
 * 全量备份 / 恢复。把 settings + history 序列化为一份 JSON 文件，
 * 反过来也能从 JSON 把整个扩展的数据还原回 chrome.storage。
 */
import type { AppSettings, HistoryItem } from '../types';
import { getSettings, saveSettings } from './settings';
import { getHistory, writeHistory, migrateItem, HISTORY_LIMIT } from './history';

export interface BackupPayload {
  /** 备份文件格式版本，递增；当前 1。 */
  version: 1;
  /** 备份生成时间 ISO 字符串，便于人眼判断新旧。 */
  exportedAt: string;
  /** 生成备份的扩展版本，便于排查。 */
  appVersion?: string;
  settings: AppSettings;
  history: HistoryItem[];
}

export async function buildBackup(appVersion?: string): Promise<BackupPayload> {
  const [settings, history] = await Promise.all([getSettings(), getHistory()]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    settings,
    history,
  };
}

/**
 * 从备份载荷恢复。
 *
 * @param payload 备份内容
 * @param mode    'replace' 直接覆盖；'merge' 与现有数据合并（按 id 去重，保留较新的 updatedAt）
 */
export async function restoreBackup(
  payload: BackupPayload,
  mode: 'replace' | 'merge' = 'merge'
): Promise<{ settingsRestored: boolean; historyAdded: number; historyTotal: number }> {
  if (!payload || payload.version !== 1) {
    throw new Error('不支持的备份格式');
  }
  let settingsRestored = false;
  if (payload.settings) {
    await saveSettings(payload.settings);
    settingsRestored = true;
  }

  let added = 0;
  if (Array.isArray(payload.history)) {
    if (mode === 'replace') {
      const next = payload.history.slice(0, HISTORY_LIMIT).map(migrateItem);
      await writeHistory(next);
      added = next.length;
    } else {
      const current = await getHistory();
      const byId = new Map(current.map((i) => [i.id, i] as const));
      for (const incoming of payload.history) {
        const item = migrateItem(incoming);
        const exist = byId.get(item.id);
        if (!exist) {
          byId.set(item.id, item);
          added++;
        } else {
          const newer =
            (item.updatedAt || item.createdAt || 0) >= (exist.updatedAt || exist.createdAt || 0)
              ? item
              : exist;
          const older = newer === item ? exist : item;
          const seen = new Set(newer.versions.map((v) => v.id));
          const mergedVersions = [...newer.versions];
          for (const v of older.versions) {
            if (!seen.has(v.id)) mergedVersions.push(v);
          }
          byId.set(item.id, { ...newer, versions: mergedVersions });
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
      );
      if (merged.length > HISTORY_LIMIT) merged.length = HISTORY_LIMIT;
      await writeHistory(merged);
    }
  }
  const total = (await getHistory()).length;
  return { settingsRestored, historyAdded: added, historyTotal: total };
}
```

### 2.8 创建 `src/lib/storage/index.ts`（barrel）

```typescript
/**
 * @/lib/storage 的对外门面（barrel）。
 *
 * 历史上整个 storage 实现都堆在 src/lib/storage.ts。重构后按职责拆到子模块。
 * 业务代码继续 `import { getSettings, addHistory, ... } from '@/lib/storage'` 即可。
 */
export { getSettings, saveSettings } from './settings';
export { getUpdateSettings, patchUpdateSettings, saveUpdateResult } from './updates';
export {
  getHistory,
  addHistory,
  clearHistory,
  removeHistory,
  removeHistoryItems,
  patchHistoryItem,
  getHistoryItem,
} from './history';
export {
  appendPromptVersion,
  restorePromptVersion,
  removePromptVersion,
} from './versions';
export { onLocalDataChange } from './events';
export { buildBackup, restoreBackup, type BackupPayload } from './backup';
```

### 2.9 删除老文件

执行：

```
Delete d:\code\Code Experiment\Prompt extraction\src\lib\storage.ts
```

（必须删，否则 `'@/lib/storage'` 解析会出现 `storage.ts` vs `storage/index.ts` 二义性，行为不确定。）

### 2.10 验证 Phase 2

```powershell
npm run lint
```

**期望 0 error**。常见错误及处置：

- `'historyCache' is declared but its value is never read` → 在 history.ts 顶部加 `// eslint-disable-next-line` 或直接保留 export（versions.ts 用得到）
- `Module not found './history'` → 检查 versions.ts / backup.ts 的相对路径
- `Property 'newVersionId' does not exist` → 确认 history.ts 末尾 export 了 `newVersionId`

通过后把 todo `p2` / `p2-verify` 标 completed。

---

## Phase 3：拆分 `src/content/panel.ts`

> 原文件 1219 行，含约 400 行 CSS 字符串。目标按以下结构拆：
>
> ```
> src/content/panel/
> ├── index.ts        ← renderPanel / updatePanel / closePanel（公开 API）
> ├── state.ts        ← PanelState 类型 + 模块单例 host/panel/shadow/currentState/loadingTickHandle
> ├── styles.ts       ← 大块 CSS 字符串
> ├── icons.ts        ← ICON_CLOSE / ICON_COPY ... 8 个 SVG 常量
> ├── templates.ts    ← panelHtml / versionItemHtml / sourceLabel / escape* / SUGGESTIONS
> ├── loading.ts      ← stageLabel / stageHint / stageProgress / applyLoadingPatch / manageLoadingTicker / stopLoadingTicker / formatElapsed / strategyLabel / STRATEGY_LABEL
> └── events.ts       ← bindEvents（所有 click handler）+ syncVersions + updateDirtyChrome + flashCopied / fallbackCopy / formatTime
> ```

### 3.1 创建 `src/content/panel/styles.ts`

```typescript
/**
 * 注入到 Shadow DOM 的样式表。原本作为单一字符串内联在 panel.ts 里，
 * 拆出来后让 IDE 能正常给 CSS 高亮，未来也方便接 PostCSS。
 *
 * 注意：这是字符串常量，不是 .css 文件——content script 必须把它通过
 * <style>.textContent 注入到 Shadow Root，不能依赖 vite 的 CSS import。
 */
export const STYLE = `
... ← 把原 panel.ts 第 806~1218 行（即 const STYLE = `...` 的反引号之间的内容）原样搬过来
`;
```

执行步骤：
1. `Read d:\code\Code Experiment\Prompt extraction\src\content\panel.ts` offset=806 limit=420，拿到完整 CSS 字符串
2. 用 `Write` 写入 `src/content/panel/styles.ts`，反引号内容原样照抄

### 3.2 创建 `src/content/panel/icons.ts`

把原 `panel.ts` 第 797~804 行的 8 个 `const ICON_* = ...` 全部 `export const` 出来。

```typescript
/** 面板里用到的 8 个 SVG 图标常量。每个都是 currentColor 描边，方便随 .panel 颜色继承。 */
export const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
export const ICON_COPY = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
export const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
export const ICON_SAVE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
export const ICON_HISTORY = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><polyline points="12 7 12 12 15 14"/></svg>`;
export const ICON_RESTORE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
export const ICON_EDIT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
export const ICON_SPARK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>`;
```

### 3.3 创建 `src/content/panel/state.ts`

```typescript
/**
 * 浮动面板的运行时状态。
 *
 * 这些是 content script 模块内的单例状态：
 * - host / shadow / panel：DOM 节点引用
 * - currentState：当前面板状态快照
 * - loadingTickHandle：loading 状态下"已用时"刷新的 setInterval 句柄
 *
 * 使用 `export let` + 显式 setter 函数模式，
 * 让所有子模块都能读到同一份单例，避免重复挂载 Shadow DOM。
 */
import type { ExtractStage, PromptVersion, StrategyId } from '@/lib/types';

export interface PanelState {
  requestId: string;
  imageUrl: string;
  status: 'loading' | 'success' | 'error';
  prompt?: string;
  error?: string;
  provider?: string;
  model?: string;
  versions?: PromptVersion[];
  versionsOpen?: boolean;
  draft?: string;
  refineOpen?: boolean;
  refineLoading?: boolean;
  refineError?: string;
  refineInstruction?: string;
  stage?: ExtractStage;
  partial?: string;
  startedAt?: number;
  strategy?: StrategyId;
}

export const HOST_ID = '__image_prompt_extractor_host__';

export let host: HTMLDivElement | null = null;
export let shadow: ShadowRoot | null = null;
export let panel: HTMLDivElement | null = null;
export let currentState: PanelState | null = null;
export let loadingTickHandle: number | null = null;

export function setHost(v: HTMLDivElement | null) {
  host = v;
}
export function setShadow(v: ShadowRoot | null) {
  shadow = v;
}
export function setPanel(v: HTMLDivElement | null) {
  panel = v;
}
export function setCurrentState(v: PanelState | null) {
  currentState = v;
}
export function setLoadingTickHandle(v: number | null) {
  loadingTickHandle = v;
}
```

### 3.4 创建 `src/content/panel/loading.ts`

把原 `panel.ts` 第 64~265 行（`STRATEGY_LABEL` / `strategyLabel` / `manageLoadingTicker` / `stopLoadingTicker` / `formatElapsed` / `stageLabel` / `stageProgress` / `stageHint` / `applyLoadingPatch`）全部搬过来。需要 export 出去的：
- `STRATEGY_LABEL` `strategyLabel`
- `manageLoadingTicker` `stopLoadingTicker`
- `formatElapsed`
- `stageLabel` `stageProgress` `stageHint`
- `applyLoadingPatch`

import 头：

```typescript
import type { ExtractStage, StrategyId } from '@/lib/types';
import { panel, currentState, loadingTickHandle, setLoadingTickHandle } from './state';
import type { PanelState } from './state';
```

注意 `manageLoadingTicker` 里访问 `loadingTickHandle = window.setInterval(...)` 这样的赋值，**必须改成**通过 setter：

```typescript
setLoadingTickHandle(window.setInterval(() => { ... }, 200));
// 以及
setLoadingTickHandle(null);
```

### 3.5 创建 `src/content/panel/templates.ts`

把原 `panel.ts` 第 285~505 行的 `panelHtml` / `SUGGESTIONS` / `versionItemHtml` / `sourceLabel` / `escapeText` / `escapeAttr` 搬过来。export 出来的：
- `panelHtml`
- `escapeText` / `escapeAttr`（events.ts / loading.ts 用得到）

import 头：

```typescript
import type { PromptVersion, PromptVersionSource } from '@/lib/types';
import type { PanelState } from './state';
import {
  ICON_CLOSE, ICON_COPY, ICON_REFRESH, ICON_SAVE,
  ICON_HISTORY, ICON_RESTORE, ICON_EDIT, ICON_SPARK,
} from './icons';
import {
  stageLabel, stageHint, stageProgress, formatElapsed, strategyLabel,
} from './loading';
```

### 3.6 创建 `src/content/panel/events.ts`

把原 `panel.ts` 第 267~283 行的 `syncVersions`，第 507~727 行的 `bindEvents`，第 729~775 行的 `updateDirtyChrome` / `flashCopied` / `fallbackCopy`，第 777~788 行的 `formatTime` 全部搬过来。export 出来的：
- `bindEvents`
- `syncVersions`

import 头：

```typescript
import { appendPromptVersion, getHistoryItem, restorePromptVersion } from '@/lib/storage';
import type { RefineResponse } from '@/lib/types';
import { currentState, setCurrentState, panel } from './state';
import { renderPanel, closePanel } from './index';
```

> 这里 events.ts 反向 import 了 index.ts 的 `renderPanel` / `closePanel`，会形成 events ↔ index 的循环。但 TypeScript / Vite 都能正确处理"函数引用"的循环（运行期赋值后才被调用），不需要担心。

### 3.7 创建 `src/content/panel/index.ts`（公开 API）

```typescript
/**
 * 浮动面板对外的 3 个公开 API：renderPanel / updatePanel / closePanel。
 * 这是 src/content/index.ts 唯一引用到的入口。
 */
import { STYLE } from './styles';
import {
  HOST_ID,
  host,
  shadow,
  panel,
  currentState,
  setHost,
  setShadow,
  setPanel,
  setCurrentState,
  type PanelState,
} from './state';
import {
  manageLoadingTicker,
  stopLoadingTicker,
  applyLoadingPatch,
} from './loading';
import { panelHtml } from './templates';
import { bindEvents, syncVersions } from './events';

function ensureHost(): { host: HTMLDivElement; shadow: ShadowRoot } {
  if (host && shadow) return { host, shadow };
  const h = document.createElement('div');
  h.id = HOST_ID;
  h.style.cssText = `
    position: fixed; inset: 0;
    z-index: 2147483647; width: 0; height: 0;
    color-scheme: light dark;
  `;
  const s = h.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  s.appendChild(style);
  document.documentElement.appendChild(h);
  setHost(h);
  setShadow(s);
  return { host: h, shadow: s };
}

export function renderPanel(state: PanelState): void {
  const { shadow } = ensureHost();
  setCurrentState(state);
  if (panel) panel.remove();
  const next = document.createElement('div');
  next.className = 'panel';
  next.innerHTML = panelHtml(state);
  shadow.appendChild(next);
  setPanel(next);
  bindEvents(next);
  manageLoadingTicker(state);
}

export function updatePanel(requestId: string, patch: Partial<PanelState>): void {
  if (!currentState || currentState.requestId !== requestId) return;
  const prev = currentState;
  const merged = { ...prev, ...patch } as PanelState;
  setCurrentState(merged);

  if (patch.status === 'success') {
    void syncVersions(requestId);
  }

  const lightUpdate =
    prev.status === 'loading' &&
    merged.status === 'loading' &&
    patch.status === undefined &&
    (patch.stage !== undefined ||
      patch.partial !== undefined ||
      patch.strategy !== undefined);

  if (lightUpdate && panel) {
    applyLoadingPatch(merged);
    manageLoadingTicker(merged);
    return;
  }
  renderPanel(merged);
}

export function closePanel(): void {
  stopLoadingTicker();
  if (panel) {
    panel.remove();
    setPanel(null);
  }
  setCurrentState(null);
}
```

### 3.8 处理 `src/content/index.ts` 的 import

`src/content/index.ts` 第 2 行：
```typescript
import { renderPanel, updatePanel, closePanel } from './panel';
```

由于我们把 `panel.ts` 替换成了 `panel/` 目录，**TypeScript 会自动解析到 `panel/index.ts`，不需要改这一行**。验证方法：执行 lint 看是否成功。

### 3.9 删除老文件

```
Delete d:\code\Code Experiment\Prompt extraction\src\content\panel.ts
```

### 3.10 验证 Phase 3

```powershell
npm run lint
```

**期望 0 error**。

常见错误：
- `Cannot find name 'host'` 这类 → 是因为 state.ts 里的 `export let` 模式在另一个模块里只能读到导入时的值快照，不会跟着 setter 更新。**解决**：所有需要读最新值的地方，改成调用一个 getter 函数。

  但 TypeScript / ESM 实际上对 `export let` + setter 的支持是**符合预期**的——重新 `import { host } from './state'` 会读到最新值。只要保证**写操作走 setter**、**读操作直接 import 变量名**，就能工作。

- 若仍出现 stale-value 问题，可以把 state.ts 的所有变量改写成 `state.host = ...` 形式：

  ```typescript
  // state.ts
  export const state = {
    host: null as HTMLDivElement | null,
    shadow: null as ShadowRoot | null,
    panel: null as HTMLDivElement | null,
    currentState: null as PanelState | null,
    loadingTickHandle: null as number | null,
  };
  ```

  然后所有引用方改成 `state.host` / `state.host = ...`。这是更保险的写法，但需要在 events.ts / loading.ts / index.ts 都对应改。**如果第一种写法 lint 不过，强制走这条路。**

通过后把 todo `p3` / `p3-verify` 标 completed。

---

## Phase 4：拆分 React 组件

### 4a：先抽共享组件到 `src/options/_shared/`

PopupApp.tsx 和 PromptLibrary.tsx 各自实现了 `VersionList` / `SourceTag` / `RefineForm` / `formatTime`。这些**不要直接复用**（两者交互细节不一样，强行合并会更乱），但其中纯展示的 `SourceTag` 和工具 `formatTime` 是值得共用的。

#### 4a.1 创建 `src/options/_shared/time.ts`

```typescript
/** 把时间戳格式化成"刚刚 / X 分钟前 / X 小时前 / MM/DD HH:MM"。 */
export function formatTime(t: number): string {
  const d = new Date(t);
  const now = Date.now();
  const diff = now - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}
```

#### 4a.2 在 `PopupApp.tsx` 中替换

用 `StrReplace` 把原 PopupApp.tsx 第 579 行起的 `function formatTime(t: number): string { ... }` **整段删除**（包括函数体），然后在 import 区追加：

```typescript
import { formatTime } from '../options/_shared/time';
```

> 验证：搜确认 PopupApp 里所有 `formatTime` 调用都还能解析。

#### 4a.3 在 `PromptLibrary.tsx` 中替换

同样删掉 `function formatTime(t: number): string {...}`（在最后一段，第 1728 行附近），import：

```typescript
import { formatTime } from './_shared/time';
```

**注意**：Phase 4b 拆完后 PromptLibrary 变成目录，路径会变成 `'../_shared/time'`，到那时再改。

#### 4a.4 验证 Phase 4a

```powershell
npm run lint
```

通过后标 todo `p4-shared` completed。

---

### 4b：拆分 `PromptLibrary.tsx`（最大一块）

> 原文件 1736 行，目标结构：
>
> ```
> src/options/PromptLibrary/
> ├── index.tsx              ← 默认导出 PromptLibrary 主组件
> ├── types.ts               ← SortKey / ViewMode / ExpandedTab + REFINE_SUGGESTIONS + VIEW_STORAGE_KEY
> ├── ItemRow.tsx            ← function ItemRow (782行起)
> ├── ItemGridCard.tsx       ← function ItemGridCard (928行起)
> ├── IconBtn.tsx            ← function IconBtn (1037行起)
> ├── Thumb.tsx              ← function Thumb (1072行起)
> ├── ExpandedPanel.tsx      ← function ExpandedPanel + TabBar (1106 + 1219行起)
> ├── tabs/
> │   ├── EditorTab.tsx      ← function EditorTab (1284行起)
> │   ├── VersionsTab.tsx    ← function VersionsTab (1374行起)
> │   ├── MetaTab.tsx        ← function MetaTab + MetaRow (1482 + 1519行起)
> │   └── RefineInline.tsx   ← function RefineInline (1528行起)
> ├── SourceTag.tsx          ← function SourceTag (1601行起)
> ├── parts/
> │   ├── StatCard.tsx       ← STAT_TONE + function StatCard (657 + 679行起)
> │   ├── ViewToggle.tsx     ← function ViewToggle (708行起)
> │   ├── FilterGroup.tsx    ← function FilterGroup (739行起)
> │   ├── BulkActionBar.tsx  ← function BulkActionBar (1664行起)
> │   ├── EmptyState.tsx     ← function EmptyState (1626行起)
> │   └── NoMatchState.tsx   ← function NoMatchState (1642行起)
> ```

#### 4b.1 创建 `src/options/PromptLibrary/` 目录的所有文件

执行步骤（建议按依赖从底到顶）：

1. **types.ts**：

   ```typescript
   export type SortKey = 'updated' | 'created' | 'versions';
   export type ViewMode = 'list' | 'grid';
   export type ExpandedTab = 'editor' | 'versions' | 'refine' | 'meta';

   export const REFINE_SUGGESTIONS = [
     '翻译成英文',
     '翻译成中文',
     '改得更电影感',
     '加上 8k, masterpiece, best quality',
     '删掉色调描述',
     '改成 SD tag 格式',
     '精简成不超过 30 字',
   ];

   export const VIEW_STORAGE_KEY = 'prompt_library_view_v1';
   ```

2. 对**每一个**子组件文件：
   - 用 `Read` 读 PromptLibrary.tsx 对应行号范围
   - 用 `Write` 写到目标新文件
   - 文件顶部 `import` 区要补齐：
     - React 钩子（`useEffect / useMemo / useState`）按需
     - `lucide-react` 图标按需（**只 import 实际用到的**，避免重复 import 整张图标表）
     - `HistoryItem / PromptVersion / PromptVersionSource / RefineResponse` 类型从 `@/lib/types`
     - storage 函数（`appendPromptVersion / restorePromptVersion / removePromptVersion / patchHistoryItem / ...`）从 `@/lib/storage`
     - 共享：`formatTime` 从 `'../_shared/time'`
     - 子组件之间互相 import 用相对路径

3. **逐个验证**：每写完 2~3 个文件就跑一次 `npm run lint`，发现 import 缺失立刻修。**不要等全部写完才 lint，错误堆叠会很难定位。**

#### 4b.2 重写 `PromptLibrary/index.tsx`（主组件）

把原 PromptLibrary.tsx 第 1~654 行（`export default function PromptLibrary()` 整个函数体 + 顶部常量）搬过来，做以下调整：

1. 删掉文件中所有已经搬到子文件的 function（StatCard / ViewToggle / FilterGroup / ItemRow / ItemGridCard / IconBtn / Thumb / ExpandedPanel / TabBar / EditorTab / VersionsTab / MetaTab / MetaRow / RefineInline / SourceTag / EmptyState / NoMatchState / BulkActionBar / formatTime / STAT_TONE）。

2. 顶部 import 区改成相对子文件 + 共享：

   ```typescript
   import { useEffect, useMemo, useState } from 'react';
   import { /* lucide-react 主组件实际用到的图标 */ } from 'lucide-react';
   import {
     clearHistory,
     getHistory,
     patchHistoryItem,
     removeHistory,
     removeHistoryItems,
   } from '@/lib/storage';
   import type { HistoryItem } from '@/lib/types';
   import { type SortKey, type ViewMode, VIEW_STORAGE_KEY } from './types';
   import { ItemRow } from './ItemRow';
   import { ItemGridCard } from './ItemGridCard';
   import { ExpandedPanel } from './ExpandedPanel';
   import { StatCard } from './parts/StatCard';
   import { ViewToggle } from './parts/ViewToggle';
   import { FilterGroup } from './parts/FilterGroup';
   import { BulkActionBar } from './parts/BulkActionBar';
   import { EmptyState } from './parts/EmptyState';
   import { NoMatchState } from './parts/NoMatchState';
   ```

3. 主组件改 export 方式：原文件用的是 `export default function PromptLibrary()`，新 index.tsx **依然必须保持 default export**，因为 `OptionsApp.tsx` 第 4 行是 `import PromptLibrary from './PromptLibrary';`，会自动解析到 `./PromptLibrary/index.tsx` 的 default。

#### 4b.3 删除老文件

```
Delete d:\code\Code Experiment\Prompt extraction\src\options\PromptLibrary.tsx
```

#### 4b.4 修 PopupApp 的 import 路径（如有）

如果 4a.3 步骤用的是 `'./_shared/time'`，因为 PopupApp 在 `src/popup/`，正确路径应该是 `'../options/_shared/time'`。检查一遍。

#### 4b.5 验证 Phase 4b

```powershell
npm run lint
```

通过后标 todo `p4-library` / `p4-verify` completed。

---

## 5. 最终验证

```powershell
cd "d:\code\Code Experiment\Prompt extraction"
Remove-Item -Recurse -Force dist
npm run build
```

**期望**：
- 退出码 0
- `dist/` 下生成完整的扩展产物（含 `src/background/index.ts` 编译产物、`src/content/index.ts` 编译产物、`src/options/index.html`、`src/popup/index.html`、`icons/*`）

**手工冒烟（可选）**：
- 在 `chrome://extensions/` 加载 `dist/` 目录
- 右键任意图片 → 选「提取图片提示词」 → 看面板能否正常出现 + 流式接收
- 打开 Options 页 → 切到「提示词库」→ 能看到历史记录
- Popup → 看版本列表能展开

把 todo `final-build` 标 completed。完工。

---

## 6. 紧急回滚

如果某个 Phase 的 lint 一直过不去且短时间内修不完：

```powershell
git status
git restore .   # 丢弃所有未 commit 改动
```

回到上一个干净状态。**强烈建议每完成一个 Phase 就 `git add -A && git commit -m "refactor: phase N done"`**，不要把 4 个 Phase 全堆在一个 commit 里。

---

## 附录 A：本次重构**不会**改动的文件清单

| 文件 | 原因 |
|---|---|
| `vite.config.ts` | `minify: false` / sourcemap 是有意配置 |
| `tsconfig.json` | 路径别名已经够用 |
| `package.json` | scripts 不需要改 |
| `src/manifest.config.ts` | background / content / popup / options 入口路径不变 |
| `src/lib/types.ts` | 已经是纯类型文件，足够清晰 |
| `src/lib/strategies.ts` | 单一职责清晰 |
| `src/lib/providers.ts` | 单一职责清晰 |
| `src/lib/image.ts` | 13KB 但单一职责，函数粒度合理 |
| `src/lib/idb.ts` `src/lib/version.ts` `src/lib/updater.ts` `src/lib/fsBackup.ts` | 都 ≤10KB 单一职责 |
| `src/options/SetupGuide.tsx` `src/options/DataPersistence.tsx` `src/options/SettingsView.tsx` | 视情况，本轮可不拆（如果未来这几个文件继续膨胀再开下一轮 Phase） |
| `src/popup/PopupApp.tsx` | 24KB 在可接受范围。本轮只抽走 formatTime |
| `public/` `scripts/` 所有内容 | 与构建无关 |

## 附录 B：常用调试命令

```powershell
# 只看 TS 类型错误
npm run lint

# 完整 build
npm run build

# 看 dist 里哪些文件
Get-ChildItem -Recurse dist | Select-Object FullName, Length

# 搜某个标识符是否还有人引用
rg --files-with-matches "extractPrompt" src
```
