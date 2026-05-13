/**
 * 提示词「策略档位」。
 *
 * 一档「策略」 = 一组同时影响**模型最终看到的提示词 + 采样行为**的配置：
 *   - 4 套 stylePrompts（自然中文 / 自然英文 / SD-tags / Midjourney）
 *   - temperature（采样温度）
 *   - maxTokens（输出 token 上限）
 *   - customPosition（用户自定义模板拼接位置：base 前置 vs "额外要求：" 尾部追加）
 *
 * 为什么把这些字段绑成一档而不是各自独立暴露：
 * 1. 它们是**强耦合**的——比如新 STYLE_PROMPTS 要求模型按"主体→姿态→服饰…"
 *    顺序展开，maxTokens=1024 会被截断在半截。低 temperature + 旧 prompt 也是
 *    互相搭配的"短而稳"调子。让用户能挑高温度 + 短上限的怪组合反而劣化体验。
 * 2. UI 上一个下拉/单选远比 4 个独立控件友好。
 *
 * 当前支持三档：
 *   - classic  : 修改前的"v0.1.0 经典"行为，温度 0.4 / 上限 1024 token /
 *                自定义模板以"额外要求："形式追加
 *   - v016     : "v0.1.6 经典"档位。数值与 classic 完全一致——因为查
 *                git tag v0.1.1 ~ v0.1.6 的源码，stylePrompts/temperature/maxTokens/
 *                customPosition 这 4 项从未改过。独立列出来只是给习惯按版本号
 *                选档的用户一个显式入口（"我要 v0.1.6 那一版的语感"），同时
 *                方便后续在不动 classic 的前提下单独迭代这一档。
 *   - fidelity : 修改后的"v0.1.7 高保真"行为，温度 0.8 / 上限 2048 token /
 *                自定义模板前置 / STYLE_PROMPTS 改成命令式有序展开
 *
 * 后续加第四档（例如 "tag-focused" / "creative" / "ocr-strict"）只需在
 * `STRATEGIES` 字面量里多一条即可，UI 会自动列出来。
 */

import type { OutputStyle, StrategyId } from './types';

export interface PromptStrategy {
  id: StrategyId;
  /** UI 上显示的简短名 */
  label: string;
  /** UI 上显示的一句话说明，告诉用户切到这档大概会有什么不同 */
  description: string;
  stylePrompts: Record<OutputStyle, string>;
  temperature: number;
  maxTokens: number;
  /**
   * 用户在「额外提示词」里填的内容如何与 base 拼接：
   *   - 'prepend' = `${custom}\n\n${base}` —— 让自定义当一等公民
   *   - 'append'  = `${base}\n\n额外要求：${custom}` —— 经典版兼容写法
   */
  customPosition: 'prepend' | 'append';
}

const CLASSIC_STYLE_PROMPTS: Record<OutputStyle, string> = {
  'natural-zh':
    '请用自然流畅的中文段落详细描述这张图片的画面内容、风格、构图、光线、色调、氛围以及主体细节，输出可作为 AI 绘图工具的高质量提示词。只输出提示词正文，不要任何前缀、解释或 Markdown。',
  'natural-en':
    'Describe this image in detailed, fluent English suitable as a high-quality prompt for AI image generators. Cover subject, style, composition, lighting, color palette, mood, and key details. Output ONLY the prompt body — no prefix, no explanation, no markdown.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru-style English tag prompt for this image. Use comma-separated short tags ordered by importance. Include subject, character features, clothing, pose, environment, lighting, art style, quality boosters. Output ONLY the tag list, single line, no explanation.',
  midjourney:
    'Generate a Midjourney v6 style English prompt for this image. Use a vivid descriptive sentence with comma-separated style modifiers, then end with appropriate parameters like --ar 16:9 --style raw if relevant. Output ONLY the prompt, no explanation, no markdown.',
};

