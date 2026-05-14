# Prompt Extracto 架构与策略优化路线图

> 基于 2026-05 行业调研与项目现状分析，覆盖架构层 + 策略层 + 工程效率三个维度。
> 每项改动标注优先级（P0 立即 / P1 短期 / P2 中期 / P3 远期）、预估工作量、收益与风险。

---

## 目录

1. [现状摘要](#1-现状摘要)
2. [P0：立即可做的高 ROI 改动](#2-p0立即可做的高-roi-改动)
3. [P1：短期策略内容迭代](#3-p1短期策略内容迭代)
4. [P2：中期架构升级](#4-p2中期架构升级)
5. [P3：远期能力扩展](#5-p3远期能力扩展)
6. [风险与回退](#6-风险与回退)
7. [参考资料](#7-参考资料)

---

## 1. 现状摘要

| 维度 | 现状 |
|------|------|
| 构建框架 | Vite 6 + @crxjs/vite-plugin（开发活跃度下降） |
| UI 框架 | React 18 + Tailwind CSS v4 + lucide-react |
| 状态管理 | React useState/useRef + chrome.storage；zustand 声明但**未使用** |
| Content Script | 命令式 DOM + Shadow DOM（~2000 行跨 templates/styles/events/geometry） |
| 策略系统 | 3 组件版本化（stylePromptSet / sampling / customJoin），加一档改 2 文件 |
| 当前策略 | classic（v0.1.0）、v0.2.2、v0.3.0 |
| 长文件 | `background/index.ts`（747 行）、`events.ts`（814 行）、`styles.ts`（729 行） |

---

## 2. P0：立即可做的高 ROI 改动

### 2.1 图片 resize 预处理（省 API 成本）

**问题**：当前直接发送原图 base64，高分辨率图片 token 消耗巨大。

**方案**：在 `src/lib/image.ts` 的 `fetchImageAsBase64` 流程中加入 canvas resize。

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/lib/image.ts` | 新增 `resizeImage(base64, maxDim)` 函数 |
| `src/background/index.ts` | 在 `runExtraction` 调用链中插入 resize |

**实现要点**：

```typescript
// src/lib/image.ts 新增
export async function resizeImage(
  base64: string,
  maxDim: number = 512
): Promise<string> {
  // 用 OffscreenCanvas（Service Worker 兼容）或 createImageBitmap
  // 短边不变、长边缩到 maxDim，保持宽高比
  // 输出 JPEG quality 0.85，比 PNG 小 60%+
}
```

**收益**：API token 消耗减少 60-80%，响应速度提升。

**风险**：极少数场景（如图中有小字）可能丢失细节。→ 可在设置中暴露 `imageMaxDim` 选项，默认 512，高级用户可调到 1024。

**预估工作量**：~50 行代码，半天。

---

### 2.2 清理未使用的 zustand 依赖

**问题**：`package.json` 声明了 `zustand ^5.0.2`，但源码中无任何引用，误导维护者。

**执行**：

```bash
npm uninstall zustand
```

**预估工作量**：1 分钟。

---

### 2.3 v0.1.1 幽灵版本清理

**问题**：`StylePromptSetVersion` 曾有 `'v0.1.1'`（plan 文档可见），但当前代码中 `STYLE_PROMPT_SETS` 注册表里没有 `'v0.1.1'` 条目，已在某次重构中删除指令但可能未清理类型。需确认类型定义是否与注册表一致。

**执行**：检查 `strategies-meta.ts` 中 `StylePromptSetVersion` 是否仍包含 `'v0.1.1'`，若是则删除。

**预估工作量**：5 分钟。

---

## 3. P1：短期策略内容迭代

### 3.1 新建 v0.3.1 策略 —— 适配 Nano Banana 2 最新范式

**背景**：Nano Banana 2（Gemini 3.1 Flash Image，2026-03 发布）的最佳实践与 v0.3.0 设计时的参考有几处关键差异：

| 维度 | v0.3.0 当前 | Nano Banana 2 最新建议 | 调整方向 |
|------|------------|----------------------|---------|
| 维度顺序 | 风格打头 | **Spec-first**：主体 → 构图 → 场景 → 风格 | 主体前置 |
| 形容词限制 | 全篇 ≤8 | 关键是**具体性** > 数量限制 | 放宽到 ≤12，但强制具体 |
| 约束区 | 仅禁止否定 | 末尾需要 **"Must include / Must not change"** | 新增锁定区 |
| 迭代友好 | 单次输出 | 鼓励 **"keep everything, only change X"** | 输出带段落标记 |

**涉及文件**：

| 文件 | 改动类型 |
|------|---------|
| `src/lib/strategies-meta.ts` | 追加版本号类型 + STRATEGIES_INTERNAL 条目 |
| `src/lib/strategies.ts` | 追加 STYLE_PROMPT_SET_V031 + 注册 |

**v0.3.1 指令设计核心**：

```
维度顺序（Spec-first）:
  (1) 主体 → (2) 构图/动作/姿态 → (3) 场景+光照 →
  (4) 风格锚定 → (5) 色彩 → (6) 摄影技术参数 → (7) 关键约束

形容词规则：≤12 个，每个必须是具体可视化的（禁止 "beautiful/stunning"）
句式：完整句子，肯定句式
末尾约束区：输出 "Key elements: [3-5 个不可变锚点]" 辅助用户迭代
```

**采样参数**：沿用 v0.3.0 的 `(0.3, 1536)`。

**预估工作量**：1 天（含 A/B 对比测试）。

---

### 3.2 Few-Shot 示例增强机制

**问题**：当前所有策略都是 zero-shot，输出一致性依赖指令的详细程度。对于结构化输出任务，1-2 个示例可显著提升格式跟随性。

**方案**：在 `StrategyComponents` 中新增可选的 `fewShotExamples` 组件维度。

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/lib/strategies-meta.ts` | 新增 `FewShotVersion` 类型 + `StrategyComponents.fewShot?` 可选字段 |
| `src/lib/strategies.ts` | 新增 `FEW_SHOT_EXAMPLES` 注册表 + `resolveStrategy` 中拼接 |
| `src/lib/api/extract.ts` | 构造 prompt 时拼入示例（如有） |

**示例格式**：

```typescript
// 每条示例 = 一个 { imageDescription, expectedOutput } 对
// imageDescription 用文字描述参考图（不实际传图），expectedOutput 是期望的 prompt
const FEW_SHOT_V031: Record<OutputStyle, Array<{ input: string; output: string }>> = {
  'natural-zh': [
    {
      input: '一张半身人像照，女性，黑色短发，穿蓝色西装，室内办公室背景',
      output: '一位约 30 岁的东亚女性……（示范输出）'
    }
  ],
  // ...
};
```

**收益**：输出格式一致性提升，减少 "偏科" 现象。

**代价**：每次请求多消耗 ~200 token。

**预估工作量**：1-2 天（含精选示例的人工编写与验证）。

---

### 3.3 Provider 感知的指令微调

**问题**：不同 VLM 后端的指令跟随能力差异很大：

| Provider | 指令跟随 | 建议 |
|----------|---------|------|
| GPT-4o / Claude | 强 | 8+ 维度无压力 |
| Gemini Flash | 中等 | 简短指令更友好，维度 ≤6 |
| 开源模型（Qwen 等） | 弱 | 核心维度 5-6 个 |

**方案**：在 `resolveStrategy` 中，根据当前 `settings.provider` 选择指令的 "详细版" 或 "精简版"。

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/lib/strategies.ts` | `STYLE_PROMPT_SETS` 值从 `string` 扩展为 `string | { full: string; lite: string }` |
| `src/lib/strategies.ts` | `resolveStrategy` 新增可选 `providerHint` 参数 |
| `src/lib/api/extract.ts` | 传入 provider 信息 |

**预估工作量**：1 天。

---

## 4. P2：中期架构升级

### 4.1 Content Script 状态机重构

**问题**：`events.ts`（814 行）用命令式 if-else 处理面板交互，状态散落在闭包和模块变量中，新增功能时容易遗漏状态转换。

**方案**：提取有限状态机，不换框架：

```
States:  idle → pending → streaming → result → error → editing → refining
Events:  EXTRACT_PENDING / PROGRESS / RESULT / ERROR / COPY / EDIT / REFINE / CLOSE
```

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `src/content/panel/state.ts` | 新增 `PanelFSM` 类，定义状态 + 转换表 |
| `src/content/panel/events.ts` | 重构为 FSM 事件分发 |
| `src/content/panel/templates.ts` | 按状态渲染（`renderForState(state)`） |

**收益**：
- 每种状态下的 UI 和行为一目了然
- 新增状态（如 "版本对比"）只需加一行转换，不改现有逻辑
- 可单元测试状态转换

**预估工作量**：3-5 天。

---

### 4.2 Background Service Worker 拆分

**问题**：`background/index.ts`（747 行）单文件承担：右键菜单注册、提取调度、历史持久化、消息路由、更新检查。

**方案**：按职责拆分为模块：

```
src/background/
  index.ts          ← 入口：注册 listener，委托给子模块
  context-menu.ts   ← 右键菜单创建与更新
  extraction.ts     ← runExtraction + 流式进度
  history.ts        ← persistHistory + 缩略图
  messages.ts       ← onMessage 路由表
  updater.ts        ← 版本检查（如已存在则保持）
```

**收益**：单文件 ≤200 行，git diff 冲突减少，可独立审查。

**预估工作量**：2-3 天（纯重构，零功能变更）。

---

### 4.3 CRXJS → WXT 迁移

**背景**：@crxjs/vite-plugin 开发活跃度持续下降（2025 年起 commit 频率骤降），已知的增量缓存问题（旧图标残留、HMR 偶发失效）在 WXT 中已解决。

**WXT 优势**：

| 维度 | 现状 (CRXJS) | 迁移后 (WXT) |
|------|-------------|-------------|
| 跨浏览器 | Chrome + Edge | + Firefox + Safari |
| 维护 | 放缓 | 活跃（2026 年社区最推荐） |
| 缓存 | 需手动 `Remove-Item dist` | 自动处理 |
| 内置 API | 无 | auto-imports、storage API、i18n |
| 入口约定 | `manifest.config.ts` 手写 | 文件系统约定 + 类型安全 |

**迁移步骤**：

1. `npm create wxt@latest` 在临时目录，参考入口约定
2. 迁移 manifest 配置到 WXT 约定（`wxt.config.ts`）
3. 迁移入口文件路径（`background.ts` → `entrypoints/background.ts`）
4. 迁移 content script（`entrypoints/content.ts`）
5. 迁移 popup / options（`entrypoints/popup/`、`entrypoints/options/`）
6. 移除 `@crxjs/vite-plugin`，验证构建
7. 跨浏览器验证（Chrome / Edge / Firefox）

**风险**：
- WXT 的文件系统约定与当前目录结构差异较大，需要一次性调整
- Tailwind CSS v4 + WXT 可能需要额外配置验证

**预估工作量**：3-5 天（含验证）。

---

### 4.4 React 18 → React 19 升级

**收益**：
- 内存开销减少 42%
- 首次绘制延迟减少 ~68ms（对 popup/options 有感）
- `createRoot` 原生支持 Shadow DOM 容器
- `useSyncExternalStore` 稳定版优化跨 context 状态同步

**依赖兼容性检查**：

| 依赖 | React 19 兼容 |
|------|-------------|
| react-dom | 需同步升级 |
| @vitejs/plugin-react | v4.x 已支持 |
| lucide-react | 需验证最新版 |
| @types/react | 需升级到 19.x |

**预估工作量**：1-2 天（含回归验证）。

---

## 5. P3：远期能力扩展

### 5.1 Chrome 内置 Prompt API 集成（免费降级）

**场景**：用户未配置 API Key 时，用浏览器本地的 Gemini Nano 做基础提取。

**硬件要求**：22GB 存储 + GPU (>4GB VRAM) 或 CPU (16GB+ RAM)。

**实现要点**：
- 检测 `chrome.aiOriginTrial` 或 `self.ai` API 可用性
- 新增 `local-gemini` provider
- 降级提示：「本地模型能力有限，建议配置云端 API 获取更好效果」

**预估工作量**：2-3 天。

---

### 5.2 结构化输出策略（v0.4.0）

**理念**：输出从 "一段密集文本" 进化为 "产品规格书"，方便用户逐段编辑后再喂给生图模型。

**输出格式示例**：

```
Subject: 一位约 25 岁的东亚女性，黑色波浪长发……
Composition: 半身特写，45 度侧面……
Scene + Lighting: 城市天台，日落时分……
Style: cinematic photography, editorial fashion
Camera: Canon EOS R5, 85mm f/1.4, 浅景深……
Key anchors: [黑色皮夹克, 天台栏杆, 金色夕阳]
```

**好处**：
- 用户可编辑单段而不破坏整体
- `Key anchors` 段辅助迭代（"保持 anchors 不变，改 Style 为吉卜力水彩"）
- 适配 Nano Banana 2 的 "follow-up instruction" 工作流

**预估工作量**：2-3 天。

---

### 5.3 自动 A/B 评估管线

**问题**：新策略的效果评估当前靠人工目测。

**方案**：
1. 准备 20-30 张标准测试图（覆盖人像/风景/插画/产品等品类）
2. 用不同策略分别提取提示词
3. 把提取的提示词喂给目标模型（GPT Image 2 / Nano Banana 2）生成图
4. 用 VLM 对比原图与生成图的相似度，输出评分

可用 Playwright + API 脚本半自动化。

**预估工作量**：3-5 天搭建管线。

---

## 6. 风险与回退

| 改动 | 主要风险 | 回退策略 |
|------|---------|---------|
| 图片 resize | 小字/细节图丢信息 | 设置项 `imageMaxDim`，默认 512 可调 |
| v0.3.1 策略 | 新顺序可能在某些 VLM 上偏科 | 保留 v0.3.0，v0.3.1 并存 |
| Few-Shot | token 消耗增加 ~15% | 可选开关或仅对高级策略启用 |
| Content 重构 | 回归 bug | 逐模块重构，每次只动一个文件 |
| CRXJS → WXT | 构建行为差异 | 新分支进行，完全验证后合并 |
| React 19 | 第三方库不兼容 | 独立分支验证，不急于合入 |

---

## 7. 参考资料

- [WXT vs Plasmo vs CRXJS 2026 对比](https://trybuildpilot.com/649-wxt-vs-plasmo-vs-crxjs-2026)
- [Chrome Extension MV3 Architecture Overview](https://chrome.jscn.org/docs/extensions/mv3/architecture-overview)
- [Chrome Prompt API (Gemini Nano)](https://developer.chrome.com/docs/extensions/ai/prompt-api)
- [Nano Banana 2 Prompting Playbook](https://rephrase-it.com/blog/prompting-nano-banana-2-gemini-31-flash-image-the-practical-)
- [How to Write Better Nano Banana 2 Prompts](https://rephrase-it.com/blog/how-to-write-better-nano-banana-2-prompts)
- [Ultimate Prompting Guide for Nano Banana (Google Cloud)](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana)
- [React 19 in Browser Extensions](https://dev.to/johalputt/deep-dive-how-react-react-19-works-in-browser-extensions-with-content-scripts-and-background-workers-13ki)
- [Production Chrome Extension Structure (MV3)](https://dev.to/hewitt/how-to-structure-a-production-ready-chrome-extension-manifest-v3-2hlf)

---

## 执行时间线建议

```
Week 1  ─── P0 全部 + P1.1（v0.3.1 策略）
Week 2  ─── P1.2（Few-Shot）+ P1.3（Provider 感知）
Week 3  ─── P2.1（Content 状态机）+ P2.2（Background 拆分）
Week 4  ─── P2.3（WXT 迁移，新分支）
Week 5  ─── P2.4（React 19）+ P3 规划启动
```

> **原则**：每个 P 阶段独立可交付、独立可回退，不做跨阶段耦合改动。
