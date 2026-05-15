---
name: open-plugin-ui-preview
description: >-
  Opens or explains the Prompt Extracto Chrome extension dev UI preview (Popup,
  Options, injected panel) served by Vite at /__dev__/ui-preview with HMR. Use
  in this repository when the user asks to open or preview plugin/extension pages
  in development, dev UI gallery, localhost 5173 preview, or 插件页面预览.
---

# 打开插件页面预览（开发环境）

仅适用于本仓库（Vite + `@crxjs/vite-plugin`，见 [`vite.config.ts`](../../../vite.config.ts)）。

## 步骤

1. 在仓库根目录执行 `npm run dev`（[`package.json`](../../../package.json)）。
2. 在浏览器打开 **`http://localhost:5173/__dev__/ui-preview`**（`vite.config.ts` 中 `server.port` 为 `5173` 且 `strictPort: true`）。
3. 默认配置下 Vite 会在就绪后 **自动** 用系统浏览器打开上述路径（`server.open: '/__dev__/ui-preview'`）。若未弹出，手动输入 URL 即可。
4. 聚合页内可用锚点切换：**`#popup`** / **`#options`** / **`#panel`**。

## 由 Agent 代为打开浏览器时

在用户本机为 Windows 且开发服务已就绪时，可执行：

```powershell
Start-Process "http://localhost:5173/__dev__/ui-preview"
```

需要先确认 `http://localhost:5173` 可访问，避免重复启动第二个 `npm run dev` 导致端口占用。

## 不要与生产预览混淆

- **`npm run preview`**（`vite preview`）用于预览 **build 产出**；[`devUiPreviewGallery`](../../../vite.config.ts) 仅 `apply: 'serve'`，**不会**在 preview 服务器注册 `/__dev__/ui-preview`。
- 日常调 Popup / Options / 面板 UI 请用 **`npm run dev`**。

## 可选：禁止启动时自动开浏览器

```powershell
$env:DEV_PREVIEW_NO_OPEN='1'; npm run dev
```

## 实现位置（排障用）

- 聚合页 HTML：[`src/dev/preview/gallery.html`](../../../src/dev/preview/gallery.html)
- Chrome API 垫片：[`src/dev/preview/chromeShim.ts`](../../../src/dev/preview/chromeShim.ts)
- 文档：[`docs/plugin-pages-overview.zh.md`](../../../docs/plugin-pages-overview.zh.md)
