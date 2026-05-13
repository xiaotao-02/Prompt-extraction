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
export type StylePromptSetVersion = 'v0.1.0' | 'v0.1.1' | 'v0.2.2';
/** sampling 组件的版本号。 */
export type SamplingVersion = 'v0.1.0' | 'v0.2.2';
/** customJoin 组件的版本号。 */
export type CustomJoinVersion = 'v0.1.0' | 'v0.2.2';

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

// v0.1.1：在 v0.1.0 基础上加 3 条硬约束（覆盖率清单 + 去模板句 + 去主观词），采样不变。
// 目的：让 "v0.1.6 策略" 这一档在同温度同 token 上限下输出更紧、更有结构、更少水词。
const STYLE_PROMPT_SET_V011: Record<OutputStyle, string> = {
  'natural-zh':
    '请用自然流畅的中文段落详细描述这张图片，作为 AI 绘图工具的高质量提示词。必须按"主体 → 主体细节 → 姿态 → 服饰 → 环境 → 光照 → 风格"的顺序逐项展开，少一项都算违规。禁止以"这是一张/画面中/总而言之/总体而言"等模板句开头或收尾。禁止"美丽的/梦幻般的/令人惊叹的"等主观抽象修饰，使用具体名词 + 具体形容。只输出提示词正文，不要任何前缀、解释或 Markdown。',
  'natural-en':
    'Describe this image as a high-quality prompt for AI image generators. You MUST cover, in order: subject → subject details → pose → clothing → setting → lighting → style. Missing any is a violation. Do NOT open or close with template phrases like "This is an image of...", "Overall,...", "In summary,...". Do NOT use subjective fillers like "beautiful, dreamy, breathtaking" — use concrete nouns and concrete adjectives. Output ONLY the prompt body — no prefix, no explanation, no markdown.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru-style English tag prompt for this image. Comma-separated lowercase short tags, single line, ordered: quality boosters → subject → subject features → pose → clothing → setting → lighting → style. Tags must describe elements actually visible in the image. No subjective fillers ("beautiful", "dreamy"). No negative-prompt tags ("blurry", "low quality"). Output ONLY the tag list, single line, no explanation.',
  midjourney:
    'Generate a Midjourney v6 style English prompt for this image. A single dense descriptive sentence in the order subject → subject details → pose → setting → lighting → style, followed by comma-separated style modifiers, then parameters like --ar 16:9 --style raw if relevant. No subjective fillers, no template phrases ("This image shows..."). Output ONLY the prompt, no explanation, no markdown.',
};

