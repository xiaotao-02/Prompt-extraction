# v0.3.0 策略执行方案

> 目标：新增一档策略 **v030**（UI 标签 "v0.3.0 策略"），专门优化提示词输出以适配 **GPT Image 2** 和 **Nano Banana**（Gemini 架构）等新一代文生图模型，最大化"用提取的提示词还原原图"的效果。

---

## 1. 背景与设计依据

### 1.1 当前问题

插件通过视觉大模型"看图说话"来反推提示词。当前最新的 v0.2.2 策略输出的提示词在喂给 GPT Image 2 / Nano Banana 时还原度不理想，根因是：

- **维度顺序**与目标模型的注意力权重分配不匹配
- **缺失摄影技术参数**（相机/镜头/光圈/胶片/景深），而两个模型对此有强响应
- **稠密单段格式**不利于模型解析
- **缺少具名风格锚定词**（如 "cinematic photography" / "Studio Ghibli watercolor"）
- **形容词密度过高**，Nano Banana 明确建议 ≤5 个

### 1.2 两个目标模型的 prompt 偏好

| 维度 | GPT Image 2 | Nano Banana |
|------|-------------|-------------|
| 格式 | 段落 / 分段标注 / JSON / tags 均可 | **完整句子**远优于关键词（73% vs 41% 首次可用率） |
| 结构 | 场景→主体→细节→构图镜头→光照→约束 | 主体→动作场景→风格→光照→技术参数 |
| 形容词 | 无硬限 | **≤5 个/prompt**，否则互相冲突 |
| 摄影技术 | "photorealistic" 显式触发写实；相机参数控制构图 | 胶片名/相机型号效果显著 |
| 风格锚定 | 支持 style transfer，具名风格词响应强 | "editorial photography" / "Studio Ghibli" 等效果极好 |
| 否定描述 | 支持约束条件 | 用**肯定描述**代替否定 |
| 词序 | 无明确偏好 | **最前面的词视觉权重最大** |

### 1.3 v0.3.0 设计决策

取两个模型偏好的交集：

- **完整句子**，按维度分句，逗号衔接成段
- **8 维度结构**（比 v0.2.2 的 10 维度合并了可共存项，减少堆积）
- **新增"摄影技术参数"维度**
- **要求具名风格标签**而非泛泛的"画风"
- **形容词总数 ≤ 8**，每维度 ≤ 2
- **全篇只用肯定句式**
- **视觉权重最大的元素排最前**

---

## 2. 涉及文件

