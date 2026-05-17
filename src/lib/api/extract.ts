/**
 * 视觉反推主入口：根据 settings.activeProvider 路由到具体 provider 实现，
 * 并负责"图片就绪 → 调用模型 → 流式回传"的阶段调度。
 */
import type { AppSettings, ExtractFocus } from '../types';
import { fetchImageAsBase64 } from '../image';
import { normalizeReferenceList } from '../referenceImages';
import { getStrategy, resolveCustomStrategy, type PromptStrategy } from '../strategies';
import { callOpenAICompatible } from './providers/openai';
import { callAnthropic } from './providers/anthropic';
import { callGemini } from './providers/gemini';
import {
  safeProgress,
  type ExtractParams,
  type ExtractResult,
} from './types';

const MULTI_IMAGE_INSTRUCTION_NOTE =
  '\n\n（以上指令之后）请综合理解本消息中的多张参考图，输出一条完整、连贯的提示词；不要分开描述每张图。';

const EXTRACT_FOCUS_MATERIAL_NOTE =
  '\n\n【本次任务限定】请仅从画面中抽取「材质与表面质感」相关表述（如金属/织物/皮革/玻璃/陶瓷/皮肤/毛发等的肌理、粗糙度、软硬、厚薄、反光与高光、次表面散射、磨损与污渍等）。弱化主体身份、具体物象叙事与构图摆布；不要复述整张图的内容简介。输出必须严格遵守上文约定的格式（语种与条目样式勿偏离指引）。';

const EXTRACT_FOCUS_STYLE_NOTE =
  '\n\n【本次任务限定】请仅从画面中抽取「画面风格与艺术呈现」相关表述（如画风流派或媒介质感、笔触/渲染手法、整体调色与对比、光影气氛、景深与镜头语言、构图张力或板式气质等）。弱化具体物体身份与故事情节复述；不要写成整张图的说明文。输出必须严格遵守上文约定的格式（语种与条目样式勿偏离指引）。';

function appendExtractFocusInstruction(instruction: string, focus: ExtractFocus | undefined): string {
  if (!focus) return instruction;
  if (focus === 'material') return instruction + EXTRACT_FOCUS_MATERIAL_NOTE;
  return instruction + EXTRACT_FOCUS_STYLE_NOTE;
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
  const { imageUrls: rawUrls, settings, prefetched, onProgress, extractFocus } = params;
  const imageUrls = normalizeReferenceList(rawUrls);
  if (imageUrls.length === 0) {
    throw new Error('没有可用的参考图');
  }
  const providerId = settings.activeProvider;
  const cfg = settings.providers[providerId];
  if (!cfg.apiKey) {
    throw new Error(`请先在「设置」中为 ${providerId} 配置 API Key`);
  }
  const strategy =
    settings.promptStrategy === 'custom' && settings.customComponents
      ? resolveCustomStrategy(settings.customComponents, {
          instruction: settings.customInstruction || undefined,
          temperature: settings.customTemperature,
          maxTokens: settings.customMaxTokens,
        })
      : getStrategy(settings.promptStrategy);
  let instruction = buildInstruction(settings, strategy);
  if (imageUrls.length > 1) {
    instruction += MULTI_IMAGE_INSTRUCTION_NOTE;
  }
  instruction = appendExtractFocusInstruction(instruction, extractFocus);

  let imgs;
  if (
    prefetched &&
    prefetched.length === imageUrls.length
  ) {
    imgs = prefetched;
  } else {
    safeProgress(onProgress, { stage: 'fetching' });
    imgs = await Promise.all(imageUrls.map((u) => fetchImageAsBase64(u)));
  }

  safeProgress(onProgress, { stage: 'calling' });

  let prompt: string;
  switch (providerId) {
    case 'anthropic':
      prompt = await callAnthropic(cfg, imgs, instruction, strategy, onProgress);
      break;
    case 'gemini':
      prompt = await callGemini(cfg, imgs, instruction, strategy, onProgress);
      break;
    case 'openai':
    case 'zhipu':
    case 'qwen':
    case 'siliconflow':
    case 'deepseek':
    case 'moonshot':
    case 'doubao':
    case 'stepfun':
    case 'minimax':
    case 'yi':
    case 'baidu':
    case 'openrouter':
    case 'xai':
    case 'mistral':
    case 'groq':
    case 'together':
    case 'fireworks':
    case 'shukelongda':
    case 'custom':
    default:
      prompt = await callOpenAICompatible(cfg, imgs, instruction, strategy, onProgress);
      break;
  }

  return {
    prompt: prompt.trim(),
    provider: providerId,
    model: cfg.model,
    style: settings.outputStyle,
  };
}
