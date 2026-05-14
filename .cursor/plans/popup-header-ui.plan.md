---
name: Popup 头部与布局迭代
overview: 加宽 Popup，头部改名为 Prompt Extracto 并去掉副标题；右上角改为醒目的「进入插件面板」（仍打开 Options）；顺带收紧列表区排版与信息密度。
todos:
  - id: widen-popup
    content: 将 [`src/popup/index.html`](d:/vscode/Prompt-extraction/src/popup/index.html) body 宽度由 `w-[380px]` 改为约 `w-[460px]`（可按观感微调 ±20px）；必要时同步 [`PopupApp.tsx`](d:/vscode/Prompt-extraction/src/popup/PopupApp.tsx) 内列表 meta（如 model `max-w-*`）以利用变宽空间。
    status: completed
  - id: header-brand-cta
    content: 在 [`PopupApp.tsx`](d:/vscode/Prompt-extraction/src/popup/PopupApp.tsx) 头部去掉副标题行；标题文案改为 `Prompt Extracto`（英文字号略提亮可与图标对齐）。
    status: completed
  - id: panel-entry-button
    content: 将右上角原齿轮按钮替换为主按钮样式：`进入插件面板`，可选配以 `ChevronRight`/`ExternalLink` 图标（[`lucide-react`](https://lucide.dev)）；`title`/无障碍 `aria-label` 写明打开扩展设置页。行为仍为 `chrome.runtime.openOptionsPage()`（与 manifest [`options_page`](d:/vscode/Prompt-extraction/src/manifest.config.ts) 一致）。清空历史仍可保留图标按钮，必要时与主按钮之间加竖向分隔。
    status: completed
  - id: ui-polish
    content: 局部 UI 优化（仅限 Popup）：头部垂直居中单行标题区；列表项外留白或圆角卡片感一致；暗色下边框/分割线对比适度降低；底部操作按钮区域可读性与触控命中保持不变。
    status: completed
  - id: empty-state-cta
    content: "空状态放两个按钮：主「进入插件面板」仍调 `chrome.runtime.openOptionsPage()`（沿用上次停留 Tab）；次「配置 API Key」通过 `chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS', payload: { tab: 'settings' } })` 打开 Options 并落在设置 Tab（与 [`OPEN_OPTIONS`](d:/vscode/Prompt-extraction/src/background/index.ts) 行为一致）。需在 Popup 内抽出两个小函数或共用「打开 options」工具函数避免重复。"
    status: completed
isProject: false
---

# Popup：加宽、品牌文案与「插件面板」入口

## 范围说明

- **插件面板**：本仓库未声明 [`side_panel`](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)；用户所指应为 **Options 全页**（[`manifest.options_page`](d:/vscode/Prompt-extraction/src/manifest.config.ts) → [`src/options/index.html`](d:/vscode/Prompt-extraction/src/options/index.html)），与现有 `openOptions` 一致。
- **仅改 Popup**：不改动 content 悬浮面板；不涉及商店文案除非另行要求。

## 文件改动清单

| 目标 | 文件 |
|------|------|
| _popup 宽度_ | [`src/popup/index.html`](d:/vscode/Prompt-extraction/src/popup/index.html) |
| _标题、副标题删除、右上角 CTA、列表微调_ | [`src/popup/PopupApp.tsx`](d:/vscode/Prompt-extraction/src/popup/PopupApp.tsx) |

## 实现要点

1. **宽度**：`body` 上 Tailwind `w-[380px]` → `w-[460px]` 左右；Chrome Popup 过宽可能影响小屏，460px 为折中。
2. **品牌**：删除 ```256:257:src/popup/PopupApp.tsx``` 中副标题 `div`；主标题改为 `Prompt Extracto`（与扩展英文名一致）。
3. **进入插件面板**：替换 ```270:276:src/popup/PopupApp.tsx``` 图标按钮为带文字的强调按钮（建议使用 violet 实心或浅底描边 + `font-medium text-[11px]`），移除未再使用的 `Settings` import（若 EmptyState 仍用则保留）。
4. **UI 优化（克制）**：header `py`/`gap` 微调；列表 `li` 可考虑 `rounded-xl border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700` 等轻量层次，避免大改版。
5. **空状态**：[`EmptyState`](d:/vscode/Prompt-extraction/src/popup/PopupApp.tsx)（约 709–724 行）改为双按钮：**进入插件面板**（`openOptionsPage`）+ **配置 API Key**（`OPEN_OPTIONS` + `tab: 'settings'`），语义上不重复。

## 验收

- Popup 视觉明显变宽；头部仅英文产品名，无「右键图片 → 提取提示词」。
- 右上角主操作可读性强，点击打开 Options。
- 构建无 lint/ts 错误；`Settings` 等 import 无冗余。