// v0.2.2：直接从 v0.1.0 演化的"v0.1.0 增强版"。设计动机不依赖 v0.1.1 / v0.2.x，
// 只针对 v0.1.0 本身实测出来的 4 类输出问题做最小手术：
//
//   (A) v0.1.0 把"画面 / 风格 / 构图 / 光线 / 色调 / 氛围 / 主体细节"7 个抽象方面
//       一并丢给模型自由组织，覆盖率不稳——常出现"色调"和"氛围"被反复说而"姿态 /
//       服饰每层 / 镜头焦段"被整块跳过的偏科现象。
//       → 改成显式 10 维度清单：主体类型 / 主体外貌 / 表情眼神 / 姿态动作 /
//         服饰逐层（颜色+质料+剪裁）/ 持物配饰 / 场景与前中背景 / 光照（方向+
//         强度+色温+质感）/ 色彩（具体色名）/ 画风媒介构图镜头。模型先在心里
//         逐项识别再串成段，**但维度名禁止打印进正文**（"主体："这种字面字符
//         不要进 prompt，避免污染下游扩散模型 token 流）。
//
//   (B) v0.1.0 实测最常见的三类"低密度输出"：
//       - 模板开头："这是一张……" / "整张图给人的感觉是……"
//       - 主观水词："美丽的 / 梦幻般的 / 唯美 / 令人惊叹的 / 高质感"
//       - 脑补图外："她似乎在思考人生" / "暗示一种孤独感" / "可能是傍晚下班路上"
//       这三类对扩散模型 100% 无效甚至有害（无视觉锚 / 高熵主观词 / 偏离图意）。
//       → 单独列三条硬约束：禁模板句开收尾 / 禁主观抽象修饰 / 禁脑补图外内容。
//
//   (C) v0.1.0 没说"图里没有该怎么办"，模型经常凑词——比如灰底特写头像非要补一句
//       "背景是模糊的室内"，纯属臆造。
//       → 加"空槽位静默跳过"硬约束，明确禁止凑词、禁止写"无 / 不可见"。
//
//   (D) v0.1.0 让"光照 / 颜色"自由表述，模型偷懒就吐"自然光 / 暖色调"，扩散模型
//       的 attention 抓不到有用的视觉信号。
//       → 在具体度要求里点名两个高价值维度：颜色必须给具体色名（"藏青 / 铁锈橙"
//         而不是"暖色调"）；光照尽量给方向+强度+色温+质感（"左前 45° 主光、柔和、
//         暖白 4500K、轻微边缘光"而不是"自然光"）。其他维度仍允许散文化表述，
//         不强行 schema 化，避免把 v0.1.0 的"自然成段"卖点完全丢掉。
//
// 注：4 套指令共享一个版本号，是为了让中文段落 / 英文段落 / SD tag / Midjourney
// 这 4 种口径在"覆盖维度 + 三禁 + 空槽位跳过"上保持成套一致，避免一种风格修了
// 另一种风格继续吐套话。
const STYLE_PROMPT_SET_V022: Record<OutputStyle, string> = {
  'natural-zh':
    '请把这张图片改写成一段可直接作为 Stable Diffusion / Midjourney / Flux 输入的中文提示词。请先在心里按以下 10 个维度对图片做识别：(1) 主体类型；(2) 主体外貌（年龄段 / 性别 / 发型发色 / 瞳色 / 肤色，仅写图中可辨认的）；(3) 表情与眼神；(4) 姿态 / 动作（身体朝向 + 手脚位置）；(5) 服饰自上而下逐层（每层的颜色 + 质料 + 剪裁）；(6) 持物 / 配饰；(7) 场景 / 环境与前景 / 中景 / 背景元素；(8) 光照（方向 + 强度 + 色温 + 质感）；(9) 色彩搭配（主色 + 次色，必须用具体色名）；(10) 画风 / 媒介 / 构图 / 镜头焦段。识别完之后按同一顺序把每个维度的内容紧凑成段写出来。具体度要求：颜色用"藏青 / 铁锈橙 / 雾灰"这种具体色名，禁用"暖色调 / 冷色调"；光照尽量写成"左前 45° 主光、柔和、暖白 4500K、轻微边缘光"，禁用"自然光 / 氛围光"这种空话。硬约束：(a) 维度名禁止打印进正文，不要出现"主体：" "光照：" 之类的字面标签；(b) 只描述图里真实可见的元素，禁止脑补人物动机 / 剧情 / 情绪 / 镜头外内容；(c) 禁用"美丽的 / 梦幻般的 / 唯美 / 令人惊叹的 / 高质感"等主观抽象水词，用具体名词 + 具体形容代替；(d) 不允许以"这是一张 / 画面中 / 整张图 / 总体而言 / 总而言之"等模板句开头或收尾；(e) 某个维度在图里确实没有就静默跳过，不要凑词，更不要写"无 / 不可见"。输出格式：单段中文正文，不分行、不分点、不要 Markdown、不要任何前缀或解释。',
  'natural-en':
    'Rewrite this image as a single dense English paragraph suitable as a prompt body for Stable Diffusion / Midjourney / Flux. First silently identify the image along these 10 dimensions: (1) subject type; (2) subject appearance (age range / gender / hairstyle & color / eye color / skin tone — only what is visibly identifiable); (3) expression and eye contact; (4) pose / action (body orientation + hand & foot placement); (5) clothing top-to-bottom, each layer\'s color + material + cut; (6) held objects / accessories; (7) setting plus foreground / midground / background; (8) lighting (direction + intensity + color temperature + quality); (9) color palette (primary + secondary, using concrete color names); (10) art style / medium / framing / focal length. Then write them out in the same order as ONE compact paragraph. Specificity requirements: use concrete color names ("navy, rust orange, fog gray"), never abstract palette words ("warm tones, cool tones"); prefer precise lighting ("45-degree key light from front-left, soft, warm 4500K, subtle rim light") over generic phrasing ("natural lighting, ambient light"). Hard rules: (a) NEVER print dimension labels into the output (no "Subject:" / "Lighting:" headers); (b) describe only elements actually visible — no speculation about motive, narrative, emotion or off-frame content; (c) forbid subjective fillers such as "beautiful, dreamy, breathtaking, stunning, high quality" — use concrete nouns and concrete adjectives instead; (d) do NOT open or close with template phrases like "This is an image of...", "The picture shows...", "Overall,...", "In summary,..."; (e) if a dimension has nothing visible, skip it silently — never pad with invented content, never write "none" or "not visible". Output format: ONE dense English paragraph. No line breaks, no bullets, no Markdown, no prefix, no explanation.',
  'sd-tags':
    'Generate a Stable Diffusion / Danbooru style tag prompt for this image. Output a single line of comma-separated lowercase English tags in this order: quality boosters → art style / medium → subject type → subject features (age / gender / hair / eye / skin — only what is visibly identifiable) → expression → pose → clothing & accessories (each item\'s color + material + cut) → setting → foreground / midground / background → lighting → color palette → camera & framing. Specificity: prefer concrete tags ("navy blue trench coat", "rim lighting", "shallow depth of field", "soft bokeh") over abstract ones ("warm tones", "natural lighting", "atmospheric"); always use specific color names rather than palette adjectives. Hard rules: (a) tags must reflect only elements actually visible in the image — no imagined narrative, no off-frame guesses, no emotional speculation; (b) no subjective fillers ("beautiful", "dreamy", "breathtaking"); (c) no negative-prompt-style tags here ("blurry", "low quality", "bad anatomy", "extra fingers", "watermark") — those belong to a separate negative prompt, not this positive line; (d) no sentences, no full stops, no Markdown, no line breaks; (e) if a category has nothing visible in the image, omit it silently — do not pad, do not write "none". Output ONLY the single tag line.',
  midjourney:
    'Generate a Midjourney v6 prompt for this image. Output a single English line. Begin with one dense descriptive sentence whose internal order follows: art style / medium → subject → subject features → expression → pose → clothing → accessories → setting → foreground / midground / background → lighting → color palette → camera & lens. Then append comma-separated style modifiers (e.g. "cinematic lighting, shallow depth of field, soft bokeh, 35mm film grain"). Finally append Midjourney parameters where relevant: --ar matching the image aspect ratio, --style raw, --stylize 100. Specificity: use concrete color names ("navy, rust orange, fog gray") over palette words ("warm tones"); use precise lighting ("45-degree key light, soft, warm 4500K, subtle rim light") over generic phrases ("natural lighting"); prefer diffusion-friendly vocabulary ("cinematic lighting, rim light, shallow depth of field, soft bokeh, overcast diffuse light"). Hard rules: (a) describe only elements actually visible — no imagined motive, no narrative, no off-frame guesses, no emotional speculation; (b) no subjective fillers ("beautiful, dreamy, breathtaking"); (c) no template openers / closers ("This image shows...", "Overall,..."); (d) never print dimension labels ("Lighting:", "Subject:") into the output; (e) if a dimension has nothing visible, omit it silently — no padding, no "none". Output ONLY the prompt line, no prefix, no explanation, no Markdown.',
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
  'v0.1.1': STYLE_PROMPT_SET_V011,
  'v0.2.2': STYLE_PROMPT_SET_V022,
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
  // v0.2.2：直接从 v0.1.0 的 (0.4, 1024) 起步做两步调整。
  // - 温度 0.4 → 0.3：v0.1.0 的 0.4 配合 v0.2.2 的 10 维度清单时容易出现"前几
  //   个维度按顺序填，后几个开始飘"的现象（次要维度被高熵采样吃掉），收紧到
  //   0.3 让维度顺序稳定。没继续往 0.2 / 0.25 收，是为了不把扩散模型偏好的中
  //   等熵专业词砍掉——"边缘光 / 浅景深 / 柔和散景 / 阴天散射光"这种词在 0.2
  //   左右概率会被压得很低，输出会退化成普通形容词。
  // - maxTokens 1024 → 1280：实测 v0.2.2 的中文 10 维度展开（尤其是服饰逐层 +
  //   光照四项 + 色彩具体色名）很容易把单次输出推到 1000~1200 token，1024 卡
  //   线时经常把末段的"画风 / 镜头"截掉。加 25% 余量足够覆盖绝大多数图，又不
  //   会显著拖慢响应。
  'v0.2.2': { temperature: 0.3, maxTokens: 1280 },
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
  // v0.2.2：从 v0.1.0 的 append 切换到 prepend。
  // v0.1.0 用 append 是为了"经典兼容"——把用户偏好以"额外要求："形式挂尾部。
  // 但在 v0.2.2 的 10 维度清单下，append 会让用户写的"按吉卜力赛璐璐风、暖色
  // 调"这种偏好出现在 attention 衰减尾部，模型已经按图里推断出的"写实摄影"填
  // 完了画风 / 镜头维度，再回头看到"按吉卜力"已经晚了，权重低、跟随性差。
  // prepend 让用户偏好先入上下文，10 维度的填充顺着这个偏好走，跟随性显著提升。
  'v0.2.2': 'prepend',
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
  // v010：v0.1.1 初始版的显式回滚入口。数值上和 classic 完全等价（因为 v0.1.1 ~
  // v0.1.6 这 6 个版本里这套配置一字未改），独立列出只是给"按版本号回滚"的
  // 用户一个无歧义入口。物料零成本——3 个组件版本都指 v0.1.0。
  v010: {
    id: 'v010',
    label: 'v0.1.0 策略',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。完整复刻 v0.1.1 初始版的行为（与"v0.1.5 策略"在数值上等价，因为 v0.1.1 ~ v0.1.6 期间这套配置未变）。用于按版本号回到最早一版的输出感。',
    components: {
      stylePromptSet: 'v0.1.0',
      sampling: 'v0.1.0',
      customJoin: 'v0.1.0',
    },
  },
  // v016：本次升级 —— 指令层换上 v0.1.1（覆盖率清单 + 去模板句 + 去主观词），
  // 采样与拼接保持 v0.1.0 不变。同温度同 token 上限下输出更紧、更有结构、更少
  // 水词，总响应时长基本与 classic 持平。老用户 settings 里持久化的 'v016'
  // 字段无需迁移，行为静默升级。
  v016: {
    id: 'v016',
    label: 'v0.1.6 策略',
    description:
      '温度 0.4 · 上限 1024 token · 自定义模板尾部追加。v0.1.6 优化版：指令层加入覆盖率清单、禁模板句、禁主观词，采样参数与 v0.1.5 一致，速度不变但输出更紧凑、更有结构。',
    components: {
      stylePromptSet: 'v0.1.1',
      sampling: 'v0.1.0',
      customJoin: 'v0.1.0',
    },
  },
  // v022：直接从 v0.1.0 演化的"v0.1.0 增强版"。设计思路只针对 v0.1.0 本身的 6
  // 个具体短板做最小手术，未参考其它中间版本（v0.1.1 / v0.2.0 / v0.2.1）：
  //   - 指令层：把 v0.1.0 的 7 个抽象方面换成 10 维度显式清单（主体类型 / 外貌 /
  //     表情 / 姿态 / 服饰逐层 / 配饰 / 场景前中背景 / 光照四项 / 具体色名 / 画风
  //     镜头），并加入"三禁 + 空槽位跳过 + 维度名不打印"4 条硬约束，把 v0.1.0
  //     实测最常见的"模板开头 / 主观水词 / 脑补图外 / 凑词"4 类废 token 一次性
  //     堵掉；
  //   - 采样层：温度 0.4 → 0.3 让维度顺序稳定；maxTokens 1024 → 1280 给中文 10
  //     维度展开预留 25% 余量，避免末段"画风 / 镜头"被截掉；
  //   - 拼接层：append → prepend 让用户自定义偏好先入上下文，画风跟随性显著提升。
  // 这一档优先级：还原度 ≈ 用户跟随性 ≫ 速度；用户 settings 旧值不会被动到，
  // 想要这套新行为请主动切到 v022。
  v022: {
    id: 'v022',
    label: 'v0.2.2 策略',
    description:
      '温度 0.3 · 上限 1280 token · 自定义模板前置。从 v0.1.0 直接演化：10 维度显式清单 + 三禁（模板句 / 主观水词 / 脑补图外）+ 空槽位静默跳过 + 维度名不打印。颜色强制具体色名、光照强制方向+强度+色温+质感。优先级：还原度 ≈ 用户跟随性 ≫ 速度。',
    components: {
      stylePromptSet: 'v0.2.2',
      sampling: 'v0.2.2',
      customJoin: 'v0.2.2',
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
  resolveStrategy(STRATEGIES.v022),
  resolveStrategy(STRATEGIES.v016),
  resolveStrategy(STRATEGIES.classic),
  resolveStrategy(STRATEGIES.v010),
];
