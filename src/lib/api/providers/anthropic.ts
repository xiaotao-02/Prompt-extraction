/**
 * Anthropic Claude Messages API。
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
import { trimSlash } from '../url';
import { safeProgress, type ExtractProgressFn } from '../types';

export async function callAnthropic(
  cfg: ProviderConfig,
  img: FetchedImage,
  instruction: string,
  strategy: PromptStrategy,
  onProgress?: ExtractProgressFn
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

/** Claude 的纯文本（refine）通道。非流式，max_tokens 固定 1024。 */
export async function callAnthropicText(
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
