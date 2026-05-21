/**
 * 提示词「策略档位」—— 组件 + 版本两层模型的**重对象层 + 解析层**。
 *
 * ──────────────── 文件分工 ────────────────
 * 这一层的内容**重**：3 套 OutputStyle 指令文本（每套几 KB 中英文 prompt）、
 * 采样参数注册表、自定义模板拼接策略注册表，加起来 ~26KB；外加把组件版本
 * 引用展开成扁平 ResolvedStrategy 的解析函数。
 *
 * 真正的"档位元信息"——`StrategyId` 字面量联合 / `STRATEGIES` 映射 /
 * `STRATEGY_LABELS` / `DEFAULT_STRATEGY_ID` / `StrategyDefinition` 等接口——全部
 * 物理迁到 `./strategies-meta`。**content script 只 import strategies-meta**，
 * 这样 Vite/Rollup 不会把这里几 KB 的 STYLE_PROMPT_SETS 通过 shared chunk
 * 顺手打进 content bundle。详细的拆分动机见 `strategies-meta.ts` 顶部注释。
 *
 * 对外门面：本文件 re-export 了 strategies-meta 的所有 type / value，所以
 * service worker / SettingsView / api/extract.ts 等仍可继续
 * `import { STRATEGIES, getStrategy, ... } from '@/lib/strategies'`，迁移成本为零。
 * 只有对 bundle 体积敏感的 content script 改为直接 import strategies-meta。
 *
 * ──────────────── 设计动机（保留作为档位结构的设计文档） ────────────────
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
 * - **加 / 删一档策略只改 1 处**：在 `strategies-meta.ts` 的 STRATEGIES_INTERNAL
 *   里加 / 删一个 key 即可。StrategyId 类型由 `keyof typeof STRATEGIES_INTERNAL`
 *   自动派生；STRATEGY_LIST 由 `getStrategyList()` 按声明顺序自动产出；
 *   STRATEGY_LABELS 由对象遍历自动派生；types.ts / SettingsView / loading
 *   面板的 strategy badge 全部跟随，不再分别去 4 个文件改 5 处再担心漏改一个
 *   就静默走默认值。
 * - 后续如果开放高级用户「自由组合」入口，UI 层只需要照着这 3 张版本表渲染
 *   下拉，存进 settings 时也就是 3 个字符串，结构天然就支持了。
 */

import type { OutputStyle } from './types';
import {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  type StrategyId,
  type StrategyDefinition,
  type StrategyComponents,
  type StylePromptSetVersion,
  type SamplingVersion,
  type CustomJoinVersion,
  type CustomJoinPosition,
} from './strategies-meta';

// 把 meta 层全部对外 re-export，让消费方继续 `from '@/lib/strategies'` 拿全套 API。
// content script 那一侧（loading.ts）改为直接 import strategies-meta 是性能优化，
// 不是 API 拆分——逻辑上 meta 仍然是 strategies 命名空间的一部分。
export {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  STRATEGY_LABELS,
  type StrategyId,
  type StrategyDefinition,
  type StrategyComponents,
  type StylePromptSetVersion,
  type SamplingVersion,
  type CustomJoinVersion,
  type CustomJoinPosition,
} from './strategies-meta';

// ============================================================
// 1. 组件版本注册表
// ============================================================

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

// v0.2.2：直接从 v0.1.0 演化的"v0.1.0 增强版"。设计动机不依赖 v0.2.x，
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

