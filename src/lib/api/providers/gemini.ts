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
import {
  safeProgress,
  safeRefineProgress,
  type ExtractProgressFn,
  type RefineProgressFn,
} from '../types';

export async function callGemini(
  cfg: ProviderConfig,
  imgs: FetchedImage[],
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractProgressFn
): Promise<string> {
  // Gemini 的流式端点是独立 path：:streamGenerateContent?alt=sse
  // 加 alt=sse 才会真正以 SSE 推送，否则会拼成一个 JSON 数组一次性返回。
  const url = `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
    cfg.model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;
  const parts: Array<
    { text: string } | { inline_data: { mime_type: string; data: string } }
  > = [{ text: instruction }];
  for (const img of imgs) {
    parts.push({
      inline_data: {
        mime_type: img.mediaType,
        data: img.base64,
      },
    });
  }
  const body = {
    contents: [
      {
        role: 'user',
        parts,
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

/**
 * Gemini 的纯文本（refine）通道。
 *
 * onProgress 传入时切到 :streamGenerateContent?alt=sse 走 SSE 流式累积；
 * 不传时走经典 :generateContent 一把拿全文。
 */
export async function callGeminiText(
  cfg: ProviderConfig,
  system: string,
  user: string,
  onProgress?: RefineProgressFn
): Promise<string> {
  const stream = !!onProgress;
  // Gemini 的流式与非流式是两个不同 endpoint：streamGenerateContent?alt=sse vs generateContent。
  // 这里按 onProgress 是否传入决定走哪条；未传入时保持老的非流式路径不变。
  const finalUrl = stream
    ? `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
        cfg.model
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`
    : `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (stream) headers.Accept = 'text/event-stream';
  const resp = await fetch(finalUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(await describeRespFailure(resp, 'Gemini'));
  }

  if (!stream || !isSseResponse(resp)) {
    const json = await parseJsonResponse<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(resp, 'Gemini');
    const parts = json?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new Error('Gemini 返回内容异常');
    return parts.map((p: { text?: string }) => p.text || '').join('');
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
  if (!acc) throw new Error('Gemini 返回内容为空');
  safeRefineProgress(onProgress, { stage: 'streaming', partial: acc });
  return acc;
}
