# Prompt Extracto 更新说明（v0.1.14–v0.1.42）

本文档汇总 **自 Git 标签 `v0.1.14` 起至 `v0.1.42`（含）** 期间的能力与工程变更。

## 编写说明（重要）

- 该区间内大量提交仅为版本号占位或合并分支，**无法从 commit message 逐补丁号还原 changelog**。
- 下文按**功能主题**归纳；**不按每个 `0.1.x` 捏造条目标题**。
- **v0.1.14–v0.1.33** 主体依据 `git diff v0.1.13..v0.1.33` 与源码注释整理（与历史稿一致）。
- **v0.1.34–v0.1.42** 增量见文末专节，依据 `git diff v0.1.33..v0.1.42`。
- 仓库内的 [`docs/optimization-roadmap.md`](optimization-roadmap.md) 是未来架构与优化设想，**不代表已对用户发布的功能**，本文不将其列为「本次更新已实现」。

---

## 提示词库存储与性能

- **主存储迁移到 IndexedDB**：历史条目改为单条读写并带索引（全局排序、文件夹内排序、同图去重键等），替代在 `chrome.storage.local` 中整表 JSON 拖拽。
- **跨上下文一致性**：借助 `chrome.storage.local` 中的修订戳（如 `library_rev`）通知 Popup / Options / Background 等上下文失效本地分页缓存。
- **用户感知**：提示词条目增多时，选项页库的加载与操作更轻快；排序、文件夹视图与同图合并有明确的数据层支持。

---

## 提示词库：文件夹与项目管理

- **数据模型**：支持「项目 / 文件夹」分层（顶层可作项目，下级可任意嵌套）；删除文件夹时会将子结构上移，并将关联历史的 `folderId` 归为未分类而非产生孤儿数据。
- **界面**：文件夹树浏览、移动到文件夹、与大列表/卡片视图的联动（参见选项页「提示词库」相关界面）。

---

## 一键配置导入

- 支持从 **curl**、多种 **JSON** 导出形态（含本插件精简片段与早期完整 settings）、多款客户端导出、**.env** 风格等来源粘贴导入。
- 设计取向：**容错**、尽量根据 **URL 反推提供商**，减少对「必须先改成合法 JSON」的硬性要求。
- 与 **首次向导 / 设置页**联动，便于新用户粘贴厂商文档里的示例即可起步。

---

## 数据持久化、备份与版本状态

- **数据持久化**：推荐通过 File System Access API 指定本地「数据目录」双写到 `prompt-extracto-data.json`；不支持时仍可用手动导入导出 JSON。
- **安全闸门**：例如选回已有备份目录后不自动覆盖、同步检测到「数据集收缩」时要求二次确认等（详见 `DataPersistence.tsx` 内注释）。
- **版本链规范**：统一 `PromptVersion.versionNo`、`normalizePromptVersions` / `mirrorCurrentVersion` 等逻辑，保证 **当前版本始终在 `versions[0]`**，列表卡片、复制与版本侧栏与存储层一致。
- **Popup**：可删除单个历史版本（含删除「当前版本」时由下一条顶替）；精炼过程可接收 **`REFINE_PROGRESS`** 阶段性文本；列表通过 `library_rev` 与其它页保持同步。
- **`extensionBridge`**：集中 `isExtensionContextValid` / `safeSendMessage`，扩展上下文失效时避免控制台抛错。
- **内容脚本**：监听设置中的 **默认提取策略**，变更后无需刷新页面即可应用到面板策略展示；抽取进度 PATCH 支持附带 **provider / model**。
- **后台**：保存策略 (`SET_PROMPT_STRATEGY`)、打开选项页并可选 **直达「设置」Tab** (`OPEN_OPTIONS`)、更新检查的 **reject 兜底**；**从历史召回面板到页面**时优先按条目 `pageUrl` 查找已打开标签页，否则新开该 URL；右键提取可走 **`strategyOverride`** 与全局设置合并逻辑。

---

## 页内浮动面板体验

- 大规模调整 **模板、样式、几何、加载态与事件**：交互流畅度、毛玻璃与拖动/resize、历史侧栏与策略下拉等行为优化。
- 附 **手工验收清单**：[`scripts/panel-flicker-manual-check.txt`](../scripts/panel-flicker-manual-check.txt)（防闪烁与焦点、`Performance` 粗测等）。

---

## API / 提供商 / 提取与精炼链路

