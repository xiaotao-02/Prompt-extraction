/**
 * 视觉反推主入口：根据 settings.activeProvider 路由到具体 provider 实现，
 * 并负责"图片就绪 → 调用模型 → 流式回传"的阶段调度。
 */
import type { AppSettings, ExtractFocus, OutputStyle, VideoSegmentMeta } from '../types';
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

function fmtSegmentSeconds(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const s = `${Math.round(n * 100) / 100}`;
  return s.replace(/\.?0+$/, '').replace(/\.$/, '') || '0';
}

/** 可选：列出各参考图对应的采样时刻，便于模型写「约 Xs」。 */
function buildFrameAnchorsLine(seg: VideoSegmentMeta, referenceImageCount: number): string {
  const fts = seg.frameTimesSec;
  if (!fts?.length || referenceImageCount <= 0) return '';
  const parts: string[] = [];
  const n = Math.min(referenceImageCount, fts.length);
  for (let i = 0; i < n; i++) {
    parts.push(`图${i + 1}≈${fmtSegmentSeconds(fts[i]!)}s`);
  }
  if (parts.length === 0) return '';
  let extra = '';
  if (fts.length < referenceImageCount) {
    extra =
      '若参考图张数多于上列锚点，余下各张仍按时间在区间内顺序递补递增理解，勿打乱顺序。';
  }
  return `\n参考图与时间锚点（与本消息中参考图先后顺序一致）：${parts.join('；')}。${extra}`.trimEnd();
}

function appendVideoSegmentInstruction(
  instruction: string,
  seg: VideoSegmentMeta | undefined,
  referenceImageCount: number
): string {
  if (!seg) return instruction;
  const a = fmtSegmentSeconds(seg.startSec);
  const b = fmtSegmentSeconds(seg.endSec);
  const anchors = buildFrameAnchorsLine(seg, referenceImageCount);
  const n = Math.max(1, referenceImageCount);

  return (
    instruction +
    `\n\n【视频分镜任务 · 格式例外】以下多张参考图为同一 HTML5 视频在 **${a}s 至 ${b}s** 区间内按播放时间递增均匀采样的静止帧；请理解为同一连贯动作片段在不同瞬间的画面。上文若要求「单段」「不分行」「不分点」「不要 Markdown」，在本任务中以本条为准：你必须输出 **${n} 条分镜**，与本消息中参考图的先后顺序严格一一对应（第 k 张图对应分镜序号 k）；每条单独成行或单独成段，禁止合并成一段不分条的笼统描写。${anchors}` +
    `\n每条建议使用格式：分镜01（约Xs）：……；分镜02（约Ys）：……（两位序号；括号内时间为该帧在片段内的大致采样时刻，优先采用上文锚点；勿臆造严重偏离区间的时刻）。` +
    `\n每条分镜内仍遵循上文约定的语种与条目样式（如中文段落 / 英文段落 / SD 逗号标签 / Midjourney 单行）；SD/MJ 档每条仍可写成单行标签或单行英文描述。条与条之间可用简短语句交代动作或镜头的递进与衔接（转场、视线、位移），但整体必须是多条分镜而非一篇短文。` +
    `\n若上文【本次任务限定】要求仅抽取材质或画风，则每一条分镜仅在对应帧画面上遵守该限定，勿写成剧情旁白。` +
    `\n严禁编造任一分镜画面上不存在的内容；看不清的细节宁可不写，勿脑补。`
  );
}

function appendExtractFocusInstruction(instruction: string, focus: ExtractFocus | undefined): string {
  if (!focus) return instruction;
  if (focus === 'material') return instruction + EXTRACT_FOCUS_MATERIAL_NOTE;
  return instruction + EXTRACT_FOCUS_STYLE_NOTE;
}

/** 「原生识别」策略固定中文口径，不参与 settings.outputStyle。 */
function effectiveOutputStyleForExtract(settings: AppSettings, strategy: PromptStrategy): OutputStyle {
  return strategy.id === 'native' ? 'natural-zh' : settings.outputStyle;
}

function buildInstruction(settings: AppSettings, strategy: PromptStrategy): string {
  const styleKey = effectiveOutputStyleForExtract(settings, strategy);
  const base = strategy.stylePrompts[styleKey] ?? strategy.stylePrompts['natural-zh'];
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
  const {
    imageUrls: rawUrls,
    settings,
    prefetched,
    onProgress,
    extractFocus,
    videoSegment,
  } = params;
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
  if (imageUrls.length > 1 && !videoSegment) {
    instruction += MULTI_IMAGE_INSTRUCTION_NOTE;
  }
  instruction = appendExtractFocusInstruction(instruction, extractFocus);
  instruction = appendVideoSegmentInstruction(instruction, videoSegment, imageUrls.length);

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
    style: effectiveOutputStyleForExtract(settings, strategy),
  };
}
