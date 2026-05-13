/**
 * 提示词「策略档位」—— 组件 + 版本两层模型。
 *
 * ──────────────── 设计动机 ────────────────
 * 早期版本里一档「策略」是一坨硬绑死的配置：
 *   { 4 套 stylePrompts, temperature, maxTokens, customPosition }
 * 每加一档就得把这 4 项整体复制一遍。两个直接后果：
 *   - 「v0.1.5 / v0.1.6 数值完全相同」这件事只能靠注释强调，代码层面看不出来；
 *   - 想加一档"新指令 + 经典温度"的混搭策略，只能复制粘贴几 KB 字符串。
 *
 * 重构后把"档"拆成 3 个**独立组件维度**，每个维度各自维护带版本号的注册表：
 *
 *   1. stylePromptSet  ── 4 套 OutputStyle 指令文本（中/英/SD-tags/MJ）
 *   2. sampling        ── { temperature, maxTokens } 一对耦合采样参数
 *   3. customJoin      ── 用户自定义模板的拼接位置（'prepend' | 'append'）
 *
 * 一档「策略」(StrategyDefinition) 不再持有具体值，而是 3 个版本号的组合引用：
 *
 *   v0.1.5 / v0.1.6 这两档的 components 字段，本质就是各自挑了哪一套版本。
 *   getStrategy(id) 调 resolveStrategy 把组件版本展开成扁平 ResolvedStrategy，
 *   对外仍然暴露 stylePrompts/temperature/maxTokens/customPosition 这 4 个字段，
 *   所以 api/index.ts、SettingsView、panel.ts 等下游零侵入。
 *
 * ──────────────── 这种结构带来的好处 ────────────────
 * - 「v0.1.5 和 v0.1.6 数值相同」从注释升级为代码事实 —— 它们都引用 v0.1.0
 *   那一组组件版本，未来若 v0.1.0 组件被改坏，两档同时坏；若想分叉单独迭代
 *   v0.1.6，给它换上一组新版本号即可，不必把 4 套指令复制出来。
 * - 加新版本（比如 v0.1.x 起把 Midjourney 指令改成 v7）只需要往
 *   STYLE_PROMPT_SETS 加一条；想让某档跟进就把它的引用换掉，老的版本永远
 *   停在原处，历史档不会被污染。
 * - 加新策略（如 "ocr-strict"）只需在 STRATEGIES 写一条引用组合，无需粘贴
 *   字符串，避免漂移。
 * - 后续如果开放高级用户「自由组合」入口，UI 层只需要照着这 3 张版本表渲染
 *   下拉，存进 settings 时也就是 3 个字符串，结构天然就支持了。
 *
 * 当前内置两档（行为完全等价 —— v0.1.1 ~ v0.1.6 这 6 个版本里 4 项配置一字未改）：
 *   - classic  : "v0.1.5 策略"——指令 v0.1.0 / 采样 v0.1.0 / 拼接 v0.1.0
 *   - v016     : "v0.1.6 策略"——同样引用 v0.1.0 那组组件，独立列出只是给习惯
 *                按版本号回滚的用户一个显式入口。如果将来想单独迭代某一档，
 *                只需把它的 components 引用换成新版本号，不影响另一档。
 */

import type { OutputStyle, StrategyId } from './types';

// ============================================================
// 1. 组件版本注册表
// ============================================================

/** stylePromptSet 组件的版本号。新增版本时只追加，不改老版本（历史档要靠它锚定）。 */
export type StylePromptSetVersion = 'v0.1.0';
/** sampling 组件的版本号。 */
export type SamplingVersion = 'v0.1.0';
/** customJoin 组件的版本号。 */
export type CustomJoinVersion = 'v0.1.0';

// ----- stylePromptSet 各版本 -----

const STYLE_PROMPT_SET_V010: Record<OutputStyle, string> = {
  'natural-zh':
    '请用自然流畅的中文段落详细描述这张图片的画面内容、风格、构图、光线、色调、氛围以及主体细节，输出可作为 AI 绘图工具的高质量提示词。只输出提示词正文，不要任何前缀、解释或 Markdown。',
  'natural-en':
    'Describe this image in detailed, fluent English suitable as a high-quality prompt for AI image generators. Cover subject, style, composition, lighting, color palette, mood, and key details. Output ONLY the prompt body — no prefix, no explanation, no markdown.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru-style English tag prompt for this image. Use comma-separated short tags ordered by importance. Include subject, character features, clothing, pose, environment, lighting, art style, quality boosters. Output ONLY the tag list, single line, no explanation.',
  midjourney:
    'Generate a Midjourney v6 style English prompt for this image. Use a vivid descriptive sentence with comma-separated style modifiers, then end with appropriate parameters like --ar 16:9 --style raw if relevant. Output ONLY the prompt, no explanation, no markdown.',
};

