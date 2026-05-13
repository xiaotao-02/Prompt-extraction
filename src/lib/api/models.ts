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