// v0.3.0：针对 GPT Image 2 / Nano Banana 等新一代文生图模型优化的指令集。
//
// 与 v0.2.2 的关键差异：
//   (A) 维度从 10 个合并为 8 个（外貌+表情合入主体，持物合入服饰），减少
//       形容词堆积——Nano Banana 实测 ≤5 个形容词首次可用率 73%，堆叠则降到 41%。
//   (B) 新增"摄影技术参数"维度（相机型号/镜头焦距/光圈/景深/胶片色彩科学），
//       GPT Image 2 官方 cookbook 和 Nano Banana prompt guide 均确认这类参数对
//       画面质感还原有显著影响。
//   (C) 强制用"具名风格标签"（如 cinematic photography / cel-shaded anime /
//       Studio Ghibli watercolor）打头，替代 v0.2.2 的泛泛"画风/媒介"——目标
//       模型对这类锚定词的 attention 响应远强于笼统描述。
//   (D) 全篇只用肯定句式：Nano Banana 实测否定句式（"no X" / "without Y"）
//       经常被模型忽略甚至反向理解，肯定表述的跟随性更稳定。
//   (E) 形容词密度硬限：全篇 ≤8 个，每维度 ≤2 个。两个目标模型同时满足多个
//       修饰词时会互相冲突，精简后各维度的视觉信号更清晰。
//   (F) 要求把"图中视觉权重最大的元素"排在最前——适配 Nano Banana 的词序权重
//       规则（最先出现的内容获得最多视觉注意力）。
const STYLE_PROMPT_SET_V030: Record<OutputStyle, string> = {
  'natural-zh':
    '请把这张图片改写成一段可直接喂给 GPT Image 2 / Nano Banana / Flux 的中文提示词。写法要求：用完整句子而非关键词堆叠；把图中视觉权重最大的元素放在最前面。请按以下 8 个维度依次输出，每个维度一两句话，用逗号自然衔接成段：(1) 画风与视觉风格——用具名风格标签（如"电影摄影风格""赛璐璐动画""吉卜力水彩""社论时尚摄影"），若是写实照片请明确写"写实摄影"；(2) 主体——类型与核心外貌（年龄段/性别/发型发色/肤色，仅写图中可辨认的）；(3) 动作、姿态、表情、视线方向；(4) 服饰与配饰——自上而下逐层，每层写颜色+质料+剪裁；(5) 场景环境——前景/中景/背景元素；(6) 光照——方向、色温、质感（如"左前45°主光，柔和，暖白4500K，轻微边缘光"）；(7) 色彩搭配——主色+次色，必须用具体色名（"藏青/铁锈橙/雾灰"）；(8) 摄影技术参数——推断并给出最接近的相机型号、镜头焦距与光圈、景深描述、胶片或色彩科学（如"Canon EOS R5, 85mm f/1.4, 浅景深柔和散景, Kodak Portra 400 胶片质感"，即使是插画/动画也给出视觉等价的镜头语言）。硬约束：(a) 维度名禁止打印进正文；(b) 只描述图中真实可见的元素，禁止脑补动机/剧情/镜头外内容；(c) 禁用"美丽的/梦幻般的/唯美/令人惊叹的"等主观水词；(d) 禁止模板句开收尾；(e) 空维度静默跳过；(f) 全篇只用肯定句式，禁止"没有/不含/without"等否定表述；(g) 全篇修饰性形容词总数控制在 8 个以内，每个维度最多 2 个。输出格式：单段中文正文，不分行、不分点、不要 Markdown。',
  'natural-en':
    'Rewrite this image as a single dense English paragraph that can be fed directly to GPT Image 2, Nano Banana, or Flux as a prompt. Use complete sentences, not keyword lists; lead with the most visually dominant element. Cover these 8 dimensions in order, one or two sentences each, joined by commas into a flowing paragraph: (1) Art style / visual style — use named style anchors (e.g. "cinematic photography," "cel-shaded anime," "Studio Ghibli watercolor," "editorial fashion photography"); for photorealistic images, explicitly write "photorealistic photography"; (2) Subject — type and key appearance (age range, gender, hairstyle & color, skin tone — only what is visibly identifiable); (3) Action, pose, expression, and gaze direction; (4) Clothing and accessories — top-to-bottom, each layer\'s color + material + cut; (5) Setting — foreground, midground, background elements; (6) Lighting — direction, color temperature, quality (e.g. "45-degree key light from front-left, soft, warm 4500K, subtle rim light"); (7) Color palette — primary + secondary colors using concrete color names ("navy, rust orange, fog gray"); (8) Camera and technical specs — infer and provide the closest camera body, lens focal length and aperture, depth of field description, and film stock or color science (e.g. "shot on Canon EOS R5, 85mm f/1.4, shallow depth of field with soft bokeh, Kodak Portra 400 film grain"; even for illustrations or anime, provide visually equivalent lens language). Hard rules: (a) NEVER print dimension labels; (b) describe only visible elements — no speculation about motive, narrative, or off-frame content; (c) no subjective fillers ("beautiful, dreamy, breathtaking, stunning"); (d) no template openers or closers; (e) skip empty dimensions silently; (f) use only affirmative descriptions — never use "no," "without," "lacks," or other negations; (g) limit decorative adjectives to 8 total across the paragraph, at most 2 per dimension. Output: ONE dense English paragraph, no line breaks, no bullets, no Markdown.',
  'sd-tags':
    'Generate a Stable Diffusion tag prompt optimized for recreation accuracy. Output a single line of comma-separated lowercase English tags. Structure: named style anchor (e.g. "cinematic photography," "cel-shaded," "oil painting," "studio ghibli") → quality boosters → subject type and key features → expression and gaze → pose → clothing and accessories (color + material per item) → setting and background → lighting (direction + quality + color temperature) → color palette (concrete color names) → camera and lens specs (e.g. "canon eos r5," "85mm," "f1.4," "shallow depth of field," "soft bokeh," "kodak portra 400"). For photorealistic images, always include "photorealistic" as a tag. Hard rules: (a) only describe elements actually visible; (b) no subjective fillers ("beautiful," "dreamy"); (c) no negative-prompt tags ("blurry," "low quality"); (d) no negation tags ("no background," "without"); (e) skip categories with nothing visible; (f) limit total tags to 30-40 for focus; (g) lead with the most visually important element. Output ONLY the tag line, single line, no explanation.',
  midjourney:
    'Generate a Midjourney v6 prompt optimized for faithful image recreation. Output a single English line. Begin with a named style anchor (e.g. "cinematic photography," "editorial fashion," "Studio Ghibli watercolor," "cel-shaded anime"). Then one dense descriptive sentence covering in order: subject and key features → expression and gaze → pose → clothing and accessories → setting → lighting (direction + color temperature + quality) → color palette (concrete color names). Then append a camera/lens clause (e.g. "shot on Canon EOS R5, 85mm f/1.4, shallow depth of field, Kodak Portra 400 film grain"). Then append comma-separated style modifiers. Finally append Midjourney parameters: --ar matching the image aspect ratio, --style raw, --stylize 100. For photorealistic images, include "photorealistic" in the descriptive sentence. Hard rules: (a) describe only visible elements; (b) no subjective fillers ("beautiful, dreamy, breathtaking"); (c) no template phrases; (d) no dimension labels; (e) use only affirmative language, never negations; (f) skip invisible dimensions silently; (g) limit adjectives to 8 total. Output ONLY the prompt line, no explanation, no Markdown.',
};