/**
 * stylePromptSet 组件的版本注册表。键是版本号，值是该版本下完整的 4 套指令。
 *
 * 之所以把 4 套指令一起作为"一个版本"，而不是给 natural-zh / natural-en / sd-tags /
 * midjourney 各开一张表，是因为这 4 套指令的语气/详略要求要"成套调"——比如未来
 * 如果统一升级成"按主体→姿态→服饰…顺序展开"，跨语言的一致性是这一档的卖点。
 * 拆开版本号反而会让语气漂移。
 */
export const STYLE_PROMPT_SETS: Record<StylePromptSetVersion, Record<OutputStyle, string>> = {
  'v0.1.0': STYLE_PROMPT_SET_V010,
};

// ----- sampling 各版本 -----

export interface SamplingProfile {
  /** 模型采样温度，越高越发散。 */
  temperature: number;
  /** 输出 token 上限。需要和指令的"展开力度"匹配，否则会被中途截断。 */
  maxTokens: number;
}

/**
 * sampling 组件的版本注册表。
 *
 * temperature 和 maxTokens 绑成一组而不是两个独立组件，是因为它们语义强耦合：
 * 让模型按"主体→姿态→服饰→…"展开的长答案在 1024 token 经常被截断；反过来
 * "短而稳"的语调如果上限给到 2048 token 又会被模型自由发挥成啰嗦版本。
 * 把 (temperature, maxTokens) 当作一对调子来版本化，不让用户拿到怪组合。
 */
export const SAMPLING_PROFILES: Record<SamplingVersion, SamplingProfile> = {
  'v0.1.0': { temperature: 0.4, maxTokens: 1024 },
};

// ----- customJoin 各版本 -----

/**
 * 用户在「额外提示词」里填的内容如何与 base 拼接：
 *   - 'prepend' = `${custom}\n\n${base}`           —— 让自定义当一等公民
 *   - 'append'  = `${base}\n\n额外要求：${custom}` —— 经典版兼容写法
 */
export type CustomJoinPosition = 'prepend' | 'append';

export const CUSTOM_JOINS: Record<CustomJoinVersion, CustomJoinPosition> = {
  'v0.1.0': 'append',
};

// ============================================================
// 2. 策略 = 组件版本组合
// ============================================================

/**
 * 一档策略选用的 3 个组件版本。
 *
 * 把它独立成一个 interface 而不是直接展开到 StrategyDefinition，是为了在 UI 上
 * 用一行紧凑的"指纹"显示出来（如 `指令集@v0.1.0 · 采样@v0.1.0 · 拼接@v0.1.0`），
 * 让用户一眼看出"我现在选的这档由哪 3 个版本组成"，对比不同策略时也能一眼看到差异点。
 */
export interface StrategyComponents {
  stylePromptSet: StylePromptSetVersion;
  sampling: SamplingVersion;
  customJoin: CustomJoinVersion;
}

/**
 * 内部存储：一档策略 = id + 元信息（label/description）+ 它选用的组件版本组合。
 *
 * 没有任何具体的 stylePrompts / temperature / maxTokens 字段——这些都从
 * `components` 里 resolve 出来，保证"一处修改组件版本，所有引用它的策略同步生效"。
 */
export interface StrategyDefinition {
  id: StrategyId;
  /** UI 上显示的简短名 */
  label: string;
  /** UI 上显示的一句话说明，告诉用户切到这档大概会有什么不同 */
  description: string;
  /** 这档策略选用的 3 个组件版本组合。 */
  components: StrategyComponents;
}

/**
 * 对外暴露给消费侧（api/index.ts、SettingsView 等）的扁平化结果。
 *
 * = StrategyDefinition + 由 components 解析出来的 4 个具体值。下游代码只读这 4 个
 * 字段时和重构前的 PromptStrategy 完全一致，迁移成本为零。需要展示组件版本指纹时
 * 再额外读 `components` 字段。
 */
export interface ResolvedStrategy extends StrategyDefinition {
  stylePrompts: Record<OutputStyle, string>;
  temperature: number;
  maxTokens: number;
  customPosition: CustomJoinPosition;
}

/**
 * 重构前的类型名，保留为 ResolvedStrategy 的别名。
 *
 * 这样 `api/index.ts` 里 `import type { PromptStrategy } from '../strategies'` 一行
 * 不需要改动，零回归。
 */
export type PromptStrategy = ResolvedStrategy;