const FIDELITY_STYLE_PROMPTS: Record<OutputStyle, string> = {
  'natural-zh':
    '为这张图片写一段可直接喂给 AI 绘画工具的中文提示词。要求：单段、信息密集、按"主体—姿态/表情—服饰道具—环境/背景—光影色调—画风媒介"的顺序展开，使用具体名词与形容词而非抽象套话。直接输出正文，禁止任何前缀、解释、Markdown 或分点编号。',
  'natural-en':
    'Write a single dense English paragraph that can be fed directly to an AI image generator as a high-quality prompt. Order the description as: subject → pose/expression → clothing/props → environment → lighting/color → art style/medium. Use concrete nouns and adjectives, avoid generic praise. Output ONLY the prompt body — no prefix, no explanation, no markdown.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru-style English tag prompt for this image. Output a single line of comma-separated short tags ordered by importance: subject first, then character features, clothing, pose, environment, lighting, art style, and finally quality boosters (masterpiece, best quality, highly detailed, 8k). Output ONLY the tag list, single line, no explanation, no markdown.',
  midjourney:
    'Generate a Midjourney v6 prompt for this image. Write one vivid descriptive sentence followed by comma-separated style modifiers (artist names, medium, lighting, mood, lens), then append appropriate parameters such as --ar <ratio> --style raw / --stylize <n> when relevant. Output ONLY the prompt, no explanation, no markdown.',
};

export const STRATEGIES: Record<StrategyId, PromptStrategy> = {
  classic: {
    id: 'classic',
    label: '经典策略 (v0.1.0)',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。措辞贴近 v0.1.6 之前的版本：输出更短、更稳，套话偏多，但对早期用户语感最熟悉。',
    stylePrompts: CLASSIC_STYLE_PROMPTS,
    temperature: 0.4,
    maxTokens: 1024,
    customPosition: 'append',
  },
  // v0.1.6 在源码里和 v0.1.1 是同一份策略——查 git tag v0.1.1 ~ v0.1.6 的
  // storage.ts / api/index.ts，STYLE_PROMPTS、temperature 0.4、max_tokens 1024、
  // 自定义模板"额外要求："追加这 4 项一字未改。所以这一档直接复用
  // CLASSIC_STYLE_PROMPTS 与 classic 同值，不是占位，而是忠实反映 v0.1.6 历史。
  v016: {
    id: 'v016',
    label: 'v0.1.6 策略',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。完整复刻 v0.1.6 那一版的提示词与采样参数（与"经典策略"在数值上等价，因为 v0.1.1 ~ v0.1.6 期间这套配置未变）。习惯按版本号回滚的用户可以从这里直接选。',
    stylePrompts: CLASSIC_STYLE_PROMPTS,
    temperature: 0.4,
    maxTokens: 1024,
    customPosition: 'append',
  },
  fidelity: {
    id: 'fidelity',
    label: '高保真策略 (v0.1.7)',
    description:
      '温度 0.8 · 上限 2048 token · 自定义模板前置。指令强制按"主体→姿态→服饰→环境→光影→画风"顺序展开，输出更具体、信息密度更高，长度也更长。',
    stylePrompts: FIDELITY_STYLE_PROMPTS,
    temperature: 0.8,
    maxTokens: 2048,
    customPosition: 'prepend',
  },
};

/** 新装用户的缺省策略。 */
export const DEFAULT_STRATEGY_ID: StrategyId = 'fidelity';

/**
 * UI / 持久化两侧需要轮询的所有策略列表（保证渲染顺序稳定）。
 *
 * 顺序：fidelity（默认 / 最新）→ v016（按版本号回滚的显式入口）→ classic（最早），
 * 用版本由新到旧来排，方便用户从默认档逐步往旧档对比效果。
 */
export const STRATEGY_LIST: PromptStrategy[] = [
  STRATEGIES.fidelity,
  STRATEGIES.v016,
  STRATEGIES.classic,
];

/**
 * 安全地取出策略对象。
 *
 * - 传 undefined（老 settings 没有 promptStrategy 字段）→ 走默认
 * - 传一个未来才存在 / 拼错的 id  → 也回退到默认，避免「升级后切策略找不到字段」崩溃
 */
export function getStrategy(id: StrategyId | undefined | null): PromptStrategy {
  if (id && id in STRATEGIES) return STRATEGIES[id as StrategyId];
  return STRATEGIES[DEFAULT_STRATEGY_ID];
}