// v0.3.5：中文自然语言档单独收紧为「按图结构分 3–8 段 + 中文+参数 + 只出正文」；
// 其余 OutputStyle 与 v0.3.0 成套一致，避免英文/标签档被套用纯中文说明。
const STYLE_PROMPT_SET_V035: Record<OutputStyle, string> = {
  ...STYLE_PROMPT_SET_V030,
  'natural-zh':
    '根据图片结构合理分段详细描述提示词，不严格规定有几段，但是大概保留3-8段落，提示词为中文自然语言+参数，通用的提示词不适配模型，只返回提示词本体，不要出现违规提示词',
};

// v_native：极简「图像 → 中文提示词」；反推时由 extract 固定取 natural-zh，四套 key 同文以降低歧义。
const NATIVE_PROMPT_BODY =
  '请根据参考图直观写出可作为文生图模型输入的高质量中文提示词。只输出提示词正文：不要标题、前缀、后缀、分项、Markdown 或开场套话（如「这是一张图」「画面展示了」）；只描述画面中可见或可合理推断的视觉信息，看不清或未出现的内容请勿编造、勿脑补镜头外叙事。';

const STYLE_PROMPT_SET_NATIVE: Record<OutputStyle, string> = {
  'natural-zh': NATIVE_PROMPT_BODY,
  'natural-en': NATIVE_PROMPT_BODY,
  'sd-tags': NATIVE_PROMPT_BODY,
  midjourney: NATIVE_PROMPT_BODY,
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
  'v0.2.2': STYLE_PROMPT_SET_V022,
  'v0.3.0': STYLE_PROMPT_SET_V030,
  'v0.3.5': STYLE_PROMPT_SET_V035,
  v_native: STYLE_PROMPT_SET_NATIVE,
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
  // v0.3.0：从 v0.2.2 的 (0.3, 1280) 做一步调整。
  // - 温度保持 0.3 不变：v0.2.2 验证过 0.3 在维度清单下稳定性好，继续沿用。
  // - maxTokens 1280 → 1536：v0.3.0 的完整句子格式天然比标签格式更长，且
  //   新增了"摄影技术参数"维度（相机/镜头/光圈/景深/胶片），实测 8 维度的
  //   中文完整句子展开经常推到 1200~1400 token，1280 截断风险高，1536 给
  //   足 20% 余量。
  'v0.3.0': { temperature: 0.3, maxTokens: 1536 },
};