// ============================================================
// 3. 内置策略：2 个 id × 各自的组件版本引用
// ============================================================

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  // classic 在 UI 上显示为 "v0.1.5 策略" —— 因为查 git tag v0.1.1 ~ v0.1.6 的源码，
  // stylePrompts/temperature/maxTokens/customPosition 这 4 项一字未改，v0.1.5
  // 那一版的行为本质就是 v0.1.0 那组组件版本。这里 id 仍叫 'classic' 是为了
  // 兼容老用户 settings 里持久化的字段（旧值不会因为重命名而失效）。
  classic: {
    id: 'classic',
    label: 'v0.1.5 策略',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。完整复刻 v0.1.5 那一版的提示词与采样参数，输出短而稳，套话偏多，对早期用户语感最熟悉。',
    components: {
      stylePromptSet: 'v0.1.0',
      sampling: 'v0.1.0',
      customJoin: 'v0.1.0',
    },
  },
  // v016 和 classic 引用同一组组件版本 —— 因为 v0.1.1 ~ v0.1.6 这 6 个版本里
  // stylePrompts/temperature/maxTokens/customPosition 一字未改，组件化之后这件
  // 事直接表现在代码里：两档的 components 完全相同。这不是代码冗余，而是对
  // "v0.1.6 = v0.1.5 那套行为"这一历史事实的忠实建模；将来若想单独迭代 v016
  // 而不影响 classic，只需把 v016 的 components 换成新版本号即可。
  v016: {
    id: 'v016',
    label: 'v0.1.6 策略',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。完整复刻 v0.1.6 那一版的提示词与采样参数（与"v0.1.5 策略"在数值上等价，因为 v0.1.1 ~ v0.1.6 期间这套配置未变）。习惯按版本号回滚的用户可以从这里直接选。',
    components: {
      stylePromptSet: 'v0.1.0',
      sampling: 'v0.1.0',
      customJoin: 'v0.1.0',
    },
  },
};

/**
 * 新装用户的缺省策略。
 *
 * 选 classic（"v0.1.5 策略"）作为默认而不是 v016，是因为它在历史上是更早被
 * 大量用户感知的"原始行为基线"，措辞最稳；v016 只是给"我就要 v0.1.6 那一版
 * 输出感"的用户的显式回滚入口。两者数值等价，所以默认走哪一档对体验没差，
 * 这里更看重命名上的"基线感"。
 */
export const DEFAULT_STRATEGY_ID: StrategyId = 'classic';

// ============================================================
// 4. resolve：把组件版本引用展开成可直接消费的扁平对象
// ============================================================

/**
 * 把一份 StrategyDefinition 的组件版本组合解析成下游可以直接读的扁平结构。
 *
 * 解析失败（组件版本号未在注册表登记）时不静默兜底——直接抛错。原因是这种情况
 * 一定是代码 bug（比如 typo 了一个版本号），让它在开发期立刻暴露比线上吐空字符串
 * 安全得多。生产侧的"未知策略 id"由 getStrategy 在更上层兜底。
 */
export function resolveStrategy(def: StrategyDefinition): ResolvedStrategy {
  const { stylePromptSet, sampling, customJoin } = def.components;
  const sp = STYLE_PROMPT_SETS[stylePromptSet];
  const sm = SAMPLING_PROFILES[sampling];
  const cj = CUSTOM_JOINS[customJoin];
  if (!sp || !sm || cj === undefined) {
    throw new Error(
      `[strategies] 策略 "${def.id}" 引用了不存在的组件版本：` +
        `stylePromptSet=${stylePromptSet}, sampling=${sampling}, customJoin=${customJoin}`
    );
  }
  return {
    ...def,
    stylePrompts: sp,
    temperature: sm.temperature,
    maxTokens: sm.maxTokens,
    customPosition: cj,
  };
}

/**
 * 安全地取出策略对象。
 *
 * - 传 undefined（老 settings 没有 promptStrategy 字段）→ 走默认
 * - 传一个未来才存在 / 拼错 / 已下线（如老用户存的 'fidelity'）的 id → 也回退到
 *   默认，避免「升级后切策略找不到字段」崩溃。
 *
 * 返回的是已 resolve 完毕的扁平 ResolvedStrategy，调用方读 stylePrompts /
 * temperature / maxTokens / customPosition 这 4 个字段的写法和重构前完全一致。
 */
export function getStrategy(id: StrategyId | undefined | null): ResolvedStrategy {
  const def =
    id && id in STRATEGIES ? STRATEGIES[id as StrategyId] : STRATEGIES[DEFAULT_STRATEGY_ID];
  return resolveStrategy(def);
}

/**
 * UI / 持久化两侧需要轮询的所有策略列表（保证渲染顺序稳定）。
 *
 * 顺序：v016（更新的版本号）→ classic（更早的版本号），按版本号由新到旧排，
 * 方便用户从更新档逐步往旧档对比效果。
 *
 * 这里在模块加载时就把所有策略 resolve 完毕，是因为组件版本表和策略定义都是
 * module-scope 静态常量，结果不会变；UI 渲染时直接拿到的就是含 stylePrompts /
 * temperature / maxTokens / customPosition 的扁平对象，开销忽略不计。
 */
export const STRATEGY_LIST: ResolvedStrategy[] = [
  resolveStrategy(STRATEGIES.v016),
  resolveStrategy(STRATEGIES.classic),
];
