# 瀑布流与视频当前帧：插件能力说明

本文说明右键视觉提取在 **瀑布流（masonry）** 与 **`<video>` 当前帧** 场景下的行为与限制，对应实现主要在 [`src/content/index.ts`](../src/content/index.ts)、[`src/background/index.ts`](../src/background/index.ts)。

---

## 视频当前帧：**支持**

- 在 **`contextmenu` 捕获阶段**，`computeCtxMenuPrep` 经 **`hitStack`**（`composedPath` 与 `elementsFromPoint` **合并去重**）优先查找 `<video>`，并经由 **`extractVideoBestUrl`**：**有解码数据时** **`captureVideoFrame`** 输出 **`toDataURL('image/jpeg', 0.9)`**（最长边 **1280px**）；否则依次尝试 **`poster` 绝对 URL**、**`currentSrc`/`src`**。
- 若 `<video>` 不在命中栈里（例如 `pointer-events: none`），会通过 **`pickMediaUrlByRectHit`** 在视口内的 `video`、`img` 上做矩形命中兜底；命中视频时同样走 **`extractVideoBestUrl`**。
- **用户直接右键点在 `<video>` 上**时：`showFallback` 为 **false**（不点亮兜底菜单，避免与原生 `video` 菜单重复），但仍把抓拍 / poster / src 写入 **tab 级 `pendingTabExtract`**；后台在原生菜单 **`onClicked`** 时 **10s 内优先**于 `info.srcUrl` 使用 **`data:image/jpeg` 抓拍**（或当 `srcUrl` 判为视频流时优先使用 prep 中的静态 URL），避免 `video/*` 无法在 Service Worker 解码的问题。

### 限制

- **跨域视频**：若页面未按 CORS 为视频资源配置得当，`canvas` 可能被污染，`toDataURL` 失败后会依次尝试 **poster**、**视频 URL**；后台对「纯视频 URL」仍无法在 SW 内解码，参见 [`src/lib/image.ts`](../src/lib/image.ts) 中 `video/*` 相关逻辑。
- **解码就绪**：`readyState < HAVE_CURRENT_DATA` 时不 `drawImage`，依赖 poster / src 分支。

---

## 瀑布流：**无专用模式**，有部分通用优化

实现上**没有**针对 Pinterest 等站的单独「瀑布流开关」或布局识别，而是通用右键选图逻辑下的启发式与性能保护：

- **多张 `<img>` 同时出现在同一命中栈**：选取 **包围盒面积较小** 的图片，用于 **减轻瀑布流重叠时的误选**（参见源码注释：Behance / Pinterest / Dribbble / Unsplash 等常用 overlay 场景）。
- **矩形兜底扫描**：对页面内 `video`、`img` 遍历设有 **`RECT_HIT_MAX_NODES`（2000）** 上限，避免 **超重型瀑布流页面一次右键卡死主线程**。

若站点使用非标准 DOM（例如极小占位图 + 背景图、激进虚拟列表、大量自定义绘制），仍可能出现漏选，需依赖其它分支（如 **CSS `background-image`** 探测）或站点特定适配（当前仓库**没有**站点白名单式瀑布流模块）。

封闭的 **closed Shadow Root** 内的媒体仍无法被脚本穿透；**open shadow** 可通过 `composedPath` 改善命中。

---

## 简要对照

| 场景 | 说明 |
|------|------|
| 视频 → **当前帧 JPEG** 做视觉提取 | **支持**，受 CORS / 画布污染与解码就绪影响；原生 video 菜单路径优先读 tab 缓存 JPEG |
| 瀑布流 masonry | **无单独模式**；依赖 **小面积优先选图** 与 **扫描节点上限**，不保证覆盖所有站点 |

---

## 右键菜单有时不出现？

常见原因与自查：

1. **MV3 Service Worker 竞态（兜底菜单）**  
   主菜单只在 Chrome 判定的 **图片 / 视频** 上下文显示；遮罩下的图等依赖 **兜底菜单**，由后台在收到 **`CTX_MENU_PREP`**（`sendMessage` **+** keepalive **`port.postMessage` 双通道**）后 **`contextMenus.update`**。保活 Port 见 [`src/content/bgPort.ts`](../src/content/bgPort.ts)、[`src/lib/keepalivePort.ts`](../src/lib/keepalivePort.ts)。

2. **页面不允许注入或无权访问**  
   `chrome://`、`chrome.google.com/webstore`、部分内置 PDF / 特殊查看器等页面通常**不会**按普通站点加载扩展内容脚本，右键不会出现本扩展项。

3. **站点 DOM 导致探测不到图**  
   例如仅有自定义画布、封闭 Shadow DOM、虚拟列表未挂载真实 `<img>`、画布跨域污染等，`computeCtxMenuPrep` 拿不到 URL，且 Chrome 也未给出 image/video 上下文时，**主菜单与兜底都不会出现**。

**验收建议**：浏览器冷启动后立刻打开普通 HTTPS 图站，在**遮罩覆盖的图片**上第一次右键，应能稳定看到扩展兜底项；直接右键原生 `<img>` / `<video>` 仍应只看到 **一套**原生上下文下的扩展菜单（不与兜底重复）。

---

## 手工验收矩阵（发布前速查）

建议在 **未打包 dev** 或 **load unpacked 的 dist** 上各跑一次。

| 场景 | 操作 | 预期 |
|------|------|------|
| 原生 `<img>` | 图片上右键 → 直接生成 | 走 `srcUrl`，无重复兜底项 |
| 遮罩 `<img>`（Behance 类） | 透明层上右键 | 出现兜底「直接生成」；提取为栈内小面积 `currentSrc` |
| 原生 `<video>`（同站可抓帧） | 视频画面上右键 → 直接生成 | 走 **JPEG**，后台不误走 `video/*` 下载报错 |
| `<video>` + 跨域污染 | 无 poster、抓帧失败 | 可能仍失败或落到视频 URL；提示与 README 一致 |
| `<video>` + `pointer-events:none` | 点在视频区域（命中矩形兜底） | `showFallback:true`，兜底可用；提取为帧或 poster |
| 假 GIF（`<video autoplay>`） | 点视频区域 | 与视频行相同 |
| Shadow 内 open 图/视频 | 右键目标 | 较旧版更易命中（`composedPath`） |
| 冷启动兜底 | 重启浏览器 → 立刻打开图站 → 遮罩图第一次右键 | 兜底项尽量出现（双通道 + 保活） |