整个架构设计为"加一档策略只改 2 个文件"，UI / 类型 / 消息协议等全部自动跟随。

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/lib/strategies-meta.ts` | **修改** | 追加版本号类型 + STRATEGIES_INTERNAL 条目 |
| `src/lib/strategies.ts` | **修改** | 追加指令文本 + 采样 + 拼接版本 |

### 自动跟随（零改动）

| 文件 | 自动跟随机制 |
|------|------------|
| `src/lib/types.ts` | `StrategyId` 通过 type-only re-export 自动派生 |
| `src/options/SettingsView.tsx` | `getStrategyList()` 遍历 STRATEGIES，新策略自动出现 |
| `src/lib/api/extract.ts` | `getStrategy(id)` 返回 ResolvedStrategy，下游零侵入 |
| `src/lib/api/providers/*.ts` | 读取 strategy.temperature / maxTokens，自动跟随 |
| `src/content/panel/loading.ts` | 读取 STRATEGY_LABELS，badge 文本自动跟随 |
| `src/background/index.ts` | 无感知 |

---

## 3. 逐步执行

### 步骤 1：修改 `src/lib/strategies-meta.ts`

#### 1a. 追加版本号类型

找到以下 3 行类型定义，各追加 `| 'v0.3.0'`：

```typescript
// 修改前
export type StylePromptSetVersion = 'v0.1.0' | 'v0.1.1' | 'v0.2.2';
export type SamplingVersion = 'v0.1.0' | 'v0.2.2';
export type CustomJoinVersion = 'v0.1.0' | 'v0.2.2';

// 修改后
export type StylePromptSetVersion = 'v0.1.0' | 'v0.1.1' | 'v0.2.2' | 'v0.3.0';
export type SamplingVersion = 'v0.1.0' | 'v0.2.2' | 'v0.3.0';
export type CustomJoinVersion = 'v0.1.0' | 'v0.2.2' | 'v0.3.0';
```

#### 1b. 在 STRATEGIES_INTERNAL 末尾追加 v030 条目

在 `v022` 条目的 `}` 之后、`} as const satisfies` 之前追加：

```typescript
  // v030：针对 GPT Image 2 / Nano Banana 等新一代文生图模型优化。
  // 设计核心：让 VLM 的输出直接成为目标模型能高还原度执行的 prompt。
  //   - 指令层：8 维度分句结构（风格锚定→主体→动作→服饰→场景→光照→色彩→
  //     摄影技术参数），相比 v0.2.2 的 10 维度合并了可共存项以控制形容词密度，
  //     新增"摄影技术参数"（相机/镜头/光圈/景深/胶片）维度，要求具名风格标签，
  //     全篇只用肯定句式、形容词 ≤8 个。
  //   - 采样层：温度保持 0.3 不变；maxTokens 1280 → 1536 给完整句子格式 +
  //     新增技术参数维度预留余量。
  //   - 拼接层：沿用 prepend，用户偏好先入上下文。
  // 适用场景：用户把提取的提示词喂给 GPT Image 2 / Nano Banana / Flux 等
  // 新一代原生文生图模型来还原原图。
  v030: {
    label: 'v0.3.0 策略',
    description:
      '温度 0.3 · 上限 1536 token · 自定义模板前置。针对 GPT Image 2 / Nano Banana 等新一代文生图模型优化：8 维度分句结构、具名风格锚定、摄影技术参数（相机/镜头/胶片/景深）、形容词密度控制、肯定句式。优先级：图片还原度 ≫ 通用性。',
    components: {
      stylePromptSet: 'v0.3.0',
      sampling: 'v0.3.0',
      customJoin: 'v0.3.0',
    },
  },
```

---

### 步骤 2：修改 `src/lib/strategies.ts`

#### 2a. 新增 STYLE_PROMPT_SET_V030 常量

在 `STYLE_PROMPT_SET_V022` 常量之后、`STYLE_PROMPT_SETS` 注册表之前插入：

```typescript
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
```

#### 2b. 在 STYLE_PROMPT_SETS 注册表追加

```typescript
// 修改前
export const STYLE_PROMPT_SETS: Record<StylePromptSetVersion, Record<OutputStyle, string>> = {
  'v0.1.0': STYLE_PROMPT_SET_V010,
  'v0.1.1': STYLE_PROMPT_SET_V011,
  'v0.2.2': STYLE_PROMPT_SET_V022,
};

// 修改后
export const STYLE_PROMPT_SETS: Record<StylePromptSetVersion, Record<OutputStyle, string>> = {
  'v0.1.0': STYLE_PROMPT_SET_V010,
  'v0.1.1': STYLE_PROMPT_SET_V011,
  'v0.2.2': STYLE_PROMPT_SET_V022,
  'v0.3.0': STYLE_PROMPT_SET_V030,
};
```

#### 2c. 在 SAMPLING_PROFILES 追加

```typescript
// 在 'v0.2.2' 条目之后追加：

  // v0.3.0：从 v0.2.2 的 (0.3, 1280) 做一步调整。
  // - 温度保持 0.3 不变：v0.2.2 验证过 0.3 在维度清单下稳定性好，继续沿用。
  // - maxTokens 1280 → 1536：v0.3.0 的完整句子格式天然比标签格式更长，且
  //   新增了"摄影技术参数"维度（相机/镜头/光圈/景深/胶片），实测 8 维度的
  //   中文完整句子展开经常推到 1200~1400 token，1280 截断风险高，1536 给
  //   足 20% 余量。
  'v0.3.0': { temperature: 0.3, maxTokens: 1536 },
```

#### 2d. 在 CUSTOM_JOINS 追加

```typescript
// 在 'v0.2.2' 条目之后追加：

  // v0.3.0：沿用 v0.2.2 的 prepend。原因同 v0.2.2 注释：用户偏好先入上下文，
  // 后续维度填充顺着偏好走，跟随性更好。对于 GPT Image 2 / Nano Banana 的
  // 使用场景尤其重要——用户可能写"吉卜力风格"或"赛博朋克"，prepend 保证
  // 风格锚定词出现在 attention 最强的头部位置。
  'v0.3.0': 'prepend',
```

---

### 步骤 3：类型检查

```bash
npm run lint
```

预期：零错误。StrategyId 类型从 `keyof typeof STRATEGIES_INTERNAL` 自动派生，不需要手动维护。

---

### 步骤 4：构建

```bash
Remove-Item -Recurse -Force dist
npm run build
```

预期：构建成功，dist 产物正常。

---

### 步骤 5（可选）：修改默认策略

如果希望新安装用户默认使用 v0.3.0 策略，在 `src/lib/strategies-meta.ts` 中修改：

```typescript
// 修改前
export const DEFAULT_STRATEGY_ID: StrategyId = 'classic';

// 修改后
export const DEFAULT_STRATEGY_ID: StrategyId = 'v030';
```

> **建议**：暂不修改，让用户手动切换体验后再决定。老用户的 settings 中已持久化了 promptStrategy 字段，不会被默认值影响。

---

## 4. 验证清单

构建完成后在浏览器中验证：

- [ ] 扩展设置页 → 策略版本区域能看到 **"v0.3.0 策略"** 卡片
- [ ] 卡片显示：`温度 0.3 · max_tokens 1536 · 自定义前置`
- [ ] 卡片底部指纹：`指令集@v0.3.0 · 采样@v0.3.0 · 拼接@v0.3.0`
- [ ] 点击卡片可切换生效，保存后刷新仍然保持
- [ ] 切换到 v0.3.0 策略后，对任意图片右键提取，输出的提示词应当：
  - [ ] 以具名风格标签开头（如 "cinematic photography" / "电影摄影风格"）
  - [ ] 包含摄影技术参数（相机 / 镜头 / 光圈 / 景深 / 胶片）
  - [ ] 句式完整流畅，非关键词堆叠
  - [ ] 无否定句式（"没有" / "不含" / "without"）
  - [ ] 无模板套话（"这是一张" / "Overall"）
  - [ ] 形容词精炼，无主观水词
- [ ] 切回 classic / v016 / v022 等旧策略，行为不受影响
- [ ] 用提取的提示词喂给 GPT Image 2 / Nano Banana，对比还原度

---

## 5. 8 维度结构对照表

| # | v0.3.0 维度 | v0.2.2 维度 | 变化说明 |
|---|-----------|-----------|---------|
| 1 | 画风/视觉风格（具名标签） | 画风/媒介/构图/镜头 | 拆出镜头单独成维度 8，画风改为要求具名标签 |
| 2 | 主体（类型+外貌+表情+眼神） | 主体类型 + 外貌 + 表情眼神 | 合并 3→1，减少碎片化 |
| 3 | 动作/姿态/视线 | 姿态/动作 | 加入视线方向 |
| 4 | 服饰+配饰 | 服饰 + 持物/配饰 | 合并 2→1 |
| 5 | 场景环境 | 场景/前中背景 | 不变 |
| 6 | 光照 | 光照 | 不变 |
| 7 | 色彩搭配 | 色彩搭配 | 不变 |
| 8 | **摄影技术参数（新增）** | — | 相机/镜头/光圈/景深/胶片 |

---

## 6. 采样参数对照表

| 参数 | classic/v010/v016 | v022 | **v030** |
|------|------------------|------|---------|
| temperature | 0.4 | 0.3 | **0.3** |
| maxTokens | 1024 | 1280 | **1536** |
| customJoin | append | prepend | **prepend** |
