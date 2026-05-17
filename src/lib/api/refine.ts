/**
 * 提示词文本重写（refine）：根据用户的"修改要求"，让模型在保留原意的前提下
 * 重写已有的提示词。各家 provider 共用同一套 system / user 模板。
 */
import { getStrategy } from '../strategies';
import { callOpenAICompatibleText } from './providers/openai';
import { callAnthropicText } from './providers/anthropic';
import { callGeminiText } from './providers/gemini';
import { safeRefineProgress, type RefineParams, type RefineResult } from './types';

const REFINE_SYSTEM_PROMPT = (styleHint: string) =>
  `你是 AI 绘图提示词的资深编辑助手。用户会给你一段已有的提示词，以及他希望对其进行的调整。请根据要求输出结果：多数情况下为修改后的【完整】提示词；若用户只要提取/归纳某类信息（见下条），则只输出提取结果。规则：
- 严格遵循用户的"修改要求"，做到"只改要改的，不动不该动的"。
- 保持目标输出风格：${styleHint || '与原提示词相同的语言和风格'}
- 直接输出最终提示词正文，不要任何前缀、解释、引号或 Markdown 标题。
- 不要输出"当前提示词："或"修改后："这种标签。
- 如果用户要求语言切换（中→英 / 英→中），整段统一翻译。
- 若修改要求是从当前提示词中【提取 / 归纳】某一类信息（例如仅材质与表面质感、仅画面或艺术或镜头风格），则只输出提取结果：用逗号分隔的短语或极短多行列表即可，以忠实映射原文为优先，避免过度泛化为少量空泛词；不要输出完整重写后的整段提示词；若指令用中文句号或分号串联了多种要求，其中凡属「仅提取」的，只给出对应提取块，其它要求仍按其语义处理。
- 如果用户的修改要求语义不清，按你最合理的解读处理，不要反问。`;

const REFINE_USER_PROMPT = (current: string, instruction: string) =>
  `【当前提示词】\n${current}\n\n【修改要求】\n${instruction}`;

export async function refinePrompt(params: RefineParams): Promise<RefineResult> {
  const { settings, current, instruction, onProgress } = params;
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

  // 在请求真正发出之前先吼一声 'calling'，让面板进度条立刻动起来。
  // provider 拿到首 token 后会自己再 emit 'streaming'，无缝衔接。
  safeRefineProgress(onProgress, { stage: 'calling' });

  let prompt: string;
  switch (providerId) {
    case 'anthropic':
      prompt = await callAnthropicText(cfg, system, user, onProgress);
      break;
    case 'gemini':
      prompt = await callGeminiText(cfg, system, user, onProgress);
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
      prompt = await callOpenAICompatibleText(cfg, system, user, onProgress);
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
