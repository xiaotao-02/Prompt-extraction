/**
 * OpenAI Chat Completions 兼容协议。
 *
 * 覆盖：OpenAI 官方、智谱 GLM、通义 Qwen-VL、SiliconFlow、数科隆达、自定义。
 * 三家协议里它最常用，所以同时提供「视觉反推（流式）」和「文本 refine（非流式）」两个调用方式。
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
} from '../http';
import { normalizeOpenAIBase } from '../url';
import {
  safeProgress,
  safeRefineProgress,
  type ExtractProgressFn,
  type RefineProgressFn,
} from '../types';

export async function callOpenAICompatible(
  cfg: ProviderConfig,
  imgs: FetchedImage[],
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractProgressFn
): Promise<string> {
  // 大部分兼容 OpenAI 的服务端都接受 url 形式的 image_url，
  // 但跨域 + 鉴权 + base64 更稳妥，这里统一转 base64。
  const url = `${normalizeOpenAIBase(cfg.baseUrl)}/chat/completions`;

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: instruction }];
  for (const img of imgs) {
    content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }

  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content,
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

/**
 * OpenAI 兼容协议的「纯文本」调用（用于 refine 链路）。
 *
 * 与 callOpenAICompatible 区别：
 *   - 不带 image_url
 *   - temperature 固定 0.7，强度无关 strategy（refine 的"调子"由 prompt 控制）
 *
 * onProgress 传入时启用流式（stream:true，SSE 累积），否则保持老的非流式行为。
 * 这样 popup / options 那种"无 panel"调用方继续按非流式跑，content panel 走流式
 * 体验进度条 + 实时回显。
 */
export async function callOpenAICompatibleText(
  cfg: ProviderConfig,
  system: string,
  user: string,
  onProgress?: RefineProgressFn
): Promise<string> {
  const url = `${normalizeOpenAIBase(cfg.baseUrl)}/chat/completions`;
  const stream = !!onProgress;
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 1024,
    stream,
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (stream) headers.Accept = 'text/event-stream';
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'API'));
  }

  // 非流式 / 中转节点忽略 stream:true 的退化场景：直接 JSON 解析。
  if (!stream || !isSseResponse(resp)) {
    const json = await parseJsonResponse<{
      choices?: Array<{
        message?: { content?: string | Array<{ type?: string; text?: string }> };
      }>;
    }>(resp, 'API');
    const content = json?.choices?.[0]?.message?.content;
    const final = extractOpenAIContent(content);
    if (!final) throw new Error('返回内容为空');
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
      safeRefineProgress(onProgress, { stage: 'streaming', partial: acc });
      lastFlushAt = Date.now();
      continue;
    }
    const now = Date.now();
    if (now - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
      lastFlushAt = now;
      safeRefineProgress(onProgress, { stage: 'streaming', partial: acc });
    }
  }
  if (!acc) throw new Error('返回内容为空');
  safeRefineProgress(onProgress, { stage: 'streaming', partial: acc });
  return acc;
}

/**
 * 把 OpenAI 风格的 message.content 字段（可能是字符串或多模态数组）拍平成字符串。
 *
 * 一些中转节点会把 content 改成 `[{type:'text',text:'…'}]` 的形式，
 * 直接用 `String(content)` 会得到 `[object Object]`。
 */
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
