import type { OneClickRewriteRandomness } from '@/lib/types';

export const DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS: OneClickRewriteRandomness = 'moderate';

export function normalizeOneClickRewriteRandomness(v: unknown): OneClickRewriteRandomness {
  if (v === 'subtle' || v === 'moderate' || v === 'bold') return v;
  return DEFAULT_ONE_CLICK_REWRITE_RANDOMNESS;
}

const LEVEL_BODY: Record<OneClickRewriteRandomness, string> = {
  subtle:
    '随机强度：轻度。请在保留原画面主体与构图骨架的前提下优化表述：可微调光影语气、配色只做小幅偏移或相邻色系替换、次要道具可增删；避免推翻整体构图与主体类别。',
  moderate:
    '随机强度：中度。以当前提示词为灵感，输出一版完整且可直接用于生图的优化提示词；每次须在「主体呈现方式 / 色调与光影氛围 / 构图景别与留白 / 道具与环境元素」中至少多项做出清晰可见的变化，禁止只做同义词替换；可在同类用途与题材内大胆重组。',
  bold:
    '随机强度：强烈。在仍是同类用途（如海报、产品场景、人像等大类不变）的前提下，允许显著更换主体的具体呈现、彻底重构配色与光影氛围、重塑构图与留白节奏，并大胆替换或增减场景元素；输出必须仍是连贯的一条生图提示词，但不要求保留上一版的句子结构或物象清单。',
};

export function buildOneClickRewriteInstruction(
  level: OneClickRewriteRandomness,
  nonce: string
): string {
  return [
    '请根据下列要求重写提示词（相当于「一键洗稿」变体）：',
    LEVEL_BODY[level],
    '务必保持与原提示词相同的语言（中文仍为中文，英文仍为英文）。',
    '直接输出改写后的完整提示词正文，不要前缀、不要 Markdown、不要解释。',
    `本次变体编号：${nonce}`,
  ].join('\n');
}

export function makeRewriteNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