// ----- customJoin 各版本 -----

export const CUSTOM_JOINS: Record<CustomJoinVersion, CustomJoinPosition> = {
  'v0.1.0': 'append',
  // v0.2.2：从 v0.1.0 的 append 切换到 prepend。
  // v0.1.0 用 append 是为了"经典兼容"——把用户偏好以"额外要求："形式挂尾部。
  // 但在 v0.2.2 的 10 维度清单下，append 会让用户写的"按吉卜力赛璐璐风、暖色
  // 调"这种偏好出现在 attention 衰减尾部，模型已经按图里推断出的"写实摄影"填
  // 完了画风 / 镜头维度，再回头看到"按吉卜力"已经晚了，权重低、跟随性差。
  // prepend 让用户偏好先入上下文，10 维度的填充顺着这个偏好走，跟随性显著提升。
  'v0.2.2': 'prepend',
  // v0.3.0：沿用 v0.2.2 的 prepend。原因同 v0.2.2 注释：用户偏好先入上下文，
  // 后续维度填充顺着偏好走，跟随性更好。对于 GPT Image 2 / Nano Banana 的
  // 使用场景尤其重要——用户可能写"吉卜力风格"或"赛博朋克"，prepend 保证
  // 风格锚定词出现在 attention 最强的头部位置。
  'v0.3.0': 'prepend',
};

// ============================================================
// 2. 策略 = 组件版本组合（resolve 层）
// ============================================================

/**
 * 对外暴露给消费侧（api/index.ts、SettingsView 等）的扁平化结果。
 *
 * = id（来自 STRATEGIES 的 key）+ StrategyDefinition 内容 + 由 components 解析
 * 出来的 4 个具体值。下游代码读 stylePrompts / temperature / maxTokens /
 * customPosition 这 4 个字段的写法和重构前的 PromptStrategy 完全一致，迁移成本为零。
 * 需要展示组件版本指纹时再额外读 `components` 字段。
 */
