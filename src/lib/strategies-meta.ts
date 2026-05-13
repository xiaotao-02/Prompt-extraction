/**
 * 提示词「策略档位」的**轻量元信息层**（label / description / 组件版本引用）。
 *
 * ──────────────── 为什么单独一个文件 ────────────────
 * `strategies.ts` 里同时持有：
 *   (a) STRATEGIES 这种"档位 → 3 个组件版本号"的轻量映射表
 *   (b) STYLE_PROMPT_SETS / SAMPLING_PROFILES / CUSTOM_JOINS 这些含几 KB 中英文
 *       prompt 字符串的重对象
 *   (c) resolveStrategy / getStrategy / getStrategyList 这些会读 (b) 的解析函数
 *
 * content script 只需要 (a)（具体来说就是 STRATEGY_LABELS：把 loading 面板顶部的
 * "策略：v0.1.5 策略" 这条 badge 文本渲出来）。如果它直接 `import { STRATEGY_LABELS }
 * from './strategies'`，Vite/Rollup 会把 `strategies.ts` 整体打成一个 shared chunk，
 * 哪怕 STRATEGY_LIST 已经改成 lazy 函数、(b) 的 heavy 字符串理论上可以 tree-shake
 * 掉，但只要 service worker / SettingsView 那两条入口同时也 import strategies.ts 的
 * 重 API，shared chunk 就会包含 (b)，content script 跟着把整块 shared chunk 拉下来。
 *
 * 物理拆文件之后：
 *   - content script `import from '@/lib/strategies-meta'`：只拉到 (a)，**不会
 *     在依赖图里出现 STYLE_PROMPT_SETS**，shared chunk 不可能把它带过来。
 *   - service worker / SettingsView `import from '@/lib/strategies'`：仍能拿到全部
 *     API（包括 (a) 的 re-export）。
 *
 * 实测重构前 content chunk + shared chunk 比拆分后多 ~26KB（就是 STYLE_PROMPT_SETS
 * 的体积），所以这一拆是有意义的。
 *
 * ──────────────── 加 / 删一档策略仍然只改 1 处 ────────────────
 * 在下面的 `STRATEGIES_INTERNAL` 里加 / 删一个 key 即可：
 *   - StrategyId 类型 = `keyof typeof STRATEGIES_INTERNAL`
 *   - STRATEGY_LABELS = `Object.fromEntries(Object.entries(STRATEGIES).map(...))`
 *   - getStrategyList()（在 strategies.ts）按 `Object.keys(STRATEGIES)` 声明顺序产出
 *   - types.ts 里 `export type { StrategyId } from './strategies'` 自动跟随
 * 不需要去 4 个文件改 5 处再担心漏改一个就静默走默认值。
 */

// ============================================================
// 1. 组件版本号 type（纯字面量类型，零运行时）
// ============================================================

/**
 * stylePromptSet 组件的版本号。新增版本时只追加，不改老版本（历史档要靠它锚定）。
 *
 * 真正的版本注册表 (`STYLE_PROMPT_SETS`) 在 strategies.ts，那里有几 KB 的 prompt
 * 字符串；这里只保留版本号字面量 type 给 components 字段引用，不会带任何运行时代价。
 */
export type StylePromptSetVersion = 'v0.1.0' | 'v0.1.1' | 'v0.2.2';
/** sampling 组件的版本号。同上，只是 type，注册表在 strategies.ts。 */
export type SamplingVersion = 'v0.1.0' | 'v0.2.2';
/** customJoin 组件的版本号。同上，只是 type，注册表在 strategies.ts。 */
export type CustomJoinVersion = 'v0.1.0' | 'v0.2.2';

/**
 * 用户在「额外提示词」里填的内容如何与 base 拼接：
 *   - 'prepend' = `${custom}\n\n${base}`           —— 让自定义当一等公民
 *   - 'append'  = `${base}\n\n额外要求：${custom}` —— 经典版兼容写法
 */
export type CustomJoinPosition = 'prepend' | 'append';

// ============================================================
// 2. 策略定义（轻量值，不含具体 prompt 文本）
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
 * 一档策略的「元信息（label/description）+ 它选用的组件版本组合」。
 *
 * 注意这里**不带 id 字段**——id 由 STRATEGIES 的对象 key 唯一表达，避免
 * "key 写成 'classic'、id 字段写成 'classsic'" 这种双写不一致的脏数据。
 * 需要 id 的地方（ResolvedStrategy / getStrategy）会在 resolve 时把 key 注入回来。
 */
