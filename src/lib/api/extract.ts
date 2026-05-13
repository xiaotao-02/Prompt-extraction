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