export interface ResolvedStrategy extends StrategyDefinition {
  id: StrategyId;
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
// 3. resolve：把组件版本引用展开成可直接消费的扁平对象
// ============================================================

/**
 * 把一档策略（按 id 索引到 STRATEGIES）解析成下游可以直接读的扁平结构。
 *
 * 解析失败（组件版本号未在注册表登记）时不静默兜底——直接抛错。原因是这种情况
 * 一定是代码 bug（比如 typo 了一个版本号），让它在开发期立刻暴露比线上吐空字符串
 * 安全得多。生产侧的"未知策略 id"由 getStrategy 在更上层兜底。
 */
export function resolveStrategy(id: StrategyId): ResolvedStrategy {
  const def = STRATEGIES[id];
  const { stylePromptSet, sampling, customJoin } = def.components;
  const sp = STYLE_PROMPT_SETS[stylePromptSet];
  const sm = SAMPLING_PROFILES[sampling];
  const cj = CUSTOM_JOINS[customJoin];
  if (!sp || !sm || cj === undefined) {
    throw new Error(
      `[strategies] 策略 "${id}" 引用了不存在的组件版本：` +
        `stylePromptSet=${stylePromptSet}, sampling=${sampling}, customJoin=${customJoin}`
    );
  }
  return {
    id,
    label: def.label,
    description: def.description,
    components: def.components,
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
 * - 传一个未来才存在 / 拼错 / 已下线（如老用户存的 'v010' / 'v016'）的 id → 也回退到
 *   默认，避免「升级后切策略找不到字段」崩溃。
 *
 * 返回的是已 resolve 完毕的扁平 ResolvedStrategy，调用方读 stylePrompts /
 * temperature / maxTokens / customPosition 这 4 个字段的写法和重构前完全一致。
 */
export function getStrategy(id: StrategyId | undefined | null): ResolvedStrategy {
  const safeId: StrategyId = id && id in STRATEGIES ? (id as StrategyId) : DEFAULT_STRATEGY_ID;
  return resolveStrategy(safeId);
}

/**
 * 把用户自由组合的组件版本解析成可直接消费的扁平 ResolvedStrategy。
 *
 * 与 resolveStrategy 的区别：resolveStrategy 从 STRATEGIES[id] 拿 components，
 * 这里直接接受外部传入的 components（来自 AppSettings.customComponents）。
 *
 * overrides（阶段 3）允许用户进一步覆盖指令文本和采样参数，
 * 覆盖层优先级高于 components 引用的版本。
 */
export function resolveCustomStrategy(
  components: StrategyComponents,
  overrides?: {
    instruction?: string;
    temperature?: number;
    maxTokens?: number;
    joinPosition?: CustomJoinPosition;
  }
): ResolvedStrategy {
  const sp = STYLE_PROMPT_SETS[components.stylePromptSet];
  const sm = SAMPLING_PROFILES[components.sampling];
  const cj = CUSTOM_JOINS[components.customJoin];
  if (!sp || !sm || cj === undefined) {
    throw new Error(
      `[strategies] 自定义组合引用了不存在的组件版本：` +
        `stylePromptSet=${components.stylePromptSet}, sampling=${components.sampling}, customJoin=${components.customJoin}`
    );
  }
  const resolved: ResolvedStrategy = {
    id: 'custom',
    label: '自定义组合',
    description: `指令集@${components.stylePromptSet} · 采样@${components.sampling} · 拼接@${components.customJoin}`,
    components,
    stylePrompts: { ...sp },
    temperature: sm.temperature,
    maxTokens: sm.maxTokens,
    customPosition: cj,
  };

  if (overrides?.instruction) {
    for (const key of Object.keys(resolved.stylePrompts) as (keyof typeof resolved.stylePrompts)[]) {
      resolved.stylePrompts[key] = overrides.instruction;
    }
  }
  if (overrides?.temperature != null) resolved.temperature = overrides.temperature;
  if (overrides?.maxTokens != null) resolved.maxTokens = overrides.maxTokens;
  if (overrides?.joinPosition) resolved.customPosition = overrides.joinPosition;

  return resolved;
}

/**
 * UI 侧需要轮询的所有策略列表，按 STRATEGIES 声明顺序返回。
 *
 * 写成函数（lazy）而不是 module-scope 顶层 const，是为了让 content script 这种
 * 对 bundle 体积敏感的环境**只 import STRATEGY_LABELS 时不会把 STYLE_PROMPT_SETS
 * 等重对象 trace 进 bundle**。函数体内的 resolveStrategy 调用要 evaluate 到
 * heavy 维度表，所以只能让"实际用到列表的调用方"（如设置面板）通过函数显式触发。
 *
 * 调用一次约 4~10 次解析、几十 µs，UI 渲染期间一次性算完即可，不需要缓存。
 * 想要稳定的渲染顺序就调整 STRATEGIES_INTERNAL 里 key 的位置。
 */
export function getStrategyList(): ResolvedStrategy[] {
  return (Object.keys(STRATEGIES) as StrategyId[]).map((id) => resolveStrategy(id));
}