- **新增一批 OpenAI 兼容通道厂商**（extract / refine 的 switch 同步扩展）：例如 DeepSeek、Moonshot、豆包、阶跃星辰、MiniMax、零一万物、百度千帆、OpenRouter、xAI、Mistral、Groq、Together、Fireworks 等（以源码 `providers.ts` 与 types 为准）。
- **内置默认模型与描述更新**：例如 OpenAI 默认模型调整、Anthropic/Gemini/硅基流动等文案与默认值优化。
- **自定义组合策略**：当设置中选择 `promptStrategy === 'custom'` 且配置了 `customComponents` 时，`extractPrompt` 通过 `resolveCustomStrategy` 合并组件版本与用户自定义指令/温度/token 上限。

---

## Popup / Options / 全局样式

- **Popup**：更小屏下列表与版本的展示优化（可视行数与高度约束）、精炼流式预览、直达设置 Tab、头部视觉与品牌化文案调整；历史列表改用 **分页式「最近条目」接口**而非一次拉全库。
- **Options**：设置与资料库管理能力扩展；与应用其它处的字体栈（如 `uiFontStack`）、全局样式细节同步。

---

## 提取策略档位（已实现）

源码中 **`strategies-meta` / `strategies`** 内置：`classic`（界面「经典策略」）、`v022`（「v0.2.2 策略」）、`v030`（「v0.3.0 策略」）、`custom`（「自定义组合」）。其中 **v0.3.0** 档位面向 GPT Image 2 / Nano Banana 等新一代文生图模型的输出结构。详细设计参见 [`plan-v030-strategy.md`](plan-v030-strategy.md)（方案说明；请以设置页选项与策略描述为准）。

---

## Chrome Web Store 与合规工程化

- **`npm run release:store`**：上架用 zip（合规校验等）。
- **`npm run store:assets` / `store:screenshots`**：生成商店宣传图与商品截图素材。
- **文档**：`store-listing/` 中英对照文案与检查清单、`PRIVACY.md`、GitHub Actions 自动发上架包（参见 [`CHROME_WEB_STORE_CI.md`](CHROME_WEB_STORE_CI.md)）。
- **终端用户**：主要影响「可从商店安装与更新」及隐私披露入口的一致性；日常使用插件不必关心脚本细节。
- **其它入库**：开源 `LICENSE`、`README` 中上架小节等。

---

## v0.1.34–v0.1.42 补充

以下归纳 **v0.1.33 之后至 v0.1.42** 的增量（含 Manifest、后台与 UI）。

### Manifest 与权限

- **`clipboardRead`**：与既有 `clipboardWrite` 搭配，满足剪贴板相关能力声明（以实际功能与商店披露为准）。
- **内容脚本 `all_frames: true`**：子 frame 内页面也可注入扩展UI，浮动面板覆盖 iframe 场景。

### 后台 Service Worker：右键菜单、消息与可靠投递

- **右键菜单**：主菜单项同时注册 **`image` 与 `video`** 上下文，原生 `<video>` 右键更稳定出现「提取图片提示词」；兜底项上下文收紧为 `page` / `frame` / `link` / `selection` / `editable`，由内容脚本动态控制可见性，减少无关区域误触。
- **`OPEN_OPTIONS`**：除 `tab`、`focus` 外，支持 **`dock=refine|versions`** 写入选项页 hash，便于直达 **AI 调整** 或 **版本** 侧栏。
- **`OPEN_IN_PANEL`**：可指定 **`dock`**；向页面投递 **`PANEL_FROM_HISTORY` 时附带完整历史 `item`**；若目标标签仍处于加载中则等待 **complete** 后再发消息；**`sendToTabReliably`** 在 PING 就绪后校验 **业务消息是否真正送达**，多轮失败再程序化注入，避免与声明式注入冲突；仍失败时回复明确错误（例如提示用户刷新页面）。
- **版本与历史类消息**（供 Popup / 扩展页经 background 调用存储）：**`GET_HISTORY_ITEM`**、**`APPEND_PROMPT_VERSION`**、**`RESTORE_PROMPT_VERSION`**、**`REMOVE_PROMPT_VERSION`**。
- **入库且开启「保存历史」时同图预取**：识图前按与落库一致的缩略图 + **dedupe 键**查询是否已有同图记录；命中则 **`HISTORY_PREFETCH`** 向浮窗预填 **versions**；落库时可 **复用预计算缩略图**，避免对同一图片来源二次编码。

### 自定义组合策略：用户命名预设