export interface StrategyDefinition {
  /** UI 上显示的简短名 */
  label: string;
  /** UI 上显示的一句话说明，告诉用户切到这档大概会有什么不同 */
  description: string;
  /** 这档策略选用的 3 个组件版本组合。 */
  components: StrategyComponents;
}

// ============================================================
// 3. 内置策略：每个对象 key 就是 id，自动派生 StrategyId
// ============================================================

/**
 * 内部声明：用 `as const satisfies` 既保证写错字段类型时 TS 立刻报错，又能让
 * `keyof typeof` 派生出精确的字面量联合作为 StrategyId。
 *
 * UI 显示顺序 = 这里的声明顺序（JS 对象保留 key 插入顺序）。想调整顺序就调
 * 这里 key 的位置，STRATEGY_LABELS / getStrategyList() 都会自动跟着。
 *
 * **加新策略 / 删旧策略只需要改这一处**：
 *   - 增：在下面加一个 key（label / description / components 三个字段）
 *   - 删：删一行 key
 * StrategyId 类型、STRATEGY_LABELS、getStrategyList()、SettingsView 选择器、
 * loading 面板的策略 badge 都会自动同步。
 */
const STRATEGIES_INTERNAL = {
  // classic 在 UI 上显示为 "v0.1.5 策略" —— 因为查 git tag v0.1.1 ~ v0.1.6 的源码，
  // stylePrompts/temperature/maxTokens/customPosition 这 4 项一字未改，v0.1.5
  // 那一版的行为本质就是 v0.1.0 那组组件版本。这里 key 仍叫 'classic' 是为了
  // 兼容老用户 settings 里持久化的字段（旧值不会因为重命名而失效）。
  classic: {
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
    label: 'v0.2.2 策略',
    description:
      '温度 0.3 · 上限 1280 token · 自定义模板前置。从 v0.1.0 直接演化：10 维度显式清单 + 三禁（模板句 / 主观水词 / 脑补图外）+ 空槽位静默跳过 + 维度名不打印。颜色强制具体色名、光照强制方向+强度+色温+质感。优先级：还原度 ≈ 用户跟随性 ≫ 速度。',
    components: {
      stylePromptSet: 'v0.2.2',
      sampling: 'v0.2.2',
      customJoin: 'v0.2.2',
    },
  },
} as const satisfies Record<string, StrategyDefinition>;

/**
 * 策略 id 类型。从 STRATEGIES 的 key 自动派生。
 *
 * 加一档策略 → STRATEGIES_INTERNAL 加一个 key → StrategyId 自动包含新字面量；
 * 删一档同理。types.ts 通过 type-only re-export 暴露这个类型。
 */
export type StrategyId = keyof typeof STRATEGIES_INTERNAL;

/**
 * 对外暴露的不可变副本。`Readonly<Record<StrategyId, StrategyDefinition>>` 让消费方
 * 既能用精确 id 索引（编译期检查未知 id），又禁止误改内部表。
 */
export const STRATEGIES: Readonly<Record<StrategyId, StrategyDefinition>> = STRATEGIES_INTERNAL;

/**
 * 新装用户的缺省策略。
 *
 * 选 classic（"v0.1.5 策略"）作为默认而不是 v016，是因为它在历史上是更早被
 * 大量用户感知的"原始行为基线"，措辞最稳；v016 只是给"我就要 v0.1.6 那一版
 * 输出感"的用户的显式回滚入口。两者数值等价，所以默认走哪一档对体验没差，
 * 这里更看重命名上的"基线感"。
 *
 * 类型用 StrategyId 自动收紧，写错字面量编译期就报。
 */
export const DEFAULT_STRATEGY_ID: StrategyId = 'classic';

/**
 * 轻量 id → label 映射。**只读 STRATEGIES 的 label 字段**，不依赖 STYLE_PROMPT_SETS
 * 等重对象，所以可以从 content script 这种对 bundle 体积敏感的环境直接 import 使用，
 * 不再需要在那一侧维护一份重复的 STRATEGY_LABEL 表。
 */
export const STRATEGY_LABELS: Record<StrategyId, string> = Object.fromEntries(
  (Object.keys(STRATEGIES) as StrategyId[]).map((id) => [id, STRATEGIES[id].label])
) as Record<StrategyId, string>;