- 在 **自定义组合**（`custom`）下，可将当前组合 **保存为命名预设**（名称、组件档位、自定义指令/温度/token 等），**本地**持久化，支持一键应用、重命名、删除；数量与名称长度有上限（见 `userStrategyPresets`）。

### 打开选项页 / 浮动面板的统一封装

- **`lib/messaging/openSurfaces.ts`**：`sendOpenOptions` / `sendOpenInPanel`，与各处 `OPEN_OPTIONS` / `OPEN_IN_PANEL` payload（含 **`tab`**、**`focusId`**、**`dock`**）对齐，减少重复与安全发送逻辑分散。

### Popup：内联版本历史

- **`PopupVersionsInline`**、**`usePopupVersionsDetail`**：在列表项内展示版本时间线，**≤6 条全显，多于 6 条可展开**；支持恢复/删除版本、策略与 **来源** 展示；配合 **`SourceTag`** 组件统一「提取 / 编辑 / 精炼」等来源标签。

### 流式反推 / 精炼与占位版本

- **`refineStreamVersion.ts`**：定义 **`REFINE_STREAM_VERSION_ID` / `EXTRACT_STREAM_VERSION_ID`** 等哨兵 id，与真实落库版本 id 区分；**`*StreamDisplayedBody`** 统一流式期间主编辑区展示文本（含首 token 前的基线回落）。
- 内容脚本 **面板**（`events.ts`、`templates.ts` 等）：生成过程中版本侧栏 **占位行** 与正文 **流式预览** 行为对齐。

### 选项页设置、提示词库与细节

- **`SettingsView`**：区块调整与 **用户策略预设** UI 集成。
- **`PromptLibrary`**：**`ExpandedPanel`**、**`VersionsTab`**、**`ItemRow` / `ItemGridCard`** 等与版本编辑、展示相关的迭代。
- **时间与版本号展示**：**`lib/format/time`**、`versionLabel` 等辅助与测试（`*.test.ts`）。

### 配置导入与备份

- **`configImport.ts`**：粘贴解析路径与容错继续增强。
- **`lib/storage/backup.ts`** 与 **`backup.test.ts`**：备份合并逻辑与单元测试，便于回归。

### 隐私政策与 README

- **`PRIVACY.md`**、**`README.md`** 小幅更新（与「检查更新」GitHub API 披露等保持一致）。

### 开发者本地预览（非商店功能）

- **`src/dev/preview/*`**：`chromeShim`、`gallery.html`、各 `*-preview.html` 等，用于在开发环境下预览 Popup / 选项页 / 面板；**终端用户安装包不依赖该目录**。

### 配套文档

- **`docs/plugin-pages-overview.zh.md`**：扩展页与选项 Tab 结构盘点。
- **`docs/plugin-pages-style-preview.html`**：样式对照参考。

---

## 附录 A：开发与测试资产（节选）

| 类别 | 路径 |
|------|------|
| IndexedDB 与库修订 | `src/lib/storage/historyDb.ts`、`src/lib/storage/history.ts` |
| 文件夹 | `src/lib/storage/folders.ts` |
| 配置粘贴解析 | `src/lib/configImport.ts` |
| 版本链与镜像 | `src/lib/storage/versionState.ts`、`src/lib/storage/versions.ts` |
| 用户自定义策略预设 | `src/lib/storage/userStrategyPresets.ts` |
| 打开选项/面板消息 | `src/lib/messaging/openSurfaces.ts` |
| 流式占位与正文 | `src/lib/refineStreamVersion.ts` |
| 抽查脚本 | `scripts/test-version-state.mjs` |
| 性能快照（若存在） | `scripts/perf-results/latest.json` |
| 备份单测 | `src/lib/storage/backup.test.ts` |

**v0.1.14..v0.1.42 涉及的 `src/` 路径补充（在 v0.1.33 一览基础上）**：`components/SourceTag.tsx`，`lib/format/time.ts`，`lib/messaging/openSurfaces.ts`，`lib/refineStreamVersion.ts`，`lib/storage/userStrategyPresets.ts`，`popup/PopupVersionsInline.tsx`，`popup/usePopupVersionsDetail.ts`，`dev/preview/*`（仅开发），以及 **`manifest.config.ts`**、**`background/index.ts`** 的上述增量。

---

## 相关链接

- 项目说明与上架命令速览：[`README.md`](../README.md)
- 商店 CI：[`docs/CHROME_WEB_STORE_CI.md`](CHROME_WEB_STORE_CI.md)
- 隐私政策（提交商店用 raw URL）：仓库根目录 [`PRIVACY.md`](../PRIVACY.md)
